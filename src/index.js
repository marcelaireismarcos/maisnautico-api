// Polyfill Promise.allSettled para Node.js < 12
if (!Promise.allSettled) {
  Promise.allSettled = function(promises) {
    return Promise.all(promises.map(function(p) {
      return p
        .then(function(value) { return { status: 'fulfilled', value: value }; })
        .catch(function(reason) { return { status: 'rejected', reason: reason }; });
    }));
  };
}

const express   = require('express');
const cors      = require('cors');
const NodeCache = require('node-cache');
const rssFetcher    = require('./fetchers/rssFetcher');
const outrasFetcher = require('./fetchers/outrasFetcher');
const newsScraper   = require('./fetchers/newsScraper');

const app   = express();
const cache = new NodeCache({ stdTTL: 300 }); // cache 5 minutos

app.use(cors());

// ─── Helpers ──────────────────────────────────────────────────
const STOP_WORDS = new Set(['o', 'a', 'os', 'as', 'de', 'do', 'da', 'dos', 'das',
  'em', 'no', 'na', 'nos', 'nas', 'que', 'e', 'para', 'por', 'com',
  'um', 'uma', 'ao', 'aos', 'pelo', 'pela', 'se', 'mas', 'ou']);

/** Fingerprint agressivo: remove acentos, stop words, pega 5 palavras significativas */
function titleFingerprint(title) {
  if (!title) return '';
  const s = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = s.split(' ').filter(w => w && !STOP_WORDS.has(w));
  return words.slice(0, 5).join(' ');
}

/** Deduplica por link E por fingerprint do título */
function deduplicate(items) {
  const seenLinks = new Set();
  const seenFingerprints = new Set();
  return items.filter(item => {
    const linkKey = item.link || '';
    const titleKey = titleFingerprint(item.title);
    if (titleKey && seenFingerprints.has(titleKey)) return false;
    if (linkKey && seenLinks.has(linkKey)) return false;
    if (linkKey) seenLinks.add(linkKey);
    if (titleKey) seenFingerprints.add(titleKey);
    return true;
  });
}

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

// Endpoint de notícias do Vitória-BA
app.get('/noticias', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  const cached = cache.get('noticias');
  if (cached) {
    console.log(`[cache] ${cached.length} itens`);
    return res.json(cached.slice(0, limit));
  }

  try {
    // RSS + Scrapers em paralelo
    const [rssItems, scrapedItems] = await Promise.allSettled([
      rssFetcher.fetchAll(),
      newsScraper.fetchAll(),
    ]);

    let items = [];
    if (rssItems.status === 'fulfilled') items.push(...rssItems.value);
    if (scrapedItems.status === 'fulfilled') items.push(...scrapedItems.value);

    console.log(`[merge] RSS: ${rssItems.status === 'fulfilled' ? rssItems.value.length : 0} itens, Scrapers: ${scrapedItems.status === 'fulfilled' ? scrapedItems.value.length : 0} itens`);

    // Deduplica por link E título
    const unique = deduplicate(items);

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

// ─── Endpoint: Outras notícias (futebol geral, sem Vitória-BA) ───
app.get('/outras-noticias', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  const cached = cache.get('outras-noticias');
  if (cached) {
    return res.json(cached.slice(0, limit));
  }

  try {
    const items = await outrasFetcher.fetchAll();

    // Deduplica por link E título
    const unique = deduplicate(items);

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
  console.log(`Mais Vitória-BA API na porta ${PORT}`);
});