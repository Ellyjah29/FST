// server.js — WITH MONGODB PERSISTENCE
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public', {
  maxAge: '1d',
  etag: true
}));

// ========================
// MONGODB CONNECTION
// ========================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fst_fantasy';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ========================
// SCHEMAS
// ========================

const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  walletAddress: { type: String, required: true },
  displayName: { type: String, default: "FST Manager" },
  profilePic: { 
    type: String, 
    default: "https://via.placeholder.com/50x50?text=👤" 
  },
  team: [{ type: Number }], // array of FPL player IDs
  points: { type: Number, default: 0 },
  joined: { type: Boolean, default: false },
  entries: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const playerSchema = new mongoose.Schema({
  fplId: { type: Number, required: true, unique: true },
  webName: String,
  team: Number,
  teamName: String,
  elementType: Number,
  position: String,
  nowCost: Number, // in £ (e.g., 12.5)
  totalPoints: Number,
  photoUrl: String,
  lastUpdated: { type: Date, default: Date.now }
});

// Models
const User = mongoose.model('User', userSchema);
const Player = mongoose.model('Player', playerSchema);

// ========================
// HEALTH CHECK
// ========================
app.get('/health', async (req, res) => {
  const dbState = mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected';
  res.status(200).json({
    status: 'OK',
    db: dbState,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ========================
// CONNECT WALLET + CREATE/UPDATE USER
// ========================
app.post('/connect-wallet', async (req, res) => {
  try {
    const { userId, displayName = "FST Manager", profilePic } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Telegram user ID required' });
    }

    const simulatedAddress = '0x' + userId.padEnd(40, 'a').slice(0, 40);

    // Upsert user
    let user = await User.findOne({ telegramId: userId });
    if (!user) {
      user = new User({
        telegramId: userId,
        walletAddress: simulatedAddress,
        displayName,
        profilePic: profilePic || "https://via.placeholder.com/50x50?text=👤"
      });
    } else {
      // Update profile if new data provided
      if (displayName) user.displayName = displayName;
      if (profilePic) user.profilePic = profilePic;
    }

    await user.save();

    res.json({
      success: true,
      address: user.walletAddress,
      userId: user.telegramId,
      displayName: user.displayName,
      profilePic: user.profilePic
    });
  } catch (error) {
    console.error('Connect wallet error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========================
// LOAD PLAYERS (FROM DB OR FPL API)
// ========================
app.get('/players', async (req, res) => {
  try {
    // Try to load from DB first
    let players = await Player.find().limit(200);
    
    if (players.length === 0) {
      // Fetch from FPL API if DB is empty
      const response = await axios.get('https://fantasy.premierleague.com/api/bootstrap-static/', {
        timeout: 5000
      });

      const fplPlayers = response.data.elements;
      const teams = response.data.teams;
      const teamMap = {};
      teams.forEach(team => {
        teamMap[team.id] = team.name;
      });

      const playerDocs = fplPlayers.map(p => ({
        fplId: p.id,
        webName: p.web_name,
        team: p.team,
        teamName: teamMap[p.team] || 'Unknown',
        elementType: p.element_type,
        position: ["GK", "DEF", "MID", "FWD"][p.element_type - 1] || "UNK",
        nowCost: p.now_cost / 10,
        totalPoints: p.total_points || 0,
        photoUrl: `https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.photo.split('.')[0]}.png`
      }));

      await Player.insertMany(playerDocs);
      players = playerDocs;
    }

    // Format for frontend
    const formatted = players.map(p => ({
      id: p.fplId,
      web_name: p.webName,
      team: p.team,
      team_name: p.teamName,
      element_type: p.elementType,
      position: p.position,
      now_cost: p.nowCost.toFixed(1),
      total_points: p.totalPoints,
      photo_url: p.photoUrl
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Players error:', error.message);
    
    // Fallback mock
    res.json([
      { id: 1, web_name: "Salah", team: 14, team_name: "Liverpool", element_type: 4, position: "FWD", now_cost: "12.5", total_points: 250, photo_url: "https://resources.premierleague.com/premierleague/photos/players/110x140/p109368.png" }
    ]);
  }
});

// ========================
// SAVE TEAM
// ========================
app.post('/save-team', async (req, res) => {
  try {
    const { userId, team } = req.body;

    if (!userId || !team || !Array.isArray(team) || team.length !== 11) {
      return res.status(400).json({ error: 'Invalid team data. Must be 11 players.' });
    }

    const user = await User.findOne({ telegramId: userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found. Connect wallet first.' });
    }

    user.team = team;
    user.joined = true;
    user.entries += 1;
    user.points = Math.floor(Math.random() * 150) + 20; // simulate for MVP
    await user.save();

    res.json({ success: true, message: '✅ Team saved. Contest joined for free!' });
  } catch (error) {
    console.error('Save team error:', error.message);
    res.status(500).json({ error: 'Failed to save team' });
  }
});

// ========================
// GET USER PROFILE + TEAM
// ========================
app.get('/user-profile', async (req, res) => {
  try {
    // In real app, get userId from Telegram initData
    const userId = req.query.userId || Object.values(req.headers)[0]?.split?.('user=')?.[1] || 'demo_user';

    const user = await User.findOne({ telegramId: userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get player details for team
    let teamPlayers = [];
    if (user.team && user.team.length > 0) {
      teamPlayers = await Player.find({ fplId: { $in: user.team } });
    }

    const formattedTeam = teamPlayers.map(p => ({
      id: p.fplId,
      web_name: p.webName,
      position: p.position,
      now_cost: p.nowCost.toFixed(1)
    }));

    res.json({
      displayName: user.displayName,
      profilePic: user.profilePic,
      team: formattedTeam,
      points: user.points,
      entries: user.entries
    });
  } catch (error) {
    console.error('Profile error:', error.message);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// ========================
// LEADERBOARD
// ========================
app.get('/leaderboard', async (req, res) => {
  try {
    const users = await User.find({ joined: true })
      .sort({ points: -1 })
      .limit(10)
      .select('displayName profilePic points telegramId');

    const leaderboard = users.map(user => ({
      userId: user.telegramId.slice(0, 8) + '...',
      displayName: user.displayName,
      profilePic: user.profilePic,
      points: user.points
    }));

    res.json(leaderboard);
  } catch (error) {
    console.error('Leaderboard error:', error.message);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// ========================
// PRIZE POOL
// ========================
app.get('/prize-pool', async (req, res) => {
  try {
    const totalEntries = await User.countDocuments({ joined: true });
    const totalFST = totalEntries * 10; // 10 FST per entry
    res.json({ fst: totalFST, entries: totalEntries });
  } catch (error) {
    console.error('Prize pool error:', error.message);
    res.status(500).json({ error: 'Failed to calculate prize pool' });
  }
});

// ========================
// CATCH-ALL
// ========================
app.get('*', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

// ========================
// ERROR HANDLER
// ========================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

// ========================
// START SERVER
// ========================
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ FST Fantasy Server running on port ${PORT}`);
  console.log(`🌐 Visit: http://localhost:${PORT}`);
});
