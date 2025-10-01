// server.js — FINAL: BUDGET (75€) & FREE TRANSFERS FIXED
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

// User Schema - FIXED: Budget 75€ and Free Transfers persistence
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
  team: [{ type: Number, length: 11 }], // 11 players max
  wildBenchPlayer: { type: Number, default: null }, // 12th player for Wild Bench
  points: { type: Number, default: 0 }, // Current gameweek points
  totalPoints: { type: Number, default: 0 }, // Season total points
  entries: { type: Number, default: 0 },
  joined: { type: Boolean, default: false },
  locked: { type: Boolean, default: false },
  currentGameweek: { type: Number, default: 1 },
  lastUpdated: { type: Date, default: Date.now },
  budget: { type: Number, default: 75.0 }, // Budget tracking (75€)
  freeTransfers: { type: Number, default: 1 }, // Free transfers per gameweek (PERSISTENT)
  lastTransferGameweek: { type: Number, default: 1 },
  
  // WILDCARD SYSTEM
  wildcardUsed: { type: Boolean, default: false },
  wildcardGameweek: { type: Number, default: null },
  
  // TRIPLE CAPTAIN SYSTEM
  tripleCaptainUsed: { type: Boolean, default: false },
  tripleCaptainGameweek: { type: Number, default: null },
  captainId: { type: Number, default: null },
  
  // WILD BENCH SYSTEM
  wildBenchUsed: { type: Boolean, default: false },
  wildBenchGameweek: { type: Number, default: null },
  
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

// Connect Wallet - FIXED: Budget set to 75.0
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
        budget: 75.0, // FIXED: Set budget to 75.0
        freeTransfers: 1, // Start with 1 free transfer
        lastTransferGameweek: 1,
        wildcardUsed: false,
        wildcardGameweek: null,
        tripleCaptainUsed: false,
        tripleCaptainGameweek: null,
        captainId: null,
        wildBenchUsed: false,
        wildBenchGameweek: null,
        wildBenchPlayer: null
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({
      success: true,
      userId: user.telegramId,
      managerName: user.managerName,
      budget: user.budget,
      freeTransfers: user.freeTransfers,
      wildcardUsed: user.wildcardUsed,
      tripleCaptainUsed: user.tripleCaptainUsed,
      wildBenchUsed: user.wildBenchUsed
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

// Save Team — FIXED: Budget 75€ and proper free transfers
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

    // Get player costs from API
    let totalCost = 0;
    const teamCounts = {};
    
    for (const playerId of team) {
      try {
        const response = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${playerId}/`, {
          timeout: 5000
        });
        const player = response.data;
        totalCost += parseFloat(player.now_cost / 10) || 5.0;
        
        // Track player count per team
        const teamId = player.team;
        teamCounts[teamId] = (teamCounts[teamId] || 0) + 1;
        
        // Check 2-player limit
        if (teamCounts[teamId] > 2) {
          const teamName = player.team_name || `Team ${teamId}`;
          return res.status(400).json({ 
            error: `Cannot select more than 2 players from ${teamName}`
          });
        }
      } catch (e) {
        totalCost += 5.0;
      }
    }

    // Calculate total cost - FIXED: Budget 75€
    if (totalCost > 75) {
      return res.status(400).json({ 
        error: `Team budget exceeded! Total: £${totalCost.toFixed(1)}m (max £75m)`,
        remaining: (75 - totalCost).toFixed(1)
      });
    }

    const user = await User.findOne({ telegramId: userId });
    if (!user) return res.status(404).json({ error: 'Join contest first' });
    if (user.locked) return res.status(400).json({ error: 'Team already submitted' });

    user.team = team;
    user.locked = true;
    user.entries += 1;
    user.points = 0;
    user.budget = 75.0 - totalCost; // FIXED: Budget calculation based on 75€
    user.lastUpdated = new Date();
    await user.save();

    res.json({ 
      success: true, 
      message: '✅ Team locked in!',
      budget: user.budget
    });
  } catch (error) {
    console.error('Save error:', error.message);
    res.status(500).json({ error: 'Failed to save team' });
  }
});

// Transfer Player — FIXED: Proper free transfers persistence
app.post('/transfer-player', async (req, res) => {
  try {
    const { userId, oldPlayerId, newPlayerId } = req.body;
    if (!userId || !oldPlayerId || !newPlayerId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const user = await User.findOne({ telegramId: userId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.locked) return res.status(400).json({ error: 'Team not submitted' });

    // Check if team is complete
    if (!user.team || user.team.length !== 11) {
      return res.status(400).json({ error: 'Team not complete' });
    }

    // Check if player is in team
    const oldPlayerIndex = user.team.indexOf(parseInt(oldPlayerId));
    if (oldPlayerIndex === -1) {
      return res.status(400).json({ error: 'Player not in your team' });
    }

    // Get player costs from API
    let oldPlayerCost = 0;
    let newPlayerCost = 0;
    let newPlayerTeam = null;
    
    try {
      const response = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${oldPlayerId}/`, {
        timeout: 5000
      });
      oldPlayerCost = parseFloat(response.data.now_cost / 10) || 5.0;
    } catch (e) {
      oldPlayerCost = 5.0;
    }
    
    try {
      const response = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${newPlayerId}/`, {
        timeout: 5000
      });
      newPlayerCost = parseFloat(response.data.now_cost / 10) || 5.0;
      newPlayerTeam = response.data.team;
    } catch (e) {
      newPlayerCost = 5.0;
    }

    // Calculate new budget - FIXED: Budget 75€
    const budgetChange = newPlayerCost - oldPlayerCost;
    const newBudget = user.budget - budgetChange;
    
    // Check budget - FIXED: Budget 75€
    if (newBudget < 0) {
      return res.status(400).json({ 
        error: `Cannot afford this transfer! Need £${(-newBudget).toFixed(1)}m more`,
        remaining: newBudget.toFixed(1)
      });
    }

    // Check transfer rules
    if (user.currentGameweek !== user.lastTransferGameweek) {
      // Reset transfers at new gameweek
      user.freeTransfers = 1;
      user.lastTransferGameweek = user.currentGameweek;
      await user.save(); // FIXED: Save the reset
    }

    // WILDCARD CHECK
    const isWildcardActive = user.wildcardUsed && user.wildcardGameweek === user.currentGameweek;
    
    let penaltyPoints = 0;
    let transferMade = true;
    
    // Only apply free transfer logic if wildcard is NOT active
    if (!isWildcardActive) {
      if (user.freeTransfers < 1) {
        // -4 points penalty for extra transfers
        penaltyPoints = 4;
        user.points = Math.max(0, user.points - 4);
        user.markModified('points');
      }
    } else {
      // Wildcard is active - unlimited transfers
      // No penalty, no free transfer deduction needed
      user.freeTransfers = 1; // Keep free transfers at 1 to show active wildcard
    }

    // Check 2-player team limit
    const currentTeam = [...user.team];
    currentTeam[oldPlayerIndex] = parseInt(newPlayerId);
    
    // Count players per team
    const teamCounts = {};
    for (const playerId of currentTeam) {
      try {
        const response = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${playerId}/`, {
          timeout: 5000
        });
        const teamId = response.data.team;
        teamCounts[teamId] = (teamCounts[teamId] || 0) + 1;
        
        // Check if we're over the limit
        if (teamCounts[teamId] > 2) {
          const teamName = response.data.team_name || `Team ${teamId}`;
          return res.status(400).json({ 
            error: `Cannot select more than 2 players from ${teamName}`
          });
        }
      } catch (e) {
        // If API fails, skip this check
        continue;
      }
    }

    // Perform transfer
    user.team[oldPlayerIndex] = parseInt(newPlayerId);
    user.budget = newBudget;
    
    // Only decrement free transfers if wildcard is NOT active
    if (!isWildcardActive) {
      if (user.freeTransfers > 0) {
        user.freeTransfers -= 1;
        user.markModified('freeTransfers'); // CRITICAL: Mark as modified
      }
    }

    user.lastUpdated = new Date();
    await user.save(); // FIXED: Save the user with updated freeTransfers

    res.json({
      success: true,
      message: penaltyPoints > 0 ? 
        '✅ Player transferred! (Penalty: -4 points)' : 
        isWildcardActive ? 
          '✅ Player transferred! (Wildcard active)' : 
          '✅ Player transferred!',
      budget: user.budget,
      freeTransfers: user.freeTransfers,
      points: user.points,
      wildcardActive: isWildcardActive
    });
  } catch (error) {
    console.error('Transfer error:', error.message);
    res.status(500).json({ error: 'Failed to transfer player' });
  }
});

// ACTIVATE WILDCARD - NO CHANGES NEEDED
app.post('/activate-wildcard', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    const user = await User.findOne({ telegramId: userId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.wildcardUsed) return res.status(400).json({ error: 'Wildcard already used' });
    if (user.locked === false) return res.status(400).json({ error: 'Team must be submitted to use wildcard' });

    // Activate wildcard for current gameweek
    user.wildcardUsed = true;
    user.wildcardGameweek = user.currentGameweek;
    await user.save();

    res.json({
      success: true,
      message: '✅ Wildcard activated! Unlimited transfers for this gameweek',
      wildcardActive: true
    });
  } catch (error) {
    console.error('Wildcard error:', error.message);
    res.status(500).json({ error: 'Failed to activate wildcard' });
  }
});

// ACTIVATE TRIPLE CAPTAIN - NO CHANGES NEEDED
app.post('/activate-triple-captain', async (req, res) => {
  try {
    const { userId, captainId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID required' });
    if (!captainId) return res.status(400).json({ error: 'Captain ID required' });

    const user = await User.findOne({ telegramId: userId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.tripleCaptainUsed) return res.status(400).json({ error: 'Triple Captain already used' });
    if (user.locked === false) return res.status(400).json({ error: 'Team must be submitted to use Triple Captain' });
    if (!user.team.includes(captainId)) return res.status(400).json({ error: 'Captain must be in your team' });

    // Set captain and activate Triple Captain for current gameweek
    user.captainId = captainId;
    user.tripleCaptainUsed = true;
    user.tripleCaptainGameweek = user.currentGameweek;
    await user.save();

    res.json({
      success: true,
      message: '✅ Triple Captain activated! Captain points will be tripled this gameweek',
      tripleCaptainActive: true
    });
  } catch (error) {
    console.error('Triple Captain error:', error.message);
    res.status(500).json({ error: 'Failed to activate Triple Captain' });
  }
});

// ACTIVATE WILD BENCH - NO CHANGES NEEDED
app.post('/activate-wild-bench', async (req, res) => {
  try {
    const { userId, wildBenchPlayerId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID required' });
    if (!wildBenchPlayerId) return res.status(400).json({ error: 'Wild Bench player ID required' });

    const user = await User.findOne({ telegramId: userId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.wildBenchUsed) return res.status(400).json({ error: 'Wild Bench already used' });
    if (user.locked === false) return res.status(400).json({ error: 'Team must be submitted to use Wild Bench' });
    if (user.team.includes(parseInt(wildBenchPlayerId))) return res.status(400).json({ error: 'Wild Bench player must be different from your team' });

    // Check 2-player team limit for Wild Bench player
    try {
      const response = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${wildBenchPlayerId}/`, {
        timeout: 5000
      });
      const player = response.data;
      const currentTeam = [...user.team];
      
      // Count players per team including the Wild Bench player
      const teamCounts = {};
      for (const playerId of currentTeam) {
        try {
          const playerResponse = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${playerId}/`, {
            timeout: 5000
          });
          const teamId = playerResponse.data.team;
          teamCounts[teamId] = (teamCounts[teamId] || 0) + 1;
        } catch (e) {
          // If API fails, skip this check
          continue;
        }
      }
      
      // Add the Wild Bench player
      const wildBenchTeam = player.team;
      teamCounts[wildBenchTeam] = (teamCounts[wildBenchTeam] || 0) + 1;
      
      if (teamCounts[wildBenchTeam] > 2) {
        const teamName = player.team_name || `Team ${wildBenchTeam}`;
        return res.status(400).json({ 
          error: `Cannot select more than 2 players from ${teamName}`
        });
      }
    } catch (e) {
      // If API fails, allow the Wild Bench activation
      console.error("Failed to check Wild Bench team limit:", e);
    }

    // Set Wild Bench player and activate for current gameweek
    user.wildBenchPlayer = wildBenchPlayerId;
    user.wildBenchUsed = true;
    user.wildBenchGameweek = user.currentGameweek;
    await user.save();

    res.json({
      success: true,
      message: '✅ Wild Bench activated! 12th player will score this gameweek',
      wildBenchActive: true
    });
  } catch (error) {
    console.error('Wild Bench error:', error.message);
    res.status(500).json({ error: 'Failed to activate Wild Bench' });
  }
});

// Update Team Points
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

    // Check if Wild Bench is active
    const isWildBenchActive = user.wildBenchUsed && user.wildBenchGameweek === user.currentGameweek;
    
    // Check if Triple Captain is active
    const isTripleCaptainActive = user.tripleCaptainUsed && user.tripleCaptainGameweek === user.currentGameweek;
    
    // Get all players (starting 11 + Wild Bench)
    const allPlayerIds = [...user.team];
    if (isWildBenchActive && user.wildBenchPlayer) {
      allPlayerIds.push(user.wildBenchPlayer);
    }

    // Fetch stats for each player
    for (const playerId of allPlayerIds) {
      try {
        const response = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${playerId}/`, {
          timeout: 5000
        });
        
        const data = response.data;
        const latestGW = data.history.sort((a, b) => b.round - a.round)[0];
        
        let points = latestGW?.total_points || 0;
        
        // Triple Captain logic
        if (isTripleCaptainActive && playerId === user.captainId) {
          points *= 3;
        }
        
        totalPoints += points;
        
        playerStats.push({
          player_id: playerId,
          points: points,
          minutes: latestGW?.minutes || 0,
          goals: latestGW?.goals_scored || 0,
          assists: latestGW?.assists || 0,
          clean_sheets: latestGW?.clean_sheets || 0,
          bonus: latestGW?.bonus || 0,
          wildBenchActive: isWildBenchActive,
          isWildBenchPlayer: isWildBenchActive && playerId === user.wildBenchPlayer,
          tripleCaptainActive: isTripleCaptainActive,
          isCaptain: playerId === user.captainId
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
          wildBenchActive: isWildBenchActive,
          isWildBenchPlayer: isWildBenchActive && playerId === user.wildBenchPlayer,
          tripleCaptainActive: isTripleCaptainActive,
          isCaptain: false
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
      playerStats: playerStats,
      wildBenchActive: isWildBenchActive
    });
  } catch (error) {
    console.error('Update points error:', error.message);
    res.status(500).json({ error: 'Failed to update points' });
  }
});

// Get User Profile - NO CHANGES NEEDED
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
      wildBenchPlayer: user.wildBenchPlayer,
      points: user.points,
      totalPoints: user.totalPoints,
      entries: user.entries,
      locked: user.locked,
      joined: user.joined,
      currentGameweek: user.currentGameweek,
      lastUpdated: user.lastUpdated,
      budget: user.budget,
      freeTransfers: user.freeTransfers,
      wildcardUsed: user.wildcardUsed,
      wildcardGameweek: user.wildcardGameweek,
      tripleCaptainUsed: user.tripleCaptainUsed,
      tripleCaptainGameweek: user.tripleCaptainGameweek,
      captainId: user.captainId,
      wildBenchUsed: user.wildBenchUsed,
      wildBenchGameweek: user.wildBenchGameweek
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
