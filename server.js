// server.js — FINAL: TRANSFER SYSTEM + BUDGET TRACKER + REAL-TIME SCORING
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();

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
  team: [{ type: Number }], // 11 players
  points: { type: Number, default: 0 }, // Current gameweek points
  totalPoints: { type: Number, default: 0 }, // Season total points
  entries: { type: Number, default: 0 },
  joined: { type: Boolean, default: false },
  locked: { type: Boolean, default: false },
  currentGameweek: { type: Number, default: 1 },
  lastUpdated: { type: Date, default: Date.now },
  budget: { type: Number, default: 100.0 },
  transfersRemaining: { type: Number, default: 1 }, // Free transfers
  wildcardUsed: { type: Boolean, default: false },
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
        currentGameweek: 1,
        budget: 100.0,
        transfersRemaining: 1, // Reset transfers for new contest
        wildcardUsed: false
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({
      success: true,
      userId: user.telegramId,
      managerName: user.managerName,
      budget: user.budget,
      transfersRemaining: user.transfersRemaining
    });
  } catch (error) {
    console.error('Connect error:', error.message);
    res.status(500).json({ error: 'Failed to join' });
  }
});

// Get Players — WITH DETAILED STATS & BUDGET
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

// Get Player Gameweek Stats
app.get('/player-stats/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;
    const response = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${playerId}/`, {
      timeout: 5000
    });

    const data = response.data;
    
    // Return most recent gameweek stats
    const latestGW = data.history.sort((a, b) => b.round - a.round)[0];
    
    res.json({
      success: true,
      player_id: playerId,
      gameweek: latestGW?.round || 0,
      points: latestGW?.total_points || 0,
      minutes: latestGW?.minutes || 0,
      goals: latestGW?.goals_scored || 0,
      assists: latestGW?.assists || 0,
      clean_sheets: latestGW?.clean_sheets || 0,
      bonus: latestGW?.bonus || 0,
      form: latestGW?.form || "0.0"
    });
  } catch (error) {
    console.error('Player stats error:', error.message);
    res.status(500).json({ error: 'Failed to load player stats' });
  }
});

// Save Team — WITH BUDGET CHECK
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

    // Calculate total cost
    let totalCost = 0;
    for (const playerId of team) {
      const player = allPlayers.find(p => p.id === playerId);
      if (player) {
        totalCost += parseFloat(player.now_cost || 0);
      }
    }

    if (totalCost > 100) {
      return res.status(400).json({ 
        error: `Team budget exceeded! Total: £${totalCost.toFixed(1)}m (max £100m)`,
        remaining: (100 - totalCost).toFixed(1)
      });
    }

    const user = await User.findOne({ telegramId: userId });
    if (!user) return res.status(404).json({ error: 'Join contest first' });
    if (user.locked) return res.status(400).json({ error: 'Team already submitted' });

    user.team = team;
    user.locked = true;
    user.entries += 1;
    user.points = 0;
    user.budget = 100.0 - totalCost;
    user.lastUpdated = new Date();
    await user.save();

    res.json({ 
      success: true, 
      message: '✅ Team locked in!',
      budget: user.budget,
      transfersRemaining: user.transfersRemaining
    });
  } catch (error) {
    console.error('Save error:', error.message);
    res.status(500).json({ error: 'Failed to save team' });
  }
});

// Update Team Points (Real-time scoring)
app.post('/update-points', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    const user = await User.findOne({ telegramId: userId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.team || user.team.length !== 11) {
      return res.status(400).json({ error: 'Team not complete' });
    }

    let totalPoints = 0;
    const playerStats = [];

    // Fetch stats for each player
    for (const playerId of user.team) {
      try {
        const response = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${playerId}/`, {
          timeout: 5000
        });
        
        const data = response.data;
        const latestGW = data.history.sort((a, b) => b.round - a.round)[0];
        
        const points = latestGW?.total_points || 0;
        totalPoints += points;
        
        playerStats.push({
          player_id: playerId,
          points: points,
          minutes: latestGW?.minutes || 0,
          goals: latestGW?.goals_scored || 0,
          assists: latestGW?.assists || 0,
          clean_sheets: latestGW?.clean_sheets || 0,
          bonus: latestGW?.bonus || 0
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
          bonus: 0
        });
      }
    }

    // Update user points
    user.points = totalPoints;
    user.totalPoints = totalPoints;
    user.lastUpdated = new Date();
    await user.save();

    res.json({
      success: true,
      points: totalPoints,
      playerStats: playerStats
    });
  } catch (error) {
    console.error('Update points error:', error.message);
    res.status(500).json({ error: 'Failed to update points' });
  }
});

// Make Transfer
app.post('/make-transfer', async (req, res) => {
  try {
    const { userId, outgoingPlayerId, incomingPlayerId } = req.body;
    if (!userId || !outgoingPlayerId || !incomingPlayerId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const user = await User.findOne({ telegramId: userId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.locked) return res.status(400).json({ error: 'Team not submitted yet' });

    // Check if user has transfers remaining
    if (user.transfersRemaining <= 0 && !user.wildcardUsed) {
      return res.status(400).json({ 
        error: 'No transfers remaining. Use wildcard or wait for next gameweek.',
        penalty: -4
      });
    }

    // Get player costs
    const outgoingPlayer = allPlayers.find(p => p.id === outgoingPlayerId);
    const incomingPlayer = allPlayers.find(p => p.id === incomingPlayerId);
    
    if (!outgoingPlayer || !incomingPlayer) {
      return res.status(400).json({ error: 'Invalid player IDs' });
    }

    // Check position compatibility
    if (outgoingPlayer.element_type !== incomingPlayer.element_type) {
      return res.status(400).json({ 
        error: `Cannot replace ${outgoingPlayer.position} with ${incomingPlayer.position}`,
        positions: [outgoingPlayer.position, incomingPlayer.position]
      });
    }

    // Check budget
    const currentBudget = user.budget;
    const outgoingCost = parseFloat(outgoingPlayer.now_cost || 0);
    const incomingCost = parseFloat(incomingPlayer.now_cost || 0);
    const newBudget = currentBudget + outgoingCost - incomingCost;
    
    if (newBudget < 0) {
      return res.status(400).json({ 
        error: `Transfer would exceed budget by £${Math.abs(newBudget).toFixed(1)}m`,
        remaining: newBudget.toFixed(1)
      });
    }

    // Perform transfer
    const team = [...user.team];
    const outgoingIndex = team.indexOf(outgoingPlayerId);
    if (outgoingIndex === -1) {
      return res.status(400).json({ error: 'Outgoing player not in team' });
    }

    team[outgoingIndex] = incomingPlayerId;

    // Update user
    user.team = team;
    user.budget = newBudget;
    user.transfersRemaining = user.transfersRemaining > 0 ? user.transfersRemaining - 1 : 0;
    user.lastUpdated = new Date();
    await user.save();

    res.json({
      success: true,
      message: '✅ Transfer completed!',
      newBudget: user.budget,
      transfersRemaining: user.transfersRemaining,
      penalty: 0 // No penalty for free transfers
    });
  } catch (error) {
    console.error('Transfer error:', error.message);
    res.status(500).json({ error: 'Failed to make transfer' });
  }
});

// Reset Transfers (for demo - in real app, this would happen automatically at start of new gameweek)
app.post('/reset-transfers', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    const user = await User.findOne({ telegramId: userId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.transfersRemaining = 1;
    user.wildcardUsed = false;
    user.currentGameweek = user.currentGameweek + 1;
    await user.save();

    res.json({
      success: true,
      message: '✅ Transfers reset for new gameweek!',
      transfersRemaining: user.transfersRemaining,
      currentGameweek: user.currentGameweek
    });
  } catch (error) {
    console.error('Reset transfers error:', error.message);
    res.status(500).json({ error: 'Failed to reset transfers' });
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
      lastUpdated: user.lastUpdated,
      budget: user.budget,
      transfersRemaining: user.transfersRemaining,
      wildcardUsed: user.wildcardUsed
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
