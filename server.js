require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const mongoose = require('mongoose');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

// === CONNECT TO MONGODB ===
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// === DATABASE MODELS ===
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  telegramId: { type: Number, sparse: true },
  firstName: String,
  username: String,
  walletAddress: String,
  team: [String],
  league: { type: String, default: 'epl' },
  mode: { type: String, default: 'league' }, // 'league' or 'global'
  points: { type: Number, default: 0 },
  joined: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const statsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Number, default: 0 }
});
const Stats = mongoose.model('Stats', statsSchema);

// === MIDDLEWARE ===
app.use(cors());
app.use(express.json());
app.use(express.static('public', {
  maxAge: '1d',
  etag: true
}));

// === TELEGRAM WEBAPP VERIFICATION ===
function verifyTelegramData(initData) {
  if (!initData) return false;
  const searchParams = new URLSearchParams(initData);
  const hash = searchParams.get('hash');
  if (!hash) return false;

  // Remove hash and sort
  searchParams.delete('hash');
  const entries = [...searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = entries.map(([key, value]) => `${key}=${value}`).join('\n');

  // Generate secret key
  const secret = crypto.createHash('sha256')
    .update(process.env.BOT_TOKEN)
    .digest();
  
  // Calculate hash
  const calculatedHash = crypto.createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');

  return hash === calculatedHash;
}

// === HEALTH CHECK ===
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// === CONNECT WALLET (SECURE) ===
app.post('/connect-wallet', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!verifyTelegramData(initData)) {
      return res.status(401).json({ error: 'Invalid Telegram data signature' });
    }

    const params = new URLSearchParams(initData);
    const userJson = params.get('user');
    if (!userJson) {
      return res.status(400).json({ error: 'User data missing' });
    }

    const telegramUser = JSON.parse(userJson);
    const userId = `tg_${telegramUser.id}`;

    // Simulate wallet address
    const walletAddress = '0x' + userId.padEnd(40, 'a').slice(0, 40);

    // Save or update user
    await User.findOneAndUpdate(
      { userId },
      {
        telegramId: telegramUser.id,
        firstName: telegramUser.first_name,
        username: telegramUser.username,
        walletAddress
      },
      { upsert: true, setDefaultsOnInsert: true }
    );

    res.json({
      success: true,
      address: walletAddress,
      userId
    });
  } catch (error) {
    console.error('Connect wallet error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// === PLAYERS ENDPOINT (SUPPORTS ALL LEAGUES) ===
app.get('/players', async (req, res) => {
  const league = req.query.league || 'epl';
  const validLeagues = ['epl', 'seriea', 'laliga', 'bundesliga', 'wsl', 'euro'];

  if (!validLeagues.includes(league)) {
    return res.status(400).json({ error: 'Invalid league' });
  }

  // Mock players for all leagues (replace with real API later)
  const mockPlayers = [
    { id: `${league}_1`, web_name: "Star Player", team_name: "Top FC", element_type: 4, position: "FWD", now_cost: "12.0", total_points: 200, photo_url: "https://via.placeholder.com/60x75?text=SP", league, goals: 18, assists: 8, clean_sheets: 0, form: "WWDLW" },
    { id: `${league}_2`, web_name: "Midfield Maestro", team_name: "United", element_type: 3, position: "MID", now_cost: "10.5", total_points: 180, photo_url: "https://via.placeholder.com/60x75?text=MM", league, goals: 10, assists: 12, clean_sheets: 0, form: "WDWLW" },
    { id: `${league}_3`, web_name: "Defensive Wall", team_name: "City", element_type: 2, position: "DEF", now_cost: "8.5", total_points: 160, photo_url: "https://via.placeholder.com/60x75?text=DW", league, goals: 2, assists: 5, clean_sheets: 14, form: "LWWWD" },
    { id: `${league}_4`, web_name: "Safe Hands", team_name: "Athletic", element_type: 1, position: "GK", now_cost: "7.0", total_points: 140, photo_url: "https://via.placeholder.com/60x75?text=SH", league, goals: 0, assists: 1, clean_sheets: 16, form: "WWLWW" }
  ];

  res.json(mockPlayers);
});

// === SAVE TEAM (WITH VERIFICATION) ===
app.post('/save-team', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!verifyTelegramData(initData)) {
      return res.status(401).json({ error: 'Invalid Telegram data' });
    }

    const { team, mode = 'league', league = 'epl' } = req.body;
    if (!team || !Array.isArray(team) || team.length !== 11) {
      return res.status(400).json({ error: 'Team must contain exactly 11 player IDs' });
    }

    const params = new URLSearchParams(initData);
    const userJson = params.get('user');
    const telegramUser = JSON.parse(userJson);
    const userId = `tg_${telegramUser.id}`;

    // Simulate points
    const points = Math.floor(Math.random() * 150) + 20;

    // Save team
    await User.findOneAndUpdate(
      { userId },
      { team, mode, league, points, joined: true },
      { new: true }
    );

    // Increment global entries
    await Stats.findOneAndUpdate(
      { key: 'globalEntries' },
      { $inc: { value: 1 } },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: '✅ Team saved. Contest joined!' });
  } catch (error) {
    console.error('Save team error:', error.message);
    res.status(500).json({ error: 'Failed to save team' });
  }
});

// === PRIZE POOL ===
app.get('/prize-pool', async (req, res) => {
  try {
    const stats = await Stats.findOne({ key: 'globalEntries' });
    const entries = stats ? stats.value : 0;
    const fst = entries * 10; // 10 FST per entry
    res.json({ fst, entries });
  } catch (error) {
    console.error('Prize pool error:', error);
    res.status(500).json({ error: 'Failed to fetch prize pool' });
  }
});

// === LEADERBOARDS ===
// League-specific
app.get('/leaderboard', async (req, res) => {
  try {
    const league = req.query.league || 'epl';
    const leaders = await User.find({ joined: true, league })
      .sort({ points: -1 })
      .limit(10)
      .select('userId points');

    const result = leaders.map(user => ({
      userId: user.userId.replace('tg_', '').substring(0, 6) + '...',
      points: user.points
    }));

    res.json(result);
  } catch (error) {
    console.error('League leaderboard error:', error);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// Global leaderboard
app.get('/leaderboard/global', async (req, res) => {
  try {
    const leaders = await User.find({ joined: true })
      .sort({ points: -1 })
      .limit(20)
      .select('userId points league mode');

    const result = leaders.map(user => ({
      userId: user.userId.replace('tg_', '').substring(0, 6) + '...',
      points: user.points,
      league: user.league,
      mode: user.mode
    }));

    res.json(result);
  } catch (error) {
    console.error('Global leaderboard error:', error);
    res.status(500).json({ error: 'Failed to load global leaderboard' });
  }
});

// === LIVE SCORES (MOCK) ===
app.get('/api/live', (req, res) => {
  const matches = [
    { id: 1, home: "Arsenal", away: "Man City", homeScore: 2, awayScore: 1, status: "75'", live: true },
    { id: 2, home: "Liverpool", away: "Chelsea", homeScore: 0, awayScore: 0, status: "HT", live: true }
  ];
  res.json(matches);
});

// === LEAGUE TABLE (MOCK) ===
app.get('/api/table', (req, res) => {
  const table = [
    { pos: 1, team: "Arsenal", played: 38, gd: 62, points: 89, form: "WWWDW" },
    { pos: 2, team: "Man City", played: 38, gd: 61, points: 88, form: "WWWWW" }
  ];
  res.json(table);
});

// === CATCH-ALL FOR SPA ===
app.get('*', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

// === ERROR HANDLING ===
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

// === START SERVER ===
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ FST Fantasy Render App running on port ${PORT}`);
  console.log(`🩺 Health check: http://localhost:${PORT}/health`);
});
