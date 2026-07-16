const express   = require('express');
const cors      = require('cors');
const NodeCache = require('node-cache');
const rssFetcher    = require('./fetchers/rssFetcher');
const outrasFetcher = require('./fetchers/outrasFetcher');

const app   = express();
const cache = new NodeCache({ stdTTL: 300 }); // cache 5 minutos

app.use(cors());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    cache_keys: cache.keys().length
  });
});

// Limpa o cache (útil após deploy)
app.get('/cache/clear', (req, res) => {
  cache.flushAll();
  res.json({ ok: true, message: 'Cache limpo' });
});

// Debug: mostra primeiros 3 itens de cada fonte com campo image
app.get('/debug', async (req, res) => {
  const rssFetcher = require('./fetchers/rssFetcher');
  try {
    const items = await rssFetcher.fetchAll();
    // Agrupa por fonte, mostra só title + image + link
    const bySource = {};
    items.forEach(i => {
      if (!bySource[i.source]) bySource[i.source] = [];
      if (bySource[i.source].length < 3) {
        bySource[i.source].push({
          title: i.title,
          image: i.image,
          link:  i.link ? i.link.substring(0, 80) : null,
        });
      }
    });
    res.json(bySource);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint de notícias do Náutico
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

// ─── Endpoint: Outras notícias (futebol geral, sem Náutico) ───
app.get('/outras-noticias', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  const cached = cache.get('outras-noticias');
  if (cached) {
    return res.json(cached.slice(0, limit));
  }

  try {
    const items = await outrasFetcher.fetchAll();

    const seen   = new Set();
    const unique = items.filter(item => {
      if (!item.link || seen.has(item.link)) return false;
      seen.add(item.link);
      return true;
    });

    unique.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date) - new Date(a.date);
    });

    cache.set('outras-noticias', unique);
    console.log(`[ok] ${unique.length} outras notícias`);
    res.json(unique.slice(0, limit));

  } catch (err) {
    console.error('[erro outras]', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Mais Náutico API na porta ${PORT}`);
});