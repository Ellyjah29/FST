
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 10000;

// 👇 ALLOW ONLY YOUR FRONTEND (SECURITY BEST PRACTICE)
app.use(cors({
  origin: ['https://fst-ncu5.onrender.com'], // ✅ Your live frontend URL
  methods: ['GET'],
  allowedHeaders: ['Content-Type']
}));

app.get('/api/fpl', async (req, res) => {
  const { path = '/bootstrap-static/' } = req.query;

  // Basic path validation
  if (!path.startsWith('/')) {
    return res.status(400).json({ error: 'Path must start with /' });
  }

  try {
    const fplUrl = `https://fantasy.premierleague.com/api${path}`;
    const response = await fetch(fplUrl, {
      headers: {
        'User-Agent': 'FST-Web3-App/1.0',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `FPL API returned ${response.status}` 
      });
    }

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error('🚨 Proxy Error:', error.message);
    res.status(500).json({ error: 'Internal proxy error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'FST FPL Proxy is running!' });
});

app.listen(PORT, () => {
  console.log(`✅ FST FPL Proxy is LIVE on port ${PORT}`);
  console.log(`🌍 Allow origin: https://fst-ncu5.onrender.com`);
});
