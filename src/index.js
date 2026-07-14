const express   = require('express');
const cors      = require('cors');
const NodeCache = require('node-cache');
const rssFetcher = require('./fetchers/rssFetcher');

const app   = express();
const cache = new NodeCache({ stdTTL: 600 }); // cache 10 minutos

app.use(cors());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Endpoint de notícias
app.get('/noticias', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  const cached = cache.get('noticias');
  if (cached) {
    console.log(`[cache] ${cached.length} itens`);
    return res.json(cached.slice(0, limit));
  }

  try {
    const items = await rssFetcher.fetchAll();

    // Deduplica por link
    const seen   = new Set();
    const unique = items.filter(item => {
      if (!item.link || seen.has(item.link)) return false;
      seen.add(item.link);
      return true;
    });

    // Ordena por data
    unique.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date) - new Date(a.date);
    });

    cache.set('noticias', unique);
    console.log(`[ok] ${unique.length} notícias`);
    res.json(unique.slice(0, limit));

  } catch (err) {
    console.error('[erro]', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Mais Náutico API na porta ${PORT}`);
});
