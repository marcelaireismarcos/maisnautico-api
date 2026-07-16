const Parser = require('rss-parser');
const https  = require('https');
const http   = require('http');

const parser = new Parser({
  timeout: 20000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Mobile) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
  customFields: {
    item: [
      ['media:content',   'mediaContent',   { keepArray: false }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: false }],
      ['enclosure',       'enclosure',      { keepArray: false }],
      ['content:encoded', 'contentEncoded'],
    ],
  },
});

// ─── Fontes de futebol GERAL (sem foco no Náutico) ────────────
const SOURCES = [
  // Brasileirão Série A
  {
    name:  'Série A',
    url:   'https://news.google.com/rss/search?q=Brasileirao+Serie+A+2026&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color: '#C8102E',
  },
  // Copa do Brasil
  {
    name:  'Copa do Brasil',
    url:   'https://news.google.com/rss/search?q=Copa+do+Brasil+2026&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color: '#1565C0',
  },
  // Mercado da bola
  {
    name:  'Mercado da Bola',
    url:   'https://news.google.com/rss/search?q=mercado+da+bola+futebol+brasileiro+2026&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color: '#2E7D32',
  },
  // Copa do Mundo
  {
    name:  'Copa do Mundo',
    url:   'https://news.google.com/rss/search?q=Copa+do+Mundo+2026+futebol&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color: '#6A1B9A',
  },
  // Futebol geral
  {
    name:  'Futebol',
    url:   'https://www.gazetaesportiva.com/feed/',
    color: '#E65100',
    filter: true, // filtra para excluir notícias do Náutico
  },
];

// Palavras-chave que identificam notícias do NÁUTICO (para excluir)
const NAUTICO_KEYWORDS = [
  'náutico', 'nautico', 'timbu', 'capibaribe', 'aflitos'
];

// ─── fetchAll ──────────────────────────────────────────────────
async function fetchAll() {
  const results = await Promise.allSettled(SOURCES.map(s => fetchOne(s)));
  const items = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      console.log(`  [outras/${SOURCES[i].name}] ${r.value.length} itens`);
      items.push(...r.value);
    } else {
      console.warn(`  [outras/${SOURCES[i].name}] falhou: ${r.reason?.message}`);
    }
  });

  // Busca og:image para itens sem imagem com link real
  const withoutImage = items.filter(i =>
    !i.image && i.link && !i.link.includes('news.google.com')
  );
  if (withoutImage.length > 0) {
    await processInBatches(withoutImage, 6, fetchOgImage);
  }

  // Fallback de imagem para itens que ainda não têm
  items.filter(i => !i.image).forEach(i => {
    i.image = getSourceImage(i.source);
  });

  return items;
}

// ─── Parse de um feed ─────────────────────────────────────────
async function fetchOne(source) {
  const feed  = await parser.parseURL(source.url);
  const items = [];

  for (const entry of (feed.items || [])) {
    const rawTitle = (entry.title || '').trim();
    if (!rawTitle) continue;

    // Extrai nome da fonte do Google News ("Título - Fonte")
    let title      = rawTitle;
    let sourceName = source.name;
    const isGN     = source.url.includes('news.google.com');
    if (isGN && rawTitle.includes(' - ')) {
      const idx  = rawTitle.lastIndexOf(' - ');
      title      = rawTitle.substring(0, idx).trim();
      sourceName = rawTitle.substring(idx + 3).trim();
    }

    // Exclui notícias do Náutico — já aparecem no feed principal
    const combined = (title + ' ' + (entry.contentSnippet || '')).toLowerCase();
    if (isNauticoNews(combined)) continue;

    // Filtro adicional para fontes com flag filter
    if (source.filter && isNauticoNews(combined)) continue;

    const image = extractImageFromEntry(entry);
    const link  = entry.link || entry.guid || '';

    items.push({
      title,
      link,
      description: cleanHtml(entry.contentSnippet || ''),
      image,
      date:   entry.isoDate || null,
      source: sourceName,
      color:  source.color,
    });
  }

  return items;
}

// ─── Verifica se é notícia do Náutico ─────────────────────────
function isNauticoNews(text) {
  return NAUTICO_KEYWORDS.some(kw => text.includes(kw));
}

// ─── Busca og:image ───────────────────────────────────────────
async function fetchOgImage(item) {
  if (!item.link || item.link.includes('google.com')) return;
  try {
    const html = await fetchHtmlHead(item.link, 10000, 7000);
    if (!html) return;
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
           || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
           || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    if (m && m[1] && m[1].startsWith('http') && !m[1].startsWith('data:')) {
      item.image = m[1];
    }
  } catch (_) {}
}

// ─── Imagens fallback por fonte ───────────────────────────────
const SOURCE_IMAGES = {
  'Globo Esporte': 'https://s2-ge.glbimg.com/8YZ7shA-uHGoBhzwBPjp3w8bYh8=/1200x630/filters:quality(70)/https://s.sde.globo.com/media/organizations/2019/01/03/Nautico.svg',
  'ESPN Brasil':   'https://a1.espncdn.com/combiner/i?img=%2Fi%2Fespn%2Fespn_logos%2Fespn_red.png&w=1200&h=630&scale=crop&cquality=40&location=origin',
  'Lance!':        'https://www.lance.com.br/wp-content/uploads/2023/01/lance-og.jpg',
  'LANCE!':        'https://www.lance.com.br/wp-content/uploads/2023/01/lance-og.jpg',
  'CNN Brasil':    'https://conteudo.imguol.com.br/c/esporte/layout/1.0/img/uol-esporte-share.png',
};
const DEFAULT_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Campoalegre.jpg/320px-Campoalegre.jpg';

function getSourceImage(sourceName) {
  if (!sourceName) return DEFAULT_IMAGE;
  if (SOURCE_IMAGES[sourceName]) return SOURCE_IMAGES[sourceName];
  for (const [key, url] of Object.entries(SOURCE_IMAGES)) {
    if (sourceName.toLowerCase().includes(key.toLowerCase())) return url;
  }
  return DEFAULT_IMAGE;
}

// ─── Helpers ──────────────────────────────────────────────────
function extractImageFromEntry(entry) {
  const mc = entry.mediaContent;
  if (mc) { const u = mc?.['$']?.url || mc?.url; if (u && u.startsWith('http')) return u; }
  const mt = entry.mediaThumbnail;
  if (mt) { const u = mt?.['$']?.url || mt?.url; if (u && u.startsWith('http')) return u; }
  const enc = entry.enclosure;
  if (enc) { const u = enc?.url || enc?.['$']?.url; if (u && u.startsWith('http')) return u; }
  const html = entry.contentEncoded || entry['content:encoded'] || entry.content || '';
  if (html) { const m = html.match(/<img[^>]+src=["']([^"']+)["']/i); if (m) return m[1]; }
  return null;
}

function fetchHtmlHead(url, maxBytes, timeout, depth = 0) {
  if (depth > 4) return Promise.resolve(null);
  return new Promise(resolve => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
      timeout,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        req.destroy();
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return resolve(fetchHtmlHead(next, maxBytes, timeout, depth + 1));
      }
      let data = '';
      res.on('data', chunk => { data += chunk; if (data.length >= maxBytes) { req.destroy(); resolve(data); } });
      res.on('end', () => resolve(data));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function cleanHtml(text) {
  return (text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

async function processInBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.allSettled(items.slice(i, i + size).map(fn));
  }
}

module.exports = { fetchAll };
