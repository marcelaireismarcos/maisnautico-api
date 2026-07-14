const Parser = require('rss-parser');

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
  // Google News — agrega GE, NE10, Lance, Folha PE automaticamente
  {
    name:   'Globo Esporte',
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
  // Gazeta Esportiva — RSS direto, específico do Náutico
  {
    name:   'Gazeta Esportiva',
    url:    'https://www.gazetaesportiva.com/tag/nautico/feed/',
    color:  '#1B5E20',
    filter: false,
  },
  // Série B geral — filtrado por palavras-chave do Náutico
  {
    name:   'Gazeta — Série B',
    url:    'https://www.gazetaesportiva.com/tag/brasileirao-serie-b/feed/',
    color:  '#0066CC',
    filter: true,
  },
];

const KEYWORDS = [
  'náutico', 'nautico', 'timbu', 'capibaribe',
  'série b', 'serie b',
];

// ─── fetchAll ─────────────────────────────────────────────────
async function fetchAll() {
  const results = await Promise.allSettled(
    SOURCES.map(s => fetchOne(s))
  );

  const items = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      console.log(`  [${SOURCES[i].name}] ${r.value.length} itens`);
      items.push(...r.value);
    } else {
      console.warn(`  [${SOURCES[i].name}] falhou: ${r.reason?.message}`);
    }
  });

  return items;
}

async function fetchOne(source) {
  const feed  = await parser.parseURL(source.url);
  const items = [];

  for (const entry of (feed.items || [])) {
    const rawTitle = (entry.title || '').trim();
    if (!rawTitle) continue;

    // Filtrar por relevância se necessário
    const combined = rawTitle + ' ' + (entry.contentSnippet || '');
    if (source.filter && !isRelevant(combined)) continue;

    // Google News embute o nome da fonte no título: "Título - Fonte"
    let title      = rawTitle;
    let sourceName = source.name;
    if (rawTitle.includes(' - ')) {
      const idx   = rawTitle.lastIndexOf(' - ');
      title       = rawTitle.substring(0, idx).trim();
      sourceName  = rawTitle.substring(idx + 3).trim();
    }

    items.push({
      title,
      link:        entry.link || entry.guid || '',
      description: cleanHtml(entry.contentSnippet || ''),
      image:       extractImage(entry),
      date:        entry.isoDate || null,
      source:      sourceName,
      color:       source.color,
    });
  }

  return items;
}

// ─── Helpers ──────────────────────────────────────────────────
function isRelevant(text) {
  const lower = text.toLowerCase();
  return KEYWORDS.some(kw => lower.includes(kw));
}

function extractImage(entry) {
  if (entry.mediaContent?.$?.url)   return entry.mediaContent.$.url;
  if (entry.mediaThumbnail?.$?.url) return entry.mediaThumbnail.$.url;
  if (entry.enclosure?.url)         return entry.enclosure.url;

  const html = entry['content:encoded'] || entry.content || '';
  const m    = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function cleanHtml(text) {
  return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = { fetchAll };
