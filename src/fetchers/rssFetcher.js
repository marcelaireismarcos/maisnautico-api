/**
 * rssFetcher.js
 *
 * Busca notícias via RSS — rápido, sem Puppeteer.
 * Fontes: Gazeta Esportiva (específico do Náutico), Google News (agrega GE, NE10, etc.)
 */

const Parser = require('rss-parser');
const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: false }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: false }],
      ['enclosure', 'enclosure'],
    ],
  },
});

// ─── Fontes RSS ────────────────────────────────────────────────
const SOURCES = [
  {
    name: 'Gazeta Esportiva',
    url: 'https://www.gazetaesportiva.com/tag/nautico/feed/',
    color: '#C8102E',
    filter: false, // específica do Náutico — não filtra
  },
  {
    name: 'Gazeta — Série B',
    url: 'https://www.gazetaesportiva.com/tag/brasileirao-serie-b/feed/',
    color: '#0066CC',
    filter: true,
  },
  {
    // Google News agrega GE, NE10, Folha PE, Lance etc.
    name: 'Google News',
    url: 'https://news.google.com/rss/search?q=%22N%C3%A1utico+Capibaribe%22&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color: '#C8102E',
    filter: false,
  },
  {
    name: 'Google News — Série B',
    url: 'https://news.google.com/rss/search?q=Brasileiro+Serie+B+Nautico&hl=pt-BR&gl=BR&ceid=BR%3Apt-419',
    color: '#0066CC',
    filter: true,
  },
  {
    name: 'Folha PE',
    url: 'https://www.folhape.com.br/rss/esportes/',
    color: '#1B5E20',
    filter: true,
  },
];

const KEYWORDS = ['náutico', 'nautico', 'timbu', 'capibaribe', 'série b', 'serie b'];

// ─── fetchAll ─────────────────────────────────────────────────
async function fetchAll() {
  const results = await Promise.allSettled(
    SOURCES.map(source => fetchOne(source))
  );

  const items = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      console.log(`  RSS [${SOURCES[i].name}]: ${result.value.length} itens`);
      items.push(...result.value);
    } else {
      console.warn(`  RSS [${SOURCES[i].name}] falhou: ${result.reason?.message}`);
    }
  });

  return items;
}

async function fetchOne(source) {
  const feed = await parser.parseURL(source.url);
  const items = [];

  for (const entry of (feed.items || [])) {
    const title = entry.title?.trim() || '';
    if (!title) continue;

    // Filtrar por keyword se necessário
    if (source.filter && !isRelevant(title + ' ' + (entry.contentSnippet || ''))) {
      continue;
    }

    // Nome da fonte real (Google News embute no título: "Título — Fonte")
    let sourceName = source.name;
    let finalTitle = title;
    if (source.name.includes('Google News') && title.includes(' - ')) {
      const parts = title.split(' - ');
      sourceName = parts[parts.length - 1].trim();
      finalTitle = parts.slice(0, -1).join(' - ').trim();
    }

    items.push({
      title:       finalTitle,
      link:        entry.link || entry.guid || '',
      description: cleanHtml(entry.contentSnippet || entry.content || ''),
      image:       extractImage(entry),
      date:        entry.isoDate || entry.pubDate || null,
      source:      sourceName,
      color:       source.color,
    });
  }

  return items;
}

function isRelevant(text) {
  const lower = text.toLowerCase();
  return KEYWORDS.some(kw => lower.includes(kw));
}

function extractImage(entry) {
  if (entry.mediaContent?.$?.url) return entry.mediaContent.$.url;
  if (entry.mediaThumbnail?.$?.url) return entry.mediaThumbnail.$.url;
  if (entry.enclosure?.url) return entry.enclosure.url;

  // Tenta extrair imagem do conteúdo HTML
  const html = entry['content:encoded'] || entry.content || '';
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (match) return match[1];

  return null;
}

function cleanHtml(text) {
  return text.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
}

module.exports = { fetchAll };
