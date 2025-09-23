// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // 👈 Serves /public/index.html on /

// In-memory storage
let users = {};
let globalEntries = 0;
const FST_PER_ENTRY = 10;

// ========================
// TELEGRAM + WALLET SIMULATION
// ========================

app.post('/connect-wallet', (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID required' });
  }

  const simulatedAddress = '0x' + userId.padEnd(40, 'a').slice(0, 40);

  if (!users[userId]) {
    users[userId] = {
      address: simulatedAddress,
      team: null,
      points: 0,
      joined: false
    };
  }

  res.json({
    success: true,
    address: simulatedAddress,
    userId
  });
});

// ========================
// FPL PLAYER DATA
// ========================

app.get('/players', async (req, res) => {
  try {
    const response = await axios.get('https://fantasy.premierleague.com/api/bootstrap-static/');
    const players = response.data.elements;

    const simplified = players.map(p => ({
      id: p.id,
      web_name: p.web_name,
      team: p.team,
      element_type: p.element_type,
      points: p.total_points
    }));

    res.json(simplified);
  } catch (error) {
    console.error('Failed to fetch FPL data:', error.message);
    res.status(500).json({ error: 'Could not load players. Try again later.' });
  }
});

// ========================
// SAVE TEAM + JOIN CONTEST (FREE)
// ========================

app.post('/save-team', (req, res) => {
  const { userId, team } = req.body;

  if (!userId || !team || !Array.isArray(team) || team.length !== 11) {
    return res.status(400).json({ error: 'Invalid team data' });
  }

  if (!users[userId]) {
    return res.status(404).json({ error: 'User not found. Connect wallet first.' });
  }

  users[userId].team = team;
  users[userId].joined = true;
  globalEntries += 1;
  users[userId].points = Math.floor(Math.random() * 150) + 20;

  res.json({
    success: true,
    message: 'Team saved. Contest joined for free!'
  });
});

// ========================
// GET USER TEAM
// ========================

app.get('/get-team', (req, res) => {
  const userId = Object.keys(users)[0] || 'no_user';
  const user = users[userId];
  res.json(user?.team || []);
});

// ========================
// LEADERBOARD
// ========================

app.get('/leaderboard', (req, res) => {
  const leaderboard = Object.entries(users)
    .filter(([_, user]) => user.joined)
    .map(([userId, user]) => ({
      userId: userId,
      points: user.points || 0
    }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 10);

  res.json(leaderboard);
});

// ========================
// PRIZE POOL (FST TOKENS)
// ========================

app.get('/prize-pool', (req, res) => {
  const totalFST = globalEntries * FST_PER_ENTRY;
  res.json({
    fst: totalFST,
    entries: globalEntries
  });
});

// ========================
// STATUS PAGE (optional)
// ========================

app.get('/status', (req, res) => {
  res.send(`
    <h1>⚽ FST Fantasy Backend</h1>
    <p>Status: <strong>Running</strong></p>
    <p>Entries: <strong>${globalEntries}</strong></p>
    <p>Endpoints: <code>/players</code>, <code>/save-team</code>, <code>/leaderboard</code>, <code>/prize-pool</code></p>
  `);
});

// ========================
// START SERVER
// ========================

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ FST Fantasy Server running on port ${PORT}`);
  console.log(`🌐 Visit: https://your-render-url.onrender.com`);
});
