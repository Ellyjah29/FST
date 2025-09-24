// server.js — FORMATION-BASED FANTASY WITH SOL WALLET
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
  .catch(err => console.error('❌ MongoDB error:', err));

// ========================
// USER SCHEMA — MINIMAL & SECURE
// ========================
const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  managerName: { 
    type: String, 
    required: true,
    default: "FST Manager",
    trim: true,
    maxlength: 20
  },
  solWallet: { 
    type: String, 
    required: true,
    match: /^([a-zA-Z0-9]{32,44})$/ // Basic SOL validation
  },
  team: [{ type: Number }], // FPL player IDs only
  points: { type: Number, default: 0 },
  entries: { type: Number, default: 0 },
  joined: { type: Boolean, default: false },
  locked: { type: Boolean, default: false }, // Prevent re-join
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// ========================
// HEALTH CHECK
// ========================
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    db: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    timestamp: new Date().toISOString()
  });
});

// ========================
// CONNECT WALLET — JOIN CONTEST
// ========================
app.post('/connect-wallet', async (req, res) => {
  try {
    const { userId, managerName = "FST Manager", solWallet } = req.body;

    if (!userId) return res.status(400).json({ error: 'Telegram ID required' });
    if (!solWallet) return res.status(400).json({ error: 'SOL wallet required' });
    if (!/^[a-zA-Z0-9]{32,44}$/.test(solWallet)) {
      return res.status(400).json({ error: 'Invalid SOL wallet address' });
    }

    // Prevent re-join if already locked
    const existingUser = await User.findOne({ telegramId: userId });
    if (existingUser && existingUser.locked) {
      return res.status(400).json({ error: 'Already joined. Team is locked.' });
    }

    const user = await User.findOneAndUpdate(
      { telegramId: userId },
      { 
        managerName: managerName.trim().substring(0, 20) || "FST Manager",
        solWallet: solWallet.toLowerCase(),
        joined: true // Mark as joined immediately
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({
      success: true,
      userId: user.telegramId,
      managerName: user.managerName,
      solWallet: user.solWallet
    });
  } catch (error) {
    console.error('Connect wallet error:', error.message);
    res.status(500).json({ error: 'Failed to join contest' });
  }
});

// ========================
// GET PLAYERS — LIVE FROM FPL API (NO DB CACHE)
// ========================
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
      photo_url: `https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.photo.split('.')[0]}.png`
    }));

    res.json(formatted);
  } catch (error) {
    console.error('FPL API error:', error.message);
    res.status(500).json({ error: 'Failed to load players' });
  }
});

// ========================
// SAVE TEAM — LOCK ON SUBMIT
// ========================
app.post('/save-team', async (req, res) => {
  try {
    const { userId, team } = req.body;

    if (!userId || !Array.isArray(team) || team.length !== 11) {
      return res.status(400).json({ error: 'Team must have exactly 11 players' });
    }

    const user = await User.findOne({ telegramId: userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found. Join contest first.' });
    }

    if (user.locked) {
      return res.status(400).json({ error: 'Team already submitted. Cannot change.' });
    }

    user.team = team;
    user.locked = true;
    user.entries += 1;
    user.points = Math.floor(Math.random() * 150) + 20; // Simulate for MVP
    await user.save();

    res.json({ success: true, message: '✅ Team locked in!' });
  } catch (error) {
    console.error('Save team error:', error.message);
    res.status(500).json({ error: 'Failed to save team' });
  }
});

// ========================
// GET USER PROFILE
// ========================
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
      entries: user.entries,
      locked: user.locked
    });
  } catch (error) {
    console.error('Profile error:', error.message);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// ========================
// LEADERBOARD — COMPUTED
// ========================
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

// ========================
// PRIZE POOL
// ========================
app.get('/prize-pool', async (req, res) => {
  try {
    const totalEntries = await User.countDocuments({ locked: true });
    res.json({ 
      fst: totalEntries * 10, 
      entries: totalEntries 
    });
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
// START SERVER
// ========================
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ FST Fantasy running on port ${PORT}`);
});
