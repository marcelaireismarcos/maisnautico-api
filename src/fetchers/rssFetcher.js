const Parser = require('rss-parser');
const https  = require('https');
const http   = require('http');

// Parser com todos os campos de imagem possíveis no RSS
const parser = new Parser({
  timeout: 20000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Mobile) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
  customFields: {
    item: [
      ['media:content',        'mediaContent',        { keepArray: false }],
      ['media:thumbnail',      'mediaThumbnail',      { keepArray: false }],
      ['media:group',          'mediaGroup',          { keepArray: false }],
      ['enclosure',            'enclosure',           { keepArray: false }],
      ['content:encoded',      'contentEncoded'],
      ['description',          'descriptionRaw'],
    ],
  },
});

// ─── Fontes RSS ────────────────────────────────────────────────
const SOURCES = [
  // RSS diretos com imagem no feed (WordPress inclui imagem automaticamente)
  {
    name:   'Gazeta Esportiva',
    url:    'https://www.gazetaesportiva.com/tag/nautico/feed/',
    color:  '#C8102E',
    filter: false,
  },
  {
    name:   'Gazeta — Série B',
    url:    'https://www.gazetaesportiva.com/tag/brasileirao-serie-b/feed/',
    color:  '#0066CC',
    filter: true,
  },
  {
    name:   'Torcedores',
    url:    'https://www.torcedores.com/feed/nautico',
    color:  '#E65100',
    filter: false,
  },
  {
    name:   'Folha PE',
    url:    'https://www.folhape.com.br/rss/esportes/',
    color:  '#880E4F',
    filter: true,
  },
  // Google News — muitas fontes, sem imagem direta — usamos com logo fallback
  {
    name:         'Google News',
    url:          'https://news.google.com/rss/search?q=%22N%C3%A1utico+Capibaribe%22+futebol&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color:        '#C8102E',
    filter:       false,
    isGoogleNews: true,
  },
  {
    name:         'Google News — Série B',
    url:          'https://news.google.com/rss/search?q=Nautico+%22Serie+B%22+futebol&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color:        '#0066CC',
    filter:       false,
    isGoogleNews: true,
  },
];

const KEYWORDS = ['náutico', 'nautico', 'timbu', 'capibaribe', 'série b', 'serie b'];

// ─── fetchAll ──────────────────────────────────────────────────
async function fetchAll() {
  const results = await Promise.allSettled(SOURCES.map(s => fetchOne(s)));
  const items = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      console.log(`  [${SOURCES[i].name}] ${r.value.length} itens, com imagem: ${r.value.filter(x => x.image).length}`);
      items.push(...r.value);
    } else {
      console.warn(`  [${SOURCES[i].name}] falhou: ${r.reason?.message}`);
    }
  });

  // Para itens sem imagem com link real (não Google News),
  // tenta buscar og:image da página do artigo
  const withoutImage = items.filter(i =>
    !i.image &&
    i.link &&
    !i.link.includes('news.google.com')
  );

  if (withoutImage.length > 0) {
    console.log(`  Buscando og:image para ${withoutImage.length} itens...`);
    await processInBatches(withoutImage, 8, fetchOgImage);
    console.log(`  Com imagem após og:image: ${items.filter(x => x.image).length}/${items.length}`);
  }

  // Itens do Google News sem imagem: usa imagem baseada no nome da fonte
  items.filter(i => !i.image).forEach(i => {
    i.image = getSourceImage(i.source);
  });

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
    if (source.isGoogleNews && rawTitle.includes(' - ')) {
      const idx  = rawTitle.lastIndexOf(' - ');
      title      = rawTitle.substring(0, idx).trim();
      sourceName = rawTitle.substring(idx + 3).trim();
    }

    const link  = entry.link || entry.guid || '';
    const image = extractImageFromEntry(entry);

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

// ─── Extrai imagem de um item RSS ─────────────────────────────
function extractImageFromEntry(entry) {
  // 1. media:content
  const mc = entry.mediaContent;
  if (mc) {
    const url = mc?.['$']?.url || mc?.url;
    if (url && isValidImage(url)) return url;
  }

  // 2. media:thumbnail
  const mt = entry.mediaThumbnail;
  if (mt) {
    const url = mt?.['$']?.url || mt?.url;
    if (url && isValidImage(url)) return url;
  }

  // 3. enclosure (WordPress usa isso para imagem em destaque)
  const enc = entry.enclosure;
  if (enc) {
    const url = enc?.url || enc?.['$']?.url;
    const type = enc?.type || enc?.['$']?.type || '';
    if (url && (type.startsWith('image') || isImageUrl(url)) && isValidImage(url)) {
      return url;
    }
  }

  // 4. Primeira <img> no content:encoded (WordPress coloca imagem aqui)
  const html = entry.contentEncoded || entry['content:encoded'] || entry.content || '';
  if (html) {
    const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m && isValidImage(m[1])) return m[1];
  }

  // 5. Primeira <img> na description (alguns sites colocam aqui)
  const desc = entry.descriptionRaw || entry.description || '';
  if (desc) {
    const m = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m && isValidImage(m[1])) return m[1];
  }

  return null;
}

// ─── Busca og:image da URL do artigo ──────────────────────────
async function fetchOgImage(item) {
  if (!item.link || item.link.includes('google.com')) return;
  try {
    const html = await fetchHtmlHead(item.link, 10000, 7000);
    if (!html) return;

    // og:image
    let m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
         || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (m && isValidImage(m[1])) { item.image = m[1]; return; }

    // twitter:image
    m = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
    if (m && isValidImage(m[1])) { item.image = m[1]; return; }
  } catch (_) {}
}

// ─── Imagens de fallback por fonte ────────────────────────────
// Imagens reais e em tamanho adequado — não favicons
const SOURCE_IMAGES = {
  'GE':               'https://s2-ge.glbimg.com/8YZ7shA-uHGoBhzwBPjp3w8bYh8=/1200x630/filters:quality(70)/https://s.sde.globo.com/media/organizations/2019/01/03/Nautico.svg',
  'Globo Esporte':    'https://s2-ge.glbimg.com/8YZ7shA-uHGoBhzwBPjp3w8bYh8=/1200x630/filters:quality(70)/https://s.sde.globo.com/media/organizations/2019/01/03/Nautico.svg',
  'JC':               'https://jc.ne10.uol.com.br/img/logo-jc.png',
  'Lance!':           'https://www.lance.com.br/wp-content/uploads/2023/01/lance-og.jpg',
  'LANCE!':           'https://www.lance.com.br/wp-content/uploads/2023/01/lance-og.jpg',
  'ESPN Brasil':      'https://a1.espncdn.com/combiner/i?img=%2Fi%2Fespn%2Fespn_logos%2Fespn_red.png&w=1200&h=630&scale=crop&cquality=40&location=origin',
  'CNN Brasil':       'https://conteudo.imguol.com.br/c/esporte/layout/1.0/img/uol-esporte-share.png',
};

// Imagem padrão: escudo do Náutico (SVG via Globo CDN — funciona como imagem)
const DEFAULT_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Clube_N%C3%A1utico_Capibaribe.svg/200px-Clube_N%C3%A1utico_Capibaribe.svg.png';

function getSourceImage(sourceName) {
  if (!sourceName) return DEFAULT_IMAGE;
  if (SOURCE_IMAGES[sourceName]) return SOURCE_IMAGES[sourceName];
  // Match parcial
  for (const [key, url] of Object.entries(SOURCE_IMAGES)) {
    if (sourceName.toLowerCase().includes(key.toLowerCase())) return url;
  }
  return DEFAULT_IMAGE;
}

// ─── Helpers ──────────────────────────────────────────────────
function fetchHtmlHead(url, maxBytes, timeout, depth = 0) {
  if (depth > 4) return Promise.resolve(null);
  return new Promise(resolve => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
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

function isRelevant(text) {
  const lower = text.toLowerCase();
  return KEYWORDS.some(kw => lower.includes(kw));
}

function isValidImage(url) {
  if (!url || url.startsWith('data:')) return false;
  if (url.includes('1x1') || url.includes('pixel') || url.includes('spacer')) return false;
  return url.startsWith('http');
}

function isImageUrl(url) {
  if (!url) return false;
  return /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url);
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
