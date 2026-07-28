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
  // ── FEEDS RSS DIRETOS (com imagem) ──────────────────────────
  {
    name:   'Gazeta Esportiva',
    url:    'https://www.gazetaesportiva.com/tag/vitoria-ba/feed/',
    color:  '#C8102E',
    filter: false,
  },
  {
    name:   'Arena Rubro-Negra',
    url:    'https://arenarubronegra.com/feed/',
    color:  '#C8102E',
    filter: false,
  },
  {
    name:   'Futebol Baiano',
    url:    'https://futebolbaiano.com.br/feed',
    color:  '#008000',
    filter: true,
  },
  // ── RSS de portais baianos (testados, 0 resultados — feeds gerais sem esporte)
  // Correio 24h e iBahia removidos — feeds gerais, sem notícias do Vitória
  // ── GOOGLE NEWS (consultas existentes) ──────────────────────
  {
    name:         'Google News',
    url:          'https://news.google.com/rss/search?q=%22Vit%C3%B3ria-BA%22+futebol&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color:        '#C8102E',
    filter:       false,
    isGoogleNews: true,
  },
  {
    name:         'Google News',
    url:          'https://news.google.com/rss/search?q=%22Esporte+Clube+Vit%C3%B3ria%22+BA&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color:        '#C8102E',
    filter:       false,
    isGoogleNews: true,
  },
  {
    name:         'Google News',
    url:          'https://news.google.com/rss/search?q=%22Vit%C3%B3ria+da+Bahia%22+futebol&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color:        '#C8102E',
    filter:       false,
    isGoogleNews: true,
  },
  // ── NOVAS CONSULTAS GOOGLE NEWS ────────────────────────────
  {
    name:         'Google News',
    url:          'https://news.google.com/rss/search?q=Vit%C3%B3ria+BA+S%C3%A9rie+A&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color:        '#C8102E',
    filter:       false,
    isGoogleNews: true,
  },
  {
    name:         'Google News',
    url:          'https://news.google.com/rss/search?q=%22Le%C3%A3o+da+Barra%22+futebol&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color:        '#C8102E',
    filter:       false,
    isGoogleNews: true,
  },
  {
    name:         'Google News',
    url:          'https://news.google.com/rss/search?q=Vit%C3%B3ria+BA+futebol+not%C3%ADcias&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color:        '#C8102E',
    filter:       false,
    isGoogleNews: true,
  },
  {
    name:         'Google News',
    url:          'https://news.google.com/rss/search?q=%22EC+Vit%C3%B3ria%22+futebol+2026&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color:        '#C8102E',
    filter:       false,
    isGoogleNews: true,
  },
  {
    name:         'Google News',
    url:          'https://news.google.com/rss/search?q=%22Barrad%C3%A3o%22+futebol&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color:        '#C8102E',
    filter:       false,
    isGoogleNews: true,
  },
];

const KEYWORDS = ['vitória-ba', 'vitoria-ba', 'vitória da bahia', 'vitoria da bahia', 
  'leão da barra', 'leao da barra', 'ec vitória', 'ec vitoria', 
  'barradão', 'barradao', 'esporte clube vitória', 'esporte clube vitoria', 
  'arena rubro-negra', 'arenarubronegra', 'vitoria ba', 'vitória ba',
  'e.c. vitória', 'e.c. vitoria', 'rubro-negro baiano', 'leão',
  'vitoria da bahia', 'vitória da bahia', 'leao da barra', 'leão da barra'];

// ─── fetchAll ──────────────────────────────────────────────────
async function fetchAll() {
  const results = await Promise.allSettled(SOURCES.map(s => fetchOne(s)));
  const items = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      console.log(`  [${SOURCES[i].name}] ${r.value.length} itens, com imagem: ${r.value.filter(x => x.image).length}`);
      items.push(...r.value);
    } else {
      console.warn('  [' + SOURCES[i].name + '] falhou: ' + (r.reason && r.reason.message));
    }
  });

  // Para itens sem imagem, tenta buscar og:image da página do artigo.
  // PULA itens do Google News (links de redirect, og:image raramente funciona
  // e o fetch é muito lento — centenas de requests).
  const withoutImage = items.filter(i =>
    !i.image && i.link && !i.link.startsWith('https://news.google.com')
  );

  if (withoutImage.length > 100) {
    console.log(`  og:image: ${withoutImage.length} itens elegiveis (limitado a 50 para performance)`);
    await processInBatches(withoutImage.slice(0, 50), 6, fetchOgImage);
  } else if (withoutImage.length > 0) {
    console.log(`  Buscando og:image para ${withoutImage.length} itens...`);
    await processInBatches(withoutImage, 6, fetchOgImage);
  }

  console.log(`  Com imagem: ${items.filter(x => x.image).length}/${items.length}`);

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
    const url = (mc && mc['$'] && mc['$'].url) || (mc && mc.url);
    if (url && isValidImage(url)) return url;
  }

  // 2. media:thumbnail
  const mt = entry.mediaThumbnail;
  if (mt) {
    const url = (mt && mt['$'] && mt['$'].url) || (mt && mt.url);
    if (url && isValidImage(url)) return url;
  }

  // 3. enclosure (WordPress usa isso para imagem em destaque)
  const enc = entry.enclosure;
  if (enc) {
    const url = (enc && enc.url) || (enc && enc['$'] && enc['$'].url);
    const type = (enc && enc.type) || (enc && enc['$'] && enc['$'].type) || '';
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
  if (!item.link) return;
  // Google News links redirecionam para o artigo real — fetchHtmlHead segue o redirect
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
  'GE':               'https://s2-ge.glbimg.com/8YZ7shA-uHGoBhzwBPjp3w8bYh8=/1200x630/filters:quality(70)/https://s.sde.globo.com/media/organizations/2019/01/01/vitoria-escudo.svg',
  'Globo Esporte':    'https://s2-ge.glbimg.com/8YZ7shA-uHGoBhzwBPjp3w8bYh8=/1200x630/filters:quality(70)/https://s.sde.globo.com/media/organizations/2019/01/01/vitoria-escudo.svg',
  'Lance!':           'https://www.lance.com.br/wp-content/uploads/2023/01/lance-og.jpg',
  'LANCE!':           'https://www.lance.com.br/wp-content/uploads/2023/01/lance-og.jpg',
  'ESPN Brasil':      'https://a1.espncdn.com/combiner/i?img=%2Fi%2Fespn%2Fespn_logos%2Fespn_red.png&w=1200&h=630&scale=crop&cquality=40&location=origin',
  'CNN Brasil':       'https://conteudo.imguol.com.br/c/esporte/layout/1.0/img/uol-esporte-share.png',
};

// Imagem padrão: escudo do Vitória-BA
const DEFAULT_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Escudo_EC_Vitoria.svg/200px-Escudo_EC_Vitoria.svg.png';

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
