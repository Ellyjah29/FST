// server.js — FINAL: STABLE FPL SCORING WITH RATE LIMITING
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();

// CRITICAL FIX: Trust Render's reverse proxy
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use(express.static('public', {
  maxAge: '1d',
  etag: true
}));

// MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fst_fantasy';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB error:', err));

// Rate limiting middleware
const rateLimit = require('express-rate-limit');

const updatePointsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3, // 3 requests per 5 minutes
  message: 'Too many updates from this IP, please try again after 5 minutes',
  standardHeaders: true,
  legacyHeaders: false,
});

// User Schema
const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  managerName: { 
    type: String, 
    required: true,
    default: "FST Manager",
    trim: true,
    maxlength: 20
  },
  solWallet: { type: String },
  team: [{ type: Number }],
  points: { type: Number, default: 0 }, // Current gameweek points
  totalPoints: { type: Number, default: 0 }, // Season total points
  entries: { type: Number, default: 0 },
  joined: { type: Boolean, default: false },
  locked: { type: Boolean, default: false },
  currentGameweek: { type: Number, default: 1 },
  lastUpdated: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    db: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    timestamp: new Date().toISOString()
  });
});

// Connect Wallet
app.post('/connect-wallet', async (req, res) => {
  try {
    const { userId, managerName = "FST Manager", solWallet } = req.body;
    if (!userId) return res.status(400).json({ error: 'Telegram ID required' });

    const existingUser = await User.findOne({ telegramId: userId });
    if (existingUser && existingUser.locked) {
      return res.status(400).json({ error: 'Already joined. Team is locked.' });
    }

    const user = await User.findOneAndUpdate(
      { telegramId: userId },
      { 
        managerName: managerName.trim().substring(0, 20) || "FST Manager",
        solWallet: solWallet || undefined,
        joined: true,
        currentGameweek: 1 // Reset for new contest
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({
      success: true,
      userId: user.telegramId,
      managerName: user.managerName
    });
  } catch (error) {
    console.error('Connect error:', error.message);
    res.status(500).json({ error: 'Failed to join' });
  }
});

// Get Players — WITH DETAILED STATS
app.get('/players', async (req, res) => {
  try {
    const response = await axios.get('https://fantasy.premierleague.com/api/bootstrap-static/', {
      timeout: 5000
    });

    const players = response.data.elements;
    const teams = response.data.teams;
    const teamMap = {};
    teams.forEach(team => {
      teamMap[team.id] = team.name;
    });

    const formatted = players.map(p => ({
      id: p.id,
      web_name: p.web_name,
      team: p.team,
      team_name: teamMap[p.team] || 'Unknown',
      element_type: p.element_type,
      position: ["GK", "DEF", "MID", "FWD"][p.element_type - 1] || "UNK",
      now_cost: (p.now_cost / 10).toFixed(1),
      total_points: p.total_points || 0,
      goals_scored: p.goals_scored || 0,
      assists: p.assists || 0,
      clean_sheets: p.clean_sheets || 0,
      minutes: p.minutes || 0,
      bonus: p.bonus || 0,
      form: p.form || "0.0",
      points_per_game: p.points_per_game || "0.0",
      selected_by_percent: p.selected_by_percent || "0.0",
      photo_url: `https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.photo.split('.')[0]}.png`
    }));

    res.json(formatted);
  } catch (error) {
    console.error('FPL error:', error.message);
    res.status(500).json({ error: 'Failed to load players. Please try again later.' });
  }
});

// Get Current Gameweek
app.get('/current-gameweek', async (req, res) => {
  try {
    const response = await axios.get('https://fantasy.premierleague.com/api/bootstrap-static/', {
      timeout: 5000
    });
    
    const currentGameweek = response.data.current_event;
    res.json({
      success: true,
      gameweek: currentGameweek
    });
  } catch (error) {
    console.error('Current gameweek error:', error.message);
    res.status(500).json({ error: 'Failed to get current gameweek' });
  }
});

// Save Team — WITH DUPLICATE CHECK
app.post('/save-team', async (req, res) => {
  try {
    const { userId, team } = req.body;
    if (!userId || !Array.isArray(team) || team.length !== 11) {
      return res.status(400).json({ error: 'Team must have 11 players' });
    }

    const uniquePlayers = new Set(team);
    if (uniquePlayers.size !== team.length) {
      return res.status(400).json({ error: 'Duplicate players not allowed' });
    }

    const user = await User.findOne({ telegramId: userId });
    if (!user) return res.status(404).json({ error: 'Join contest first' });
    if (user.locked) return res.status(400).json({ error: 'Team already submitted' });

    user.team = team;
    user.locked = true;
    user.entries += 1;
    user.points = 0; // Reset points for new gameweek
    user.lastUpdated = new Date();
    await user.save();

    res.json({ success: true, message: '✅ Team locked in!' });
  } catch (error) {
    console.error('Save error:', error.message);
    res.status(500).json({ error: 'Failed to save team' });
  }
});

// Update Team Points (Proper FPL Scoring)
app.post('/update-points', updatePointsLimiter, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    const user = await User.findOne({ telegramId: userId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.team || user.team.length !== 11) {
      return res.status(400).json({ error: 'Team not complete' });
    }

    // Get current gameweek from FPL API
    const bootstrapResponse = await axios.get('https://fantasy.premierleague.com/api/bootstrap-static/', {
      timeout: 5000
    });
    
    const currentGameweek = bootstrapResponse.data.current_event;
    
    let totalPoints = 0;
    const playerStats = [];

    // Fetch stats for each player
    for (const playerId of user.team) {
      try {
        const response = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${playerId}/`, {
          timeout: 5000
        });
        
        const data = response.data;
        
        // Find the current gameweek stats
        const currentGWStats = data.history.find(gw => gw.round === currentGameweek);
        
        const points = currentGWStats?.total_points || 0;
        totalPoints += points;
        
        playerStats.push({
          player_id: playerId,
          points: points,
          minutes: currentGWStats?.minutes || 0,
          goals: currentGWStats?.goals_scored || 0,
          assists: currentGWStats?.assists || 0,
          clean_sheets: currentGWStats?.clean_sheets || 0,
          bonus: currentGWStats?.bonus || 0,
          gameweek: currentGameweek
        });
      } catch (e) {
        // If API fails, use 0 points for this player
        playerStats.push({
          player_id: playerId,
          points: 0,
          minutes: 0,
          goals: 0,
          assists: 0,
          clean_sheets: 0,
          bonus: 0,
          gameweek: currentGameweek
        });
      }
    }

    // Update user points
    user.points = totalPoints;
    user.lastUpdated = new Date();
    await user.save();

    res.json({
      success: true,
      points: totalPoints,
      gameweek: currentGameweek,
      playerStats: playerStats
    });
  } catch (error) {
    console.error('Update points error:', error.message);
    res.status(500).json({ error: 'Failed to update points' });
  }
});

// Get User Profile
app.get('/user-profile', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    const user = await User.findOne({ telegramId: userId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      managerName: user.managerName,
      solWallet: user.solWallet,
      team: user.team,
      points: user.points,
      totalPoints: user.totalPoints,
      entries: user.entries,
      locked: user.locked,
      joined: user.joined,
      currentGameweek: user.currentGameweek,
      lastUpdated: user.lastUpdated
    });
  } catch (error) {
    console.error('Profile error:', error.message);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// Leaderboard
app.get('/leaderboard', async (req, res) => {
  try {
    const users = await User.find({ locked: true })
      .sort({ points: -1 })
      .limit(10)
      .select('managerName points');

    const leaderboard = users.map((user, i) => ({
      rank: i + 1,
      managerName: user.managerName,
      points: user.points
    }));

    res.json(leaderboard);
  } catch (error) {
    console.error('Leaderboard error:', error.message);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// Prize Pool
app.get('/prize-pool', async (req, res) => {
  try {
    const totalEntries = await User.countDocuments({ locked: true });
    res.json({ fst: totalEntries * 10, entries: totalEntries });
  } catch (error) {
    console.error('Prize error:', error.message);
    res.status(500).json({ error: 'Failed to calculate prize pool' });
  }
});

// Catch-all
app.get('*', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ FST Fantasy running on port ${PORT}`);
});
