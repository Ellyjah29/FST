// server.js
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Serve static files (your index.html, CSS, JS)
app.use(express.static(path.join(__dirname, '.')));

// Enable CORS for Telegram Mini App and general use
app.use(cors({
  origin: ['https://web.telegram.org', 'https://t.me', 'https://fst-ncu5.onrender.com', 'https://your-app.onrender.com'],
  methods: ['GET'],
  allowedHeaders: ['Content-Type']
}));

// Proxy endpoint for FPL API
app.get('/api/fpl', async (req, res) => {
  const { path: apiPath = '/bootstrap-static/' } = req.query;

  if (!apiPath.startsWith('/')) {
    return res.status(400).json({ error: 'Path must start with /' });
  }

  try {
    const fplUrl = `https://fantasy.premierleague.com/api${apiPath}`;
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
  res.status(200).json({ status: 'OK', message: 'FST All-in-One Server is running!' });
});

// Handle all other routes by serving index.html (for SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ FST All-in-One Server running on port ${PORT}`);
  console.log(`🌍 Access your app at http://localhost:${PORT}`);
  console.log(`🔗 Proxy endpoint: /api/fpl?path=/bootstrap-static/`);
});
