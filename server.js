// server.js — RENDER-OPTIMIZED, PLAYER IMAGES, SEARCH, SORT
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public', {
  maxAge: '1d',
  etag: true
}));

// In-memory storage
let users = {};
let globalEntries = 0;
const FST_PER_ENTRY = 10;

// Health check for Render
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    uptime: process.uptime(),
    entries: globalEntries,
    timestamp: new Date().toISOString()
  });
});

// Connect wallet (simulated)
app.post('/connect-wallet', (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    const simulatedAddress = '0x' + userId.padEnd(40, 'a').slice(0, 40);
    if (!users[userId]) {
      users[userId] = {
        address: simulatedAddress,
        team: null,
        points: 0,
        joined: false
      };
    }

    res.json({ success: true, address: simulatedAddress, userId });
  } catch (error) {
    console.error('Connect wallet error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Enhanced players endpoint with images, logos, cost, points
app.get('/players', async (req, res) => {
  try {
    const response = await axios.get('https://fantasy.premierleague.com/api/bootstrap-static/', {
      timeout: 5000
    });

    const players = response.data.elements;
    const teams = response.data.teams;

    // Map teams for logo and name
    const teamMap = {};
    teams.forEach(team => {
      teamMap[team.id] = {
        name: team.name,
        short_name: team.short_name,
        logo: `https://resources.premierleague.com/premierleague/badges/t${team.id}.png`
      };
    });

    const enhancedPlayers = players.map(p => ({
      id: p.id,
      web_name: p.web_name,
      team: p.team,
      team_name: teamMap[p.team]?.name || 'Unknown',
      team_logo: teamMap[p.team]?.logo || '',
      element_type: p.element_type,
      position: ["GK", "DEF", "MID", "FWD"][p.element_type - 1] || "UNK",
      now_cost: (p.now_cost / 10).toFixed(1), // e.g., 125 → £12.5m
      total_points: p.total_points || 0,
      photo_url: `https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.photo.replace('.jpg', '')}.png`
    }));

    res.json(enhancedPlayers);
  } catch (error) {
    console.error('FPL API Error:', error.message);

    // Fallback mock players with images
    const mockPlayers = [
      {
        id: 1,
        web_name: "Mohamed Salah",
        team: 14,
        team_name: "Liverpool",
        team_logo: "https://resources.premierleague.com/premierleague/badges/t14.png",
        element_type: 4,
        position: "FWD",
        now_cost: "12.5",
        total_points: 250,
        photo_url: "https://resources.premierleague.com/premierleague/photos/players/110x140/p109368.png"
      },
      {
        id: 2,
        web_name: "Erling Haaland",
        team: 43,
        team_name: "Man City",
        team_logo: "https://resources.premierleague.com/premierleague/badges/t43.png",
        element_type: 4,
        position: "FWD",
        now_cost: "14.0",
        total_points: 240,
        photo_url: "https://resources.premierleague.com/premierleague/photos/players/110x140/p409430.png"
      },
      {
        id: 3,
        web_name: "Kevin De Bruyne",
        team: 43,
        team_name: "Man City",
        team_logo: "https://resources.premierleague.com/premierleague/badges/t43.png",
        element_type: 3,
        position: "MID",
        now_cost: "11.5",
        total_points: 220,
        photo_url: "https://resources.premierleague.com/premierleague/photos/players/110x140/p104499.png"
      },
      {
        id: 4,
        web_name: "Alisson",
        team: 14,
        team_name: "Liverpool",
        team_logo: "https://resources.premierleague.com/premierleague/badges/t14.png",
        element_type: 1,
        position: "GK",
        now_cost: "9.0",
        total_points: 180,
        photo_url: "https://resources.premierleague.com/premierleague/photos/players/110x140/p200605.png"
      },
      {
        id: 5,
        web_name: "Trent Alexander-Arnold",
        team: 14,
        team_name: "Liverpool",
        team_logo: "https://resources.premierleague.com/premierleague/badges/t14.png",
        element_type: 2,
        position: "DEF",
        now_cost: "8.5",
        total_points: 200,
        photo_url: "https://resources.premierleague.com/premierleague/photos/players/110x140/p200669.png"
      }
    ];

    res.json(mockPlayers);
  }
});

// Save team
app.post('/save-team', (req, res) => {
  try {
    const { userId, team } = req.body;
    if (!userId || !team || !Array.isArray(team) || team.length !== 11) {
      return res.status(400).json({ error: 'Invalid team data. Must be 11 players.' });
    }
    if (!users[userId]) {
      return res.status(404).json({ error: 'User not found. Connect wallet first.' });
    }

    users[userId].team = team;
    users[userId].joined = true;
    globalEntries += 1;
    users[userId].points = Math.floor(Math.random() * 150) + 20;

    res.json({ success: true, message: '✅ Team saved. Contest joined for free!' });
  } catch (error) {
    console.error('Save team error:', error.message);
    res.status(500).json({ error: 'Failed to save team' });
  }
});

// Get user team
app.get('/get-team', (req, res) => {
  try {
    const userId = Object.keys(users)[0] || 'demo_user';
    const user = users[userId];
    res.json(user?.team || []);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load team' });
  }
});

// Leaderboard
app.get('/leaderboard', (req, res) => {
  try {
    const leaderboard = Object.entries(users)
      .filter(([_, user]) => user.joined)
      .map(([userId, user]) => ({
        userId: userId.slice(0, 8) + '...',
        points: user.points || 0
      }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 10);

    res.json(leaderboard);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// Prize pool
app.get('/prize-pool', (req, res) => {
  try {
    const totalFST = globalEntries * FST_PER_ENTRY;
    res.json({ fst: totalFST, entries: globalEntries });
  } catch (error) {
    res.status(500).json({ error: 'Failed to calculate prize pool' });
  }
});

// Catch-all for SPA
app.get('*', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ FST Fantasy Server running on port ${PORT}`);
  console.log(`🌐 Visit: http://localhost:${PORT}`);
  console.log(`🩺 Health check: http://localhost:${PORT}/health`);
});
