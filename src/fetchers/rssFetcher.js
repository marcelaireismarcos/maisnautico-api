const Parser = require('rss-parser');
const https  = require('https');
const http   = require('http');

const parser = new Parser({
  timeout: 20000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; MaisNauticoBot/1.0)',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
  customFields: {
    item: [
      ['media:content',   'mediaContent',   { keepArray: false }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: false }],
      ['enclosure',       'enclosure'],
    ],
  },
});

// ─── Fontes ───────────────────────────────────────────────────
const SOURCES = [
  {
    name:   'Náutico',
    url:    'https://news.google.com/rss/search?q=%22N%C3%A1utico+Capibaribe%22+futebol&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color:  '#C8102E',
    filter: false,
  },
  {
    name:   'Série B',
    url:    'https://news.google.com/rss/search?q=Nautico+%22Serie+B%22+futebol&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color:  '#0066CC',
    filter: false,
  },
  {
    name:   'Timbu',
    url:    'https://news.google.com/rss/search?q=Timbu+futebol+Recife&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color:  '#9B0020',
    filter: false,
  },
  {
    name:   'Gazeta Esportiva',
    url:    'https://www.gazetaesportiva.com/tag/nautico/feed/',
    color:  '#1B5E20',
    filter: false,
  },
  {
    name:   'Gazeta — Série B',
    url:    'https://www.gazetaesportiva.com/tag/brasileirao-serie-b/feed/',
    color:  '#0066CC',
    filter: true,
  },
];

const KEYWORDS = ['náutico', 'nautico', 'timbu', 'capibaribe', 'série b', 'serie b'];

// ─── fetchAll ─────────────────────────────────────────────────
async function fetchAll() {
  const results = await Promise.allSettled(SOURCES.map(s => fetchOne(s)));

  const items = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      console.log(`  [${SOURCES[i].name}] ${r.value.length} itens`);
      items.push(...r.value);
    } else {
      console.warn(`  [${SOURCES[i].name}] falhou: ${r.reason?.message}`);
    }
  });

  // Busca imagens em paralelo para itens sem imagem (máx 10 por vez)
  const withoutImage = items.filter(i => !i.image).slice(0, 15);
  if (withoutImage.length > 0) {
    console.log(`  Buscando imagens para ${withoutImage.length} itens...`);
    await Promise.allSettled(
      withoutImage.map(item => fetchOgImage(item))
    );
  }

  return items;
}

async function fetchOne(source) {
  const feed  = await parser.parseURL(source.url);
  const items = [];

  for (const entry of (feed.items || [])) {
    const rawTitle = (entry.title || '').trim();
    if (!rawTitle) continue;

    const combined = rawTitle + ' ' + (entry.contentSnippet || '');
    if (source.filter && !isRelevant(combined)) continue;

    // Google News embute o nome da fonte no título: "Título - Fonte"
    let title      = rawTitle;
    let sourceName = source.name;
    if (rawTitle.includes(' - ')) {
      const idx  = rawTitle.lastIndexOf(' - ');
      title      = rawTitle.substring(0, idx).trim();
      sourceName = rawTitle.substring(idx + 3).trim();
    }

    items.push({
      title,
      link:        entry.link || entry.guid || '',
      description: cleanHtml(entry.contentSnippet || ''),
      image:       extractImageFromEntry(entry),
      date:        entry.isoDate || null,
      source:      sourceName,
      color:       source.color,
    });
  }

  return items;
}

/**
 * Busca a imagem og:image da página do artigo.
 * Modifica o item diretamente (in-place).
 */
async function fetchOgImage(item) {
  if (!item.link) return;
  try {
    const html = await fetchPageHtml(item.link, 3000);
    // og:image é a mais confiável
    let m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (!m) m = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (m && m[1] && !m[1].startsWith('data:')) {
      item.image = m[1];
    }
  } catch (_) {
    // silencioso — sem imagem é ok
  }
}

/**
 * Faz um GET simples e retorna os primeiros 8KB do HTML.
 * Suficiente para encontrar as meta tags no <head>.
 */
function fetchPageHtml(url, timeout) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MaisNauticoBot/1.0)',
        'Accept': 'text/html',
      },
      timeout,
    }, (res) => {
      // Segue redirecionamentos simples
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPageHtml(res.headers.location, timeout).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => {
        data += chunk;
        // Para de ler após 8KB — o <head> está lá
        if (data.length > 8192) {
          req.destroy();
          resolve(data);
        }
      });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ─── Helpers ──────────────────────────────────────────────────
function extractImageFromEntry(entry) {
  if (entry.mediaContent?.$?.url)   return entry.mediaContent.$.url;
  if (entry.mediaThumbnail?.$?.url) return entry.mediaThumbnail.$.url;
  if (entry.enclosure?.url)         return entry.enclosure.url;

  const html = entry['content:encoded'] || entry.content || '';
  const m    = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function isRelevant(text) {
  const lower = text.toLowerCase();
  return KEYWORDS.some(kw => lower.includes(kw));
}

function cleanHtml(text) {
  return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = { fetchAll };
