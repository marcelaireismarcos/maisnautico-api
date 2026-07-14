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

// Domínios que podemos acessar para og:image (sem bloqueio anti-bot)
const ALLOWED_IMAGE_DOMAINS = [
  'gazetaesportiva.com',
  'folhape.com.br',
  'esportesdp.com.br',
  'torcedores.com',
  'ne10.uol.com.br',
  'diariodepernambuco.com.br',
  'lance.com.br',
  'uol.com.br',
];

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

  // Busca imagens para itens sem imagem cujo domínio é acessível
  const semImagem = items.filter(i => !i.image && canFetchImage(i.link));
  if (semImagem.length > 0) {
    console.log(`  Buscando og:image para ${semImagem.length} itens...`);
    await processInBatches(semImagem, 10, item => fetchOgImage(item));
    console.log(`  Com imagem: ${items.filter(i => i.image).length}/${items.length}`);
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

    // Para Google News: o <link> é uma URL do Google — tentamos extrair
    // a URL real a partir do campo source.url ou do conteúdo do item
    let link = entry.link || entry.guid || '';
    if (source.isGoogleNews) {
      // Tenta extrair a URL original do item do Google News
      const realUrl = extractRealUrlFromGoogleNews(entry);
      if (realUrl) link = realUrl;
    }

    items.push({
      title,
      link,
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
 * O Google News RSS inclui a URL real do artigo no campo <source url="...">.
 * Isso é muito mais confiável que tentar seguir o link do Google.
 */
function extractRealUrlFromGoogleNews(entry) {
  // Opção 1: campo source com atributo url
  if (entry['source'] && typeof entry['source'] === 'object') {
    const url = entry['source']['$']?.url || entry['source']?.url;
    if (url && url.startsWith('http') && !url.includes('google.com')) return url;
  }

  // Opção 2: campo origin
  if (entry.origin?.href && !entry.origin.href.includes('google.com')) {
    return entry.origin.href;
  }

  // Opção 3: dentro do conteúdo do item procura um link externo
  const content = entry['content:encoded'] || entry.content || entry.summary || '';
  const m = content.match(/href=["'](https?:\/\/(?!news\.google)[^"']+)["']/i);
  if (m) return m[1];

  return null;
}

// ─── Busca og:image da URL real ────────────────────────────────
async function fetchOgImage(item) {
  if (!item.link || !canFetchImage(item.link)) return;
  try {
    const html = await fetchHead(item.link, 12000, 8000);
    if (!html) return;
    const image = extractOgImage(html);
    if (image) item.image = image;
  } catch (_) {}
}

function canFetchImage(url) {
  if (!url) return false;
  if (url.includes('google.com')) return false; // Google News links não funcionam
  return ALLOWED_IMAGE_DOMAINS.some(d => url.includes(d));
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
