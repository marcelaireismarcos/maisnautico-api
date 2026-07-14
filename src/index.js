/**
 * Mais Náutico — API Server
 *
 * Servidor Node.js que agrega notícias do Náutico Capibaribe
 * de múltiplas fontes e expõe uma API JSON para o app Android.
 *
 * Endpoints:
 *   GET /noticias          → lista de notícias agregadas e ordenadas por data
 *   GET /noticias?limit=N  → limita a N notícias (padrão: 50)
 *   GET /health            → status do servidor
 */

const express  = require('express');
const cors     = require('cors');
const NodeCache = require('node-cache');

const rssFetcher       = require('./fetchers/rssFetcher');
const puppeteerFetcher = require('./fetchers/puppeteerFetcher');

const app   = express();
const cache = new NodeCache({ stdTTL: 900 }); // cache de 15 minutos

// ─── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Endpoint principal ────────────────────────────────────────
app.get('/noticias', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const cacheKey = 'noticias';

  // Retorna do cache se disponível
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[cache HIT] ${cached.length} notícias`);
    return res.json(cached.slice(0, limit));
  }

  console.log('[cache MISS] buscando notícias...');

  try {
    // Busca RSS (rápido) e Puppeteer (lento) em paralelo
    const [rssItems, puppeteerItems] = await Promise.allSettled([
      rssFetcher.fetchAll(),
      puppeteerFetcher.fetchAll(),
    ]);

    let allItems = [];

    if (rssItems.status === 'fulfilled') {
      console.log(`RSS: ${rssItems.value.length} itens`);
      allItems = allItems.concat(rssItems.value);
    } else {
      console.error('RSS falhou:', rssItems.reason?.message);
    }

    if (puppeteerItems.status === 'fulfilled') {
      console.log(`Puppeteer: ${puppeteerItems.value.length} itens`);
      allItems = allItems.concat(puppeteerItems.value);
    } else {
      console.error('Puppeteer falhou:', puppeteerItems.reason?.message);
    }

    // Remove duplicatas por link
    const seen  = new Set();
    const unique = allItems.filter(item => {
      if (!item.link || seen.has(item.link)) return false;
      seen.add(item.link);
      return true;
    });

    // Ordena por data — mais recente primeiro
    unique.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date) - new Date(a.date);
    });

    console.log(`Total: ${unique.length} notícias únicas`);

    // Salva no cache
    cache.set(cacheKey, unique);

    res.json(unique.slice(0, limit));

  } catch (error) {
    console.error('Erro geral:', error.message);
    res.status(500).json({ error: 'Erro ao buscar notícias', detail: error.message });
  }
});

// ─── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mais Náutico API rodando na porta ${PORT}`);
});
