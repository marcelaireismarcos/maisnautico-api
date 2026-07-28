/**
 * NewsScraper — raspa páginas HTML que não têm RSS e devolve
 * itens no mesmo formato do rssFetcher.js
 *
 * Formato de saída: { title, link, description, image, date, source, color }
 */
const axios = require('axios');
const cheerio = require('cheerio');

// Polyfill (também definido no index.js, mas mantido aqui para testes isolados)
if (!Promise.allSettled) {
  Promise.allSettled = function(promises) {
    return Promise.all(promises.map(function(p) {
      return p
        .then(function(value) { return { status: 'fulfilled', value: value }; })
        .catch(function(reason) { return { status: 'rejected', reason: reason }; });
    }));
  };
}

// ─── Configuração das fontes raspadas ──────────────────────────
const SOURCES = [
  // ── Futebol Bahiano ──────────────────────────────────────────
  // Categoria "Esporte Clube Vitória" — 18+ notícias
  {
    name:   'Futebol Baiano',
    url:    'https://futebolbahiano.org/esporte-clube-vitoria',
    color:  '#008000',
    selectors: {
      container: 'a.home__post',
      title:     'h3',
      link:      null, // o container <a> já é o link
      image:     'img',
      imageAttr: 'src',
      imageLazy: 'data-src',
    },
  },
  // ── Gazeta Esportiva — página do time ─────────────────────────
  // Página principal que lista notícias do Vitória
  // Estrutura: section.interna > ul > li.noticia > a (com título + img)
  {
    name:   'Gazeta Esportiva',
    url:    'https://www.gazetaesportiva.com/times/vitoria/',
    color:  '#C8102E',
    selectors: {
      container: 'section.interna li.noticia',
      title:     'a', // o link contém o texto do título
      link:      'a',
      image:     'img',
      imageAttr: 'src',
      imageLazy: 'data-src',
    },
    // Filtro: só links de artigos (não categorias, páginas internas)
    linkFilter: function(href) {
      if (!href) return false;
      return href.startsWith('https://www.gazetaesportiva.com/') && href.length > 60;
    },
    // Filtro adicional por título: só notícias que mencionam Vitória
    titleFilter: function(title) {
      if (!title) return false;
      var lower = title.toLowerCase();
      return lower.indexOf('vitória') !== -1 || lower.indexOf('vitoria') !== -1
          || lower.indexOf('ventura') !== -1 || lower.indexOf('leão') !== -1
          || lower.indexOf('leao') !== -1 || lower.indexOf('barradão') !== -1
          || lower.indexOf('barradao') !== -1 || lower.indexOf('rubro-negro') !== -1
          || lower.indexOf('ecv') !== -1 || lower.indexOf('arcanjo') !== -1
          || lower.indexOf('marinho') !== -1 || lower.indexOf('cantalapiedra') !== -1
          || lower.indexOf('cacá') !== -1 || lower.indexOf('matheuzinho') !== -1
          || lower.indexOf('remo') !== -1;
    },
  },
  // ── Galaticos Online ─────────────────────────────────────────
  // Atualmente offline (404), mas mantido para auto-recuperação
  {
    name:   'Galáticos Online',
    url:    'https://www.galaticosonline.com/noticias/vitoria.html',
    color:  '#E65100',
    selectors: {
      container: 'article, .post, .noticia, .card, li',
      title:     'h2 a, h3 a, .title a',
      link:      null,
      image:     'img',
      imageAttr: 'src',
      imageLazy: 'data-src, data-lazy-src',
    },
    // Falha silenciosa se o site estiver offline
  },
  // ── Arena Rubro-Negra ────────────────────────────────────────
  // Blog do Vitória (já tem RSS no rssFetcher, mas este é o
  // complemento via scraping da página principal)
  {
    name:   'Arena Rubro-Negra',
    url:    'https://arenarubronegra.com/',
    color:  '#C8102E',
    selectors: {
      container: '.td_module_wrap, .td_block_inner .td-module-container',
      title:     '.entry-title a',
      link:      '.entry-title a',
      image:     '.td-module-thumb img',
      imageAttr: 'src',
      imageLazy: 'data-img-url, data-src',
    },
  },
];

// ─── fetchAll: raspa todas as fontes em paralelo ───────────────
async function fetchAll() {
  const results = await Promise.allSettled(SOURCES.map(s => scrapeOne(s)));
  const items = [];

  results.forEach((r, i) => {
    const source = SOURCES[i];
    if (r.status === 'fulfilled') {
      console.log(`  [scraper/${source.name}] ${r.value.length} itens`);
      items.push(...r.value);
    } else {
      console.warn(`  [scraper/${source.name}] falhou: ${r.reason && r.reason.message}`);
    }
  });

  // Busca og:image para itens sem imagem
  const withoutImage = items.filter(i => !i.image && i.link);
  if (withoutImage.length > 0) {
    console.log(`  [scraper] Buscando og:image para ${withoutImage.length} itens...`);
    await processInBatches(withoutImage, 6, fetchOgImage);
    console.log(`  [scraper] Com imagem após og:image: ${items.filter(x => x.image).length}/${items.length}`);
  }

  return items;
}

// ─── scrapeOne: raspa uma página ───────────────────────────────
async function scrapeOne(source) {
  const res = await axios.get(source.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    },
    timeout: 20000,
    maxRedirects: 5,
  });

  const $ = cheerio.load(res.data);
  const items = [];
  const seenLinks = new Set();
  const sel = source.selectors;

  // Tenta primeiro o container
  let elements = [];
  if (sel.container) {
    elements = $(sel.container).toArray();
  }

  // Se não achou nada pelo container, busca todos os links grandes
  if (elements.length === 0) {
    $('a').each((i, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      const href = $el.attr('href') || '';
      if (text.length > 20 && href.startsWith('http') && !href.includes('facebook') && !href.includes('twitter') && !href.includes('instagram')) {
        elements.push(el);
      }
    });
  }

  for (const el of elements) {
    const $el = $(el);

    // Extrai link
    let link = '';
    if (sel.link) {
      link = $el.find(sel.link).attr('href') || $el.attr('href') || '';
    } else {
      link = $el.attr('href') || $el.find('a').first().attr('href') || '';
    }

    // Normaliza link relativo
    if (link && !link.startsWith('http')) {
      try {
        link = new URL(link, source.url).href;
      } catch (e) {
        continue;
      }
    }

    // Filtro de link (se definido)
    if (source.linkFilter && !source.linkFilter(link)) continue;

    // Dedup por link
    if (!link || seenLinks.has(link)) continue;
    seenLinks.add(link);

    // Extrai título
    let title = '';
    if (sel.title) {
      title = $el.find(sel.title).first().text().trim();
    } else {
      title = $el.text().trim();
    }
    if (!title || title.length < 10) continue;

    // Filtro por título (se definido) — ex: só notícias que mencionam Vitória
    if (source.titleFilter && !source.titleFilter(title)) continue;

    // Extrai imagem
    let image = null;
    if (sel.image) {
      const $img = $el.find(sel.image).first();
      image = $img.attr(sel.imageAttr) || null;
      // Tenta lazy attributes
      if (!image && sel.imageLazy) {
        const lazyAttrs = sel.imageLazy.split(',').map(a => a.trim());
        for (const attr of lazyAttrs) {
          image = $img.attr(attr);
          if (image) break;
        }
      }
      if (image && image.startsWith('data:')) image = null; // placeholder SVG
    }

    // Data — tenta extrair do HTML (time, date, etc.)
    let date = null;
    const timeEl = $el.find('time, [datetime]').first();
    if (timeEl && timeEl.length) {
      date = timeEl.attr('datetime') || timeEl.attr('content') || null;
    }

    // Descrição
    let description = '';
    const descEl = $el.find('p, .excerpt, .description, .resumo').first();
    if (descEl.length) {
      description = descEl.text().trim().substring(0, 200);
    }

    // Data: usa a atual como fallback (itens raspados são sempre recentes)
    var now = new Date();
    var itemDate = date ? date : now.toISOString();

    items.push({
      title: title,
      link: link,
      description: description || title.substring(0, 120),
      image: image,
      date: itemDate,
      source: source.name,
      color: source.color,
    });

    if (items.length >= 20) break; // limite por fonte
  }

  return items;
}

// ─── Busca og:image da página do artigo ────────────────────────
async function fetchOgImage(item) {
  if (!item.link) return;
  try {
    const res = await axios.get(item.link, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
      timeout: 10000,
      maxRedirects: 5,
      responseType: 'text',
      // Só baixa o suficiente para achar og:image
      transformResponse: [(data) => data],
    });

    const html = typeof res.data === 'string' ? res.data : '';
    if (!html) return;

    // og:image
    let m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
         || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (m && m[1] && isValidImage(m[1])) { item.image = m[1]; return; }

    // twitter:image
    m = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
    if (m && m[1] && isValidImage(m[1])) { item.image = m[1]; return; }

    // Primeira <img> grande no artigo
    m = html.match(/<(?:figure|div|picture)[^>]*>[\s\S]{0,500}?<img[^>]+src=["']([^"']+)["']/i);
    if (m && m[1] && isValidImage(m[1])) { item.image = m[1]; return; }
  } catch (_) {}
}

// ─── Helpers ──────────────────────────────────────────────────
function isValidImage(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('data:')) return false;
  if (url.includes('1x1') || url.includes('pixel') || url.includes('spacer')) return false;
  if (url.includes('svg+xml')) return false;
  return url.startsWith('http');
}

function processInBatches(items, size, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(Promise.allSettled(items.slice(i, i + size).map(fn)));
  }
  return Promise.all(results);
}

module.exports = { fetchAll };
