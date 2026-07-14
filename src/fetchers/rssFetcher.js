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
// ESTRATÉGIA: Google News para manchetes (sem imagem)
//             Gazeta Esportiva RSS direto (com imagem)
//             Para itens do Google News: extrai URL real do campo <guid>
//             e busca og:image apenas para domínios conhecidos
const SOURCES = [
  // ── Google News: agrega GE, NE10, Lance, etc. (manchetes, sem imagem direta) ──
  {
    name:   'Náutico',
    url:    'https://news.google.com/rss/search?q=%22N%C3%A1utico+Capibaribe%22+futebol&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color:  '#C8102E',
    filter: false,
    isGoogleNews: true,
  },
  {
    name:   'Série B',
    url:    'https://news.google.com/rss/search?q=Nautico+%22Serie+B%22+futebol&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color:  '#0066CC',
    filter: false,
    isGoogleNews: true,
  },
  // ── RSS diretos: incluem imagem no próprio feed ──────────────────────────────
  {
    name:   'Gazeta Esportiva',
    url:    'https://www.gazetaesportiva.com/tag/nautico/feed/',
    color:  '#1B5E20',
    filter: false,
    isGoogleNews: false,
  },
  {
    name:   'Gazeta — Série B',
    url:    'https://www.gazetaesportiva.com/tag/brasileirao-serie-b/feed/',
    color:  '#0066CC',
    filter: true,
    isGoogleNews: false,
  },
  {
    name:   'Torcedores',
    url:    'https://www.torcedores.com/feed/nautico',
    color:  '#E65100',
    filter: false,
    isGoogleNews: false,
  },
  {
    name:   'Folha PE',
    url:    'https://www.folhape.com.br/rss/esportes/',
    color:  '#880E4F',
    filter: true,
    isGoogleNews: false,
  },
];

const KEYWORDS = ['náutico', 'nautico', 'timbu', 'capibaribe', 'série b', 'serie b'];

// Logos dos veículos de imprensa — fallback quando sem imagem no RSS
const SOURCE_LOGOS = {
  'Globo Esporte':    'https://s.glbimg.com/es/ge/f/original/2013/07/04/ge_logo.png',
  'ge.globo.com':     'https://s.glbimg.com/es/ge/f/original/2013/07/04/ge_logo.png',
  'NE10':             'https://ne10.uol.com.br/favicon.ico',
  'ne10.uol.com.br':  'https://ne10.uol.com.br/favicon.ico',
  'Lance!':           'https://www.lance.com.br/favicon.ico',
  'lance.com.br':     'https://www.lance.com.br/favicon.ico',
  'Folha de Pernambuco': 'https://www.folhape.com.br/favicon.ico',
  'folhape.com.br':   'https://www.folhape.com.br/favicon.ico',
  'Diário de Pernambuco': 'https://www.diariodepernambuco.com.br/favicon.ico',
  'Torcedores':       'https://www.torcedores.com/favicon.ico',
  'torcedores.com':   'https://www.torcedores.com/favicon.ico',
  'UOL Esporte':      'https://conteudo.imguol.com.br/c/esporte/layout/1.0/img/uol-esporte-share.png',
  'uol.com.br':       'https://conteudo.imguol.com.br/c/esporte/layout/1.0/img/uol-esporte-share.png',
};

// Imagem padrão do Náutico para quando não há logo da fonte
const NAUTICO_DEFAULT_IMAGE = 'https://s.sde.globo.com/media/organizations/2019/01/03/Nautico.svg';

function getSourceLogo(sourceName) {
  if (!sourceName) return NAUTICO_DEFAULT_IMAGE;
  // Tenta match exato
  if (SOURCE_LOGOS[sourceName]) return SOURCE_LOGOS[sourceName];
  // Tenta match parcial (domínio dentro do nome)
  for (const [key, url] of Object.entries(SOURCE_LOGOS)) {
    if (sourceName.toLowerCase().includes(key.toLowerCase()) ||
        key.toLowerCase().includes(sourceName.toLowerCase())) {
      return url;
    }
  }
  return NAUTICO_DEFAULT_IMAGE;
}

// ─── fetchAll ──────────────────────────────────────────────────
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

  // Busca og:image para todos os itens que:
  // 1. Têm apenas logo/fallback como imagem (favicon, svg do Náutico, logo GE)
  // 2. Têm link real (não google.com)
  const FALLBACK_PATTERNS = ['favicon', 'Nautico.svg', 'ge_logo', 'lance.com.br/favicon'];
  const needsImage = items.filter(i =>
    i.link &&
    !i.link.includes('google.com') &&
    (!i.image || FALLBACK_PATTERNS.some(p => i.image.includes(p)))
  );

  if (needsImage.length > 0) {
    console.log(`  Buscando og:image para ${needsImage.length} itens com link real...`);
    await processInBatches(needsImage, 8, item => fetchOgImage(item));
    const withRealImage = items.filter(i =>
      i.image && !FALLBACK_PATTERNS.some(p => i.image.includes(p))
    ).length;
    console.log(`  Com imagem real: ${withRealImage}/${items.length}`);
  }

  return items;
}

// ─── Parse feed RSS ────────────────────────────────────────────
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

    // Para Google News: decodifica a URL real do token base64
    let link = entry.link || entry.guid || '';
    if (source.isGoogleNews) {
      const decoded = decodeGoogleNewsUrl(link);
      if (decoded) link = decoded;
    }

    // Tenta pegar imagem do RSS; se não tiver, usa logo do veículo
    const imageFromRss = extractImageFromEntry(entry);

    items.push({
      title,
      link,
      description: cleanHtml(entry.contentSnippet || ''),
      image:       imageFromRss || getSourceLogo(sourceName),
      date:        entry.isoDate || null,
      source:      sourceName,
      color:       source.color,
    });
  }

  return items;
}

/**
 * Decodifica o link real do Google News a partir do token base64 no item.
 * Os links do Google News têm formato: CBMi[BASE64_URL]
 * O BASE64 contém a URL real do artigo.
 */
function decodeGoogleNewsUrl(googleUrl) {
  if (!googleUrl || !googleUrl.includes('news.google.com')) return null;
  try {
    // Extrai o token do path: /rss/articles/TOKEN ou /articles/TOKEN
    const match = googleUrl.match(/articles\/([A-Za-z0-9_-]+)/);
    if (!match) return null;

    const token = match[1];
    // O token começa com CBMi — os bytes seguintes são a URL em base64
    // Formato: 0A + length_byte + URL_bytes
    // Decodifica base64url para buffer
    const base64 = token
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const buf = Buffer.from(base64, 'base64');

    // Procura por http dentro do buffer
    const str = buf.toString('utf8');
    const urlMatch = str.match(/(https?:\/\/[^\x00-\x1f\s"<>]+)/);
    if (urlMatch) return urlMatch[1];
  } catch (_) {}
  return null;
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
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MaisNauticoBot/1.0)' },
      timeout: 5000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return resolve(resolveRedirects(next, maxRedirects - 1));
      }
      resolve(url);
    });
    req.on('error', () => resolve(url));
    req.on('timeout', () => { req.destroy(); resolve(url); });
    req.end();
  });
}

// ─── Busca og:image da URL real ────────────────────────────────
async function fetchOgImage(item) {
  // Só tenta buscar se o link já é uma URL real (não Google News)
  if (!item.link || item.link.includes('google.com')) return;
  try {
    const html = await fetchHead(item.link, 12000, 8000);
    if (!html) return;
    const image = extractOgImage(html);
    if (image) item.image = image;
  } catch (_) {}
}

/**
 * Faz GET seguindo redirecionamentos e retorna primeiros maxBytes do HTML.
 */
function fetchHead(url, maxBytes, timeout, depth = 0) {
  if (depth > 5) return Promise.resolve(null);
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      timeout,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        req.destroy();
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return resolve(fetchHead(next, maxBytes, timeout, depth + 1));
      }
      let data = '';
      res.on('data', chunk => {
        data += chunk.toString();
        if (data.length >= maxBytes) { req.destroy(); resolve(data); }
      });
      res.on('end', () => resolve(data));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function extractOgImage(html) {
  if (!html) return null;
  // og:image
  let m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
       || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (m && isValidImage(m[1])) return m[1];
  // twitter:image
  m = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
  if (m && isValidImage(m[1])) return m[1];
  return null;
}

function isValidImage(url) {
  if (!url) return false;
  if (url.startsWith('data:')) return false;
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

async function processInBatches(items, batchSize, fn) {
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.allSettled(items.slice(i, i + batchSize).map(fn));
  }
}

module.exports = { fetchAll };
