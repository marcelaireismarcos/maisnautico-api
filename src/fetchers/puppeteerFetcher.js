/**
 * puppeteerFetcher.js
 *
 * Busca notícias via Puppeteer (browser headless) dos sites que usam JavaScript.
 * Roda em produção no Render.com usando @sparticuz/chromium.
 *
 * Fontes:
 *   - GE Globo — página do Náutico (JavaScript)
 *   - NE10 UOL — seção Náutico (JavaScript)
 */

const puppeteer  = require('puppeteer-core');
const chromium   = require('@sparticuz/chromium');

// ─── Configuração do browser ───────────────────────────────────
async function getBrowser() {
  // Em produção (Render), usa o Chromium do pacote @sparticuz/chromium
  // Em desenvolvimento local, usa o Chrome instalado
  const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER;

  if (isProduction) {
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  } else {
    // Local: precisa do Chrome instalado
    return puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.env.CHROME_PATH ||
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    });
  }
}

// ─── Fontes com JavaScript ─────────────────────────────────────
const SOURCES = [
  {
    name: 'Globo Esporte',
    url: 'https://ge.globo.com/pe/futebol/times/nautico/',
    color: '#C8102E',
    scraper: scrapeGE,
  },
  {
    name: 'NE10 — Náutico',
    url: 'https://ne10.uol.com.br/esportes/futebol/nautico/',
    color: '#FF6F00',
    scraper: scrapeNE10,
  },
];

// ─── fetchAll ─────────────────────────────────────────────────
async function fetchAll() {
  let browser;
  const allItems = [];

  try {
    browser = await getBrowser();

    for (const source of SOURCES) {
      try {
        const items = await source.scraper(browser, source);
        console.log(`  Puppeteer [${source.name}]: ${items.length} itens`);
        allItems.push(...items);
      } catch (e) {
        console.warn(`  Puppeteer [${source.name}] falhou: ${e.message}`);
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  return allItems;
}

// ─── Scraper: Globo Esporte Náutico ───────────────────────────
async function scrapeGE(browser, source) {
  const page = await browser.newPage();
  const items = [];

  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 11; Mobile) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'
    );
    await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Aguarda os artigos carregarem
    await page.waitForSelector('a[href*="/noticia/"]', { timeout: 10000 }).catch(() => {});

    const rawItems = await page.evaluate(() => {
      const results = [];
      // Links de notícias do GE — padrão /noticia/ na URL
      const links = document.querySelectorAll('a[href*="/noticia/"]');

      links.forEach(link => {
        const href = link.href || '';
        if (!href.includes('/noticia/')) return;

        // Título: texto do link ou do h2/h3 mais próximo
        const heading = link.querySelector('h2, h3, h1, p') ||
                        link.closest('article')?.querySelector('h2, h3, h1');
        const title = heading?.textContent?.trim() ||
                      link.textContent?.trim() || '';

        if (!title || title.length < 10) return;

        // Imagem
        const img = link.querySelector('img') ||
                    link.closest('article')?.querySelector('img');
        const image = img?.src || img?.dataset?.src || null;

        // Data
        const timeEl = link.closest('article')?.querySelector('time');
        const date   = timeEl?.getAttribute('datetime') || timeEl?.textContent || null;

        results.push({ title, link: href, image, date });
      });

      // Remove duplicatas por link
      const seen = new Set();
      return results.filter(item => {
        if (seen.has(item.link)) return false;
        seen.add(item.link);
        return true;
      });
    });

    for (const raw of rawItems) {
      if (!raw.title || !raw.link) continue;
      items.push({
        title:       raw.title,
        link:        raw.link,
        description: '',
        image:       raw.image,
        date:        raw.date ? parseGEDate(raw.date) : null,
        source:      source.name,
        color:       source.color,
      });
    }

  } finally {
    await page.close();
  }

  return items;
}

// ─── Scraper: NE10 Náutico ────────────────────────────────────
async function scrapeNE10(browser, source) {
  const page = await browser.newPage();
  const items = [];

  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 11; Mobile) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'
    );
    await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('article, .post, .news-item', { timeout: 8000 }).catch(() => {});

    const rawItems = await page.evaluate(() => {
      const results = [];
      // Seletores genéricos — NE10 usa WordPress
      const cards = document.querySelectorAll('article, .post-item, .news-card, .card');

      cards.forEach(card => {
        const linkEl = card.querySelector('a[href]');
        if (!linkEl) return;

        const href = linkEl.href || '';
        if (!href.includes('ne10') && !href.includes('uol')) return;

        const heading = card.querySelector('h2, h3, h1, .title, .post-title');
        const title   = heading?.textContent?.trim() || linkEl.textContent?.trim() || '';
        if (!title || title.length < 10) return;

        const img   = card.querySelector('img');
        const image = img?.src || img?.dataset?.src || null;

        const timeEl = card.querySelector('time, .date, .post-date');
        const date   = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || null;

        results.push({ title, link: href, image, date });
      });

      const seen = new Set();
      return results.filter(item => {
        if (seen.has(item.link)) return false;
        seen.add(item.link);
        return true;
      });
    });

    for (const raw of rawItems) {
      if (!raw.title || !raw.link) continue;
      items.push({
        title:       raw.title,
        link:        raw.link,
        description: '',
        image:       raw.image,
        date:        raw.date,
        source:      source.name,
        color:       source.color,
      });
    }

  } finally {
    await page.close();
  }

  return items;
}

// ─── Helpers ─────────────────────────────────────────────────
function parseGEDate(raw) {
  if (!raw) return null;
  // GE usa formato "Há X dias", "Ontem", datetime ISO ou "DD/MM/YYYY"
  if (raw.includes('T') || raw.includes('-')) return raw; // ISO
  return null; // outros formatos — deixa sem data
}

module.exports = { fetchAll };
