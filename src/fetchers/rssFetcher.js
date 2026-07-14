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

// ─── Fontes RSS ────────────────────────────────────────────────
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

// ─── fetchAll ──────────────────────────────────────────────────
async function fetchAll() {
  // 1. Busca todos os feeds RSS
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

  // 2. Para itens sem imagem, busca og:image seguindo redirecionamentos
  const semImagem = items.filter(i => !i.image);
  if (semImagem.length > 0) {
    console.log(`  Buscando imagens para ${semImagem.length} itens...`);
    // Limita a 20 requisições paralelas para não sobrecarregar
    await processInBatches(semImagem, 20, item => fetchOgImage(item));
    const comImagem = items.filter(i => i.image).length;
    console.log(`  Imagens encontradas: ${comImagem}/${items.length}`);
  }

  return items;
}

// ─── Parse de um feed RSS ──────────────────────────────────────
async function fetchOne(source) {
  const feed  = await parser.parseURL(source.url);
  const items = [];

  for (const entry of (feed.items || [])) {
    const rawTitle = (entry.title || '').trim();
    if (!rawTitle) continue;

    const combined = rawTitle + ' ' + (entry.contentSnippet || '');
    if (source.filter && !isRelevant(combined)) continue;

    // Google News: "Título - Nome da Fonte"
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
      image:       extractImageFromEntry(entry), // tenta pegar do RSS primeiro
      date:        entry.isoDate || null,
      source:      sourceName,
      color:       source.color,
    });
  }

  return items;
}

// ─── Busca og:image da página do artigo ───────────────────────
async function fetchOgImage(item) {
  if (!item.link) return;
  try {
    // Passo 1: resolve URL real (Google News redireciona)
    const realUrl = await resolveRedirects(item.link, 5);
    if (!realUrl) return;

    // Passo 2: pega os primeiros 10KB da página
    const html = await fetchHead(realUrl, 10000, 6000);
    if (!html) return;

    // Passo 3: extrai og:image
    const image = extractOgImage(html);
    if (image) item.image = image;

  } catch (_) {
    // silencioso
  }
}

/**
 * Segue redirecionamentos HTTP fazendo apenas HEAD requests.
 * Retorna a URL final (após todos os redirects).
 */
function resolveRedirects(url, maxRedirects) {
  return new Promise((resolve) => {
    if (maxRedirects <= 0) return resolve(url);

    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MaisNauticoBot/1.0)',
      },
      timeout: 5000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        resolve(resolveRedirects(next, maxRedirects - 1));
      } else {
        resolve(url);
      }
    });
    req.on('error', () => resolve(url));
    req.on('timeout', () => { req.destroy(); resolve(url); });
    req.end();
  });
}

/**
 * Faz GET e retorna os primeiros `maxBytes` bytes do HTML.
 */
function fetchHead(url, maxBytes, timeout) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      timeout,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        req.destroy();
        return resolve(fetchHead(res.headers.location, maxBytes, timeout));
      }
      let data = '';
      res.on('data', chunk => {
        data += chunk;
        if (data.length >= maxBytes) {
          req.destroy();
          resolve(data);
        }
      });
      res.on('end', () => resolve(data));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * Extrai og:image, twitter:image ou primeira <img> relevante do HTML.
 */
function extractOgImage(html) {
  if (!html) return null;

  // og:image (mais confiável)
  let m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
       || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (m && isValidImage(m[1])) return m[1];

  // twitter:image
  m = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
  if (m && isValidImage(m[1])) return m[1];

  // Primeira <img> com src razoável (>= 200x200 pelo src — heurística)
  m = html.match(/<img[^>]+src=["'](https?:\/\/[^"']+\.(jpg|jpeg|png|webp)[^"']*)["']/i);
  if (m && isValidImage(m[1])) return m[1];

  return null;
}

function isValidImage(url) {
  if (!url) return false;
  if (url.startsWith('data:')) return false;
  if (url.includes('logo') && url.includes('1x1')) return false;
  return url.startsWith('http');
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

/**
 * Processa um array em lotes de `batchSize` em paralelo.
 */
async function processInBatches(items, batchSize, fn) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(fn));
  }
}

module.exports = { fetchAll };
