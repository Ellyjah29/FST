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
  mode: { type: String, default: 'league' },
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

// === PLAYERS ENDPOINT (LIVE EPL DATA ONLY) ===
app.get('/players', async (req, res) => {
  const league = req.query.league || 'epl';
  
  // Only support EPL for live data
  if (league !== 'epl') {
    return res.status(400).json({ error: 'Only EPL data is available' });
  }

  try {
    // Add proper headers to avoid FPL API blocking
    const response = await axios.get('https://fantasy.premierleague.com/api/bootstrap-static/', {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://fantasy.premierleague.com/'
      }
    });

    const data = response.data;
    
    // Map teams for easy lookup
    const teamMap = {};
    data.teams.forEach(team => {
      teamMap[team.id] = {
        id: team.id,
        name: team.name,
        short_name: team.short_name,
        code: team.code
      };
    });

    // Process players
    const players = data.elements.map(player => {
      const position = ["GK", "DEF", "MID", "FWD"][player.element_type - 1] || "UNK";
      
      // Format photo URL correctly (no space after p)
      const photoId = player.photo.replace('.jpg', '');
      const photoUrl = `https://resources.premierleague.com/premierleague/photos/players/110x140/p${photoId}.png`;
      
      return {
        id: player.id,
        web_name: player.web_name,
        team: player.team,
        team_id: player.team,
        team_name: teamMap[player.team]?.name || 'Unknown',
        team_short: teamMap[player.team]?.short_name || 'UNK',
        element_type: player.element_type,
        position: position,
        now_cost: (player.now_cost / 10).toFixed(1),
        total_points: player.total_points,
        points_per_game: player.points_per_game,
        form: player.form,
        selected_by_percent: player.selected_by_percent,
        goals_scored: player.goals_scored,
        assists: player.assists,
        clean_sheets: player.clean_sheets,
        saves: player.saves,
        bonus: player.bonus,
        bps: player.bps,
        influence: player.influence,
        creativity: player.creativity,
        threat: player.threat,
        ict_index: player.ict_index,
        starts: player.starts,
        expected_goal_involvements: player.expected_goal_involvements,
        expected_goals: player.expected_goals,
        expected_assists: player.expected_assists,
        expected_goal_conceded: player.expected_goal_conceded,
        chance_of_playing_this_round: player.chance_of_playing_this_round,
        chance_of_playing_next_round: player.chance_of_playing_next_round,
        news: player.news,
        status: player.status,
        photo_url: photoUrl,
        league: 'epl'
      };
    });

    res.json(players);
  } catch (error) {
    console.error('FPL API Error:', error.message);
    console.error('Error details:', error.response ? error.response.data : 'No response data');
    
    // Return detailed error for debugging
    if (error.response) {
      res.status(error.response.status).json({
        error: `FPL API error: ${error.response.status}`,
        details: error.response.data,
        message: "Could not fetch EPL data from FPL API."
      });
    } else {
      res.status(500).json({
        error: "Network error",
        message: "Could not connect to FPL API. Check your internet connection."
      });
    }
  }
});

// === SAVE TEAM (WITH VERIFICATION) ===
app.post('/save-team', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!verifyTelegramData(initData)) {
      return res.status(401).json({ error: 'Invalid Telegram data' });
    }

    const { team } = req.body;
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
      { team, points, joined: true },
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

// === LIVE SCORES (LIVE FROM FPL) ===
app.get('/api/live', async (req, res) => {
  try {
    const response = await axios.get('https://fantasy.premierleague.com/api/fixtures/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    
    const matches = response.data
      .filter(match => match.status === 'n' || match.status === '1h' || match.status === 'ht' || match.status === '2h')
      .map(match => ({
        id: match.id,
        home: match.team_h_name,
        away: match.team_a_name,
        homeScore: match.team_h_score || 0,
        awayScore: match.team_a_score || 0,
        status: match.status,
        live: ['1h', 'ht', '2h'].includes(match.status)
      }));
    
    res.json(matches);
  } catch (error) {
    console.error('Live scores error:', error);
    res.status(500).json({ error: 'Could not fetch live scores' });
  }
});

// === LEAGUE TABLE (LIVE FROM FPL) ===
app.get('/api/table', async (req, res) => {
  try {
    const response = await axios.get('https://fantasy.premierleague.com/api/bootstrap-static/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    
    const standings = response.data.teams
      .map(team => ({
        pos: team.position,
        team: team.name,
        played: team.played,
        gd: team.form,
        points: team.points,
        form: team.form
      }))
      .sort((a, b) => a.pos - b.pos);
    
    res.json(standings);
  } catch (error) {
    console.error('Table error:', error);
    res.status(500).json({ error: 'Could not fetch league table' });
  }
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
