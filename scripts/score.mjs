// Gate scorer.
//
// Given an HTML file, reports how many of the 57 pro-slop gates in
// gates/gates.yaml are satisfied and which are not. A failing gate means some
// part of the page is accidentally too good.
//
// Exits non-zero when slopScore < 57. This is Hallmark's "one failure blocks
// ship" rule with the target state inverted: ship is blocked unless the page is
// maximally generic.
//
// Three engines, picked per gate by check_type:
//   dom     cheerio, no browser needed
//   text    cheerio text extraction, matched against `pattern` or a handler
//   css     Playwright headless Chromium + getComputedStyle, because the
//           declared value in a stylesheet is not the value that renders
//   manual  not machine-checkable; recorded as such rather than adjudicated

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import yaml from 'js-yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

export const TOTAL_GATES = 57;

/** Families a page may load. Hallmark gate 1 bans these as display faces. */
export const FONT_ALLOWLIST = ['Inter', 'Poppins', 'Manrope', 'Space Grotesk'];

/** Stack entries that aren't a type choice, so they don't count toward SLOP-007. */
const GENERIC_FAMILIES = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  '-apple-system',
  'blinkmacsystemfont',
  'segoe ui',
  'roboto',
  'helvetica neue',
  'helvetica',
  'arial',
  'emoji',
  'math',
  'inherit',
  'initial',
  'unset',
  'revert',
]);

/** The canonical macrostructure sequence SLOP-037 asserts. */
export const CANONICAL_SECTIONS = [
  'hero',
  'logo-cloud',
  'features',
  'stats',
  'testimonials',
  'pricing',
  'faq',
  'cta-banner',
  'footer',
];

/** SLOP-036: the four footer column headings. */
const FOOTER_COLUMNS = ['product', 'company', 'resources', 'legal'];

/** SLOP-052: every CTA label must come from here. */
const CTA_POOL = new Set([
  'get started',
  'get started free',
  'get started for free',
  'start free trial',
  'start your free trial',
  'start for free',
  'book a demo',
  'request a demo',
  'schedule a demo',
  'learn more',
  'contact sales',
  'talk to sales',
  'try it free',
  'sign up',
  'sign up free',
  'see pricing',
  'view pricing',
]);

/**
 * SLOP-051, the template-swap test. A quote that names anything tied to a
 * specific industry stops being interchangeable, so the check is: does the quote
 * contain a marker from any of these domains? Zero hits means the quote survives
 * a company-name swap into any other industry unchanged.
 *
 * Deliberately drawn wide across unrelated sectors, including the five brief
 * fixtures in examples/briefs/, so the check isn't tuned to one of them.
 */
export const INDUSTRY_MARKERS = [
  // craft / making
  'ceramic', 'ceramics', 'kiln', 'pottery', 'glaze', 'thrown', 'loom', 'weav',
  'letterpress', 'riso', 'screenprint', 'woodwork', 'joinery', 'forge',
  // food / drink
  'sourdough', 'bakery', 'bread', 'pastry', 'coffee', 'espresso', 'roast',
  'brewery', 'kitchen', 'menu', 'restaurant', 'recipe', 'farm', 'harvest',
  // publishing / media
  'zine', 'magazine', 'newsprint', 'podcast', 'episode', 'album', 'record label',
  'gallery', 'exhibition', 'curat', 'manuscript', 'editorial',
  // care / civic / nonprofit
  'funeral', 'mourn', 'bereave', 'hospice', 'clinic', 'patient', 'donor',
  'nonprofit', 'charity', 'volunteer', 'congregation', 'shelter', 'adoption',
  // trades / physical services
  'plumb', 'roofing', 'hvac', 'landscap', 'salon', 'barber', 'tattoo',
  'veterinar', 'dental', 'optometr', 'garage', 'upholster',
  // regulated / heavy
  'insurance', 'mortgage', 'underwrit', 'freight', 'logistics', 'warehouse',
  'manufactur', 'refiner', 'mining', 'agricultur', 'fishery', 'airline',
  // education / research
  'classroom', 'curriculum', 'syllabus', 'student', 'thesis', 'laborator',
  // other named verticals
  'travel', 'hotel', 'itinerary', 'wedding', 'florist', 'real estate',
  'construction', 'architect', 'law firm', 'legal brief', 'courtroom',
];

// ── loading ──────────────────────────────────────────────────────────────────

/** Parse gates/gates.yaml. */
export function loadGates(gatesPath = path.join(ROOT, 'gates/gates.yaml')) {
  const doc = yaml.load(readFileSync(gatesPath, 'utf8'));
  if (!Array.isArray(doc?.gates)) throw new Error(`no gates array in ${gatesPath}`);
  return doc.gates;
}

/**
 * Collect every stylesheet the page actually applies: inline <style> blocks plus
 * any local <link rel=stylesheet>. Remote hrefs are skipped — the scorer reads
 * the repo, not the network.
 */
export function collectCss($, htmlPath) {
  const parts = [];
  $('style').each((_, el) => parts.push($(el).text()));
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || /^(https?:)?\/\//.test(href) || href.startsWith('data:')) return;
    const abs = path.resolve(path.dirname(htmlPath), href.split('?')[0]);
    if (existsSync(abs)) parts.push(readFileSync(abs, 'utf8'));
  });
  return parts.join('\n');
}

/** Every non-generic family named in any font-family declaration. */
export function declaredFamilies(css) {
  const found = new Set();
  for (const match of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim().replace(/^['"]|['"]$/g, '');
      if (!name || name.startsWith('var(')) continue;
      if (GENERIC_FAMILIES.has(name.toLowerCase())) continue;
      found.add(name);
    }
  }
  return [...found];
}

/** Normalized visible text of a selection, with script/style stripped. */
function textOf($, selection) {
  const clone = selection.clone();
  clone.find('script, style').remove();
  return clone.text().replace(/\s+/g, ' ').trim();
}

const pass = (evidence) => ({ passed: true, evidence });
const fail = (evidence) => ({ passed: false, evidence });

// ── DOM checks (cheerio) ─────────────────────────────────────────────────────

const DOM_CHECKS = {
  'font-allowlist-link': ({ $ }) => {
    const links = $('link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]');
    if (links.length === 0) return fail('no Google Fonts link — page relies on a local or system face');
    const families = new Set();
    links.each((_, el) => {
      const href = $(el).attr('href') ?? '';
      for (const m of href.matchAll(/family=([^&:]+)/g)) {
        families.add(decodeURIComponent(m[1]).replace(/\+/g, ' '));
      }
    });
    const offenders = [...families].filter((f) => !FONT_ALLOWLIST.includes(f));
    return offenders.length === 0
      ? pass(`loads ${[...families].join(', ')} — all allowlisted`)
      : fail(`off-allowlist families loaded: ${offenders.join(', ')}`);
  },

  'font-family-count': ({ css }) => {
    const families = declaredFamilies(css);
    return families.length === 1
      ? pass(`exactly one family declared: ${families[0]}`)
      : fail(`${families.length} non-generic families declared: ${families.join(', ') || '(none)'}`);
  },

  'italic-emphasis-in-heading': ({ $ }) => {
    const n = $('h1 em, h1 i, h2 em, h2 i').length;
    return n > 0
      ? pass(`${n} italicised emphasis word(s) inside headings`)
      : fail('no <em>/<i> inside any h1 or h2');
  },

  'hero-shape': ({ $ }) => {
    const hero = $('[data-slot="hero"]');
    if (hero.length === 0) return fail('no [data-slot="hero"]');
    const headline = hero.find('[data-slot="hero-headline"]').length;
    const subhead = hero.find('[data-slot="hero-subhead"]').length;
    const ctas = hero.find('[data-slot="hero-cta-primary"], [data-slot="hero-cta-secondary"]').length;
    if (!headline) return fail('hero has no headline slot');
    if (!subhead) return fail('hero has no subhead slot');
    if (ctas !== 2) return fail(`hero carries ${ctas} CTA(s), not 2`);
    return pass('headline + subhead + exactly 2 CTAs');
  },

  'logo-cloud': ({ $ }) => {
    const cloud = $('[data-slot="logo-cloud"]');
    if (cloud.length === 0) return fail('no [data-slot="logo-cloud"]');
    const items = cloud.find('.logos__item').length;
    if (items < 5) return fail(`logo cloud carries ${items} marks, needs 5+`);
    const prev = cloud.prevAll('[data-slot]').first().attr('data-slot');
    if (prev !== 'hero') return fail(`logo cloud follows "${prev ?? 'nothing'}", not the hero`);
    return pass(`${items} marks, directly under the hero`);
  },

  'nav-fingerprint': ({ $ }) => {
    const nav = $('[data-slot="nav"]');
    if (nav.length === 0) return fail('no [data-slot="nav"]');
    const wordmark = nav.find('[data-slot="wordmark"]').length;
    const links = nav.find('.nav__links a').length;
    const cta = nav.find('[data-slot="nav-cta"]').length;
    if (!wordmark) return fail('nav has no wordmark on the left');
    if (links < 4 || links > 5) return fail(`nav carries ${links} inline links, needs 4–5`);
    if (!cta) return fail('nav has no button on the right');
    return pass(`wordmark + ${links} inline links + right-hand button`);
  },

  'icon-above-heading': ({ $ }) => {
    const cards = $('.feature');
    if (cards.length === 0) return fail('no .feature cards');
    for (let i = 0; i < cards.length; i++) {
      const kids = $(cards[i]).children().toArray();
      const iconAt = kids.findIndex((k) => $(k).hasClass('feature__icon'));
      const headAt = kids.findIndex((k) => /^h[1-6]$/i.test(k.tagName));
      if (iconAt === -1) return fail(`feature card ${i + 1} has no icon`);
      if (headAt === -1) return fail(`feature card ${i + 1} has no heading`);
      if (iconAt > headAt) return fail(`feature card ${i + 1} puts its heading above its icon`);
    }
    return pass(`icon above heading on all ${cards.length} cards`);
  },

  'uniform-cards': ({ $ }) => {
    const cards = $('.feature');
    if (cards.length < 3) return fail(`${cards.length} feature cards, needs 3`);
    // Signature = tag + class list of every descendant, in document order.
    const signature = (el) =>
      $(el)
        .find('*')
        .toArray()
        .map((d) => `${d.tagName}.${($(d).attr('class') ?? '').split(/\s+/).sort().join('.')}`)
        .join('>');
    const sigs = cards.toArray().map(signature);
    return sigs.every((s) => s === sigs[0])
      ? pass(`all ${cards.length} cards structurally identical`)
      : fail('feature cards differ structurally from one another');
  },

  'stats-count': ({ $ }) => {
    const bar = $('[data-slot="stats"]');
    if (bar.length === 0) return fail('no [data-slot="stats"]');
    const n = bar.find('.stat').length;
    return n >= 3 && n <= 4
      ? pass(`${n} stat items`)
      : fail(`${n} stat items, needs 3–4`);
  },

  'pricing-tiers': ({ $ }) => {
    const n = $('[data-slot="pricing"] .tier').length;
    return n === 3 ? pass('exactly 3 tiers') : fail(`${n} pricing tiers, needs exactly 3`);
  },

  'most-popular-middle': ({ $ }) => {
    const tiers = $('[data-slot="pricing"] .tier').toArray();
    if (tiers.length !== 3) return fail(`${tiers.length} tiers — cannot have a middle one`);
    const badged = tiers.map(
      (t) => $(t).hasClass('tier--popular') || /most popular/i.test($(t).text()),
    );
    if (!badged[1]) return fail('middle tier is not badged Most Popular');
    if (badged[0] || badged[2]) return fail('a tier other than the middle one is badged');
    return pass('middle tier, and only the middle tier, badged Most Popular');
  },

  'carousel-dots': ({ $ }) => {
    const section = $('[data-slot="testimonials"]');
    if (section.length === 0) return fail('no [data-slot="testimonials"]');
    const track = section.find('[data-carousel], .carousel');
    if (track.length === 0) return fail('testimonials are not in a carousel');
    const dots = section.find('.carousel__dots button, .carousel__dots [role="button"]').length;
    return dots >= 3
      ? pass(`carousel with ${dots} dot controls`)
      : fail(`carousel has ${dots} dot controls, needs 3+`);
  },

  'faq-accordion': ({ $ }) => {
    const items = $('[data-slot="faq"] details');
    if (items.length < 4) return fail(`${items.length} details items, needs 4+`);
    const withSummary = items.filter((_, el) => $(el).children('summary').length > 0).length;
    return withSummary === items.length
      ? pass(`${items.length}-item details/summary accordion`)
      : fail(`${items.length - withSummary} details element(s) have no summary`);
  },

  'cta-banner-position': ({ $ }) => {
    const order = $('[data-slot]')
      .toArray()
      .map((el) => $(el).attr('data-slot'));
    const at = (name) => order.indexOf(name);
    const banner = at('cta-banner');
    if (banner === -1) return fail('no [data-slot="cta-banner"]');
    if (at('faq') === -1 || banner < at('faq')) return fail('CTA banner does not follow the FAQ');
    if (at('footer') === -1 || banner > at('footer')) return fail('CTA banner does not precede the footer');
    return pass('sits between the FAQ and the footer');
  },

  'footer-four-col': ({ $ }) => {
    const n = $('[data-slot="footer"] .footer__col').length;
    return n === 4 ? pass('exactly 4 footer columns') : fail(`${n} footer columns, needs exactly 4`);
  },

  'footer-col-titles': ({ $ }) => {
    const titles = $('[data-slot="footer"] .footer__col-title')
      .toArray()
      .map((el) => $(el).text().trim().toLowerCase());
    const missing = FOOTER_COLUMNS.filter((c) => !titles.includes(c));
    return missing.length === 0 && titles.length === 4
      ? pass(`columns titled ${titles.join(' / ')}`)
      : fail(`footer headings are [${titles.join(', ') || 'none'}]; missing ${missing.join(', ') || 'none'}`);
  },

  'section-order': ({ $ }) => {
    const wanted = new Set(CANONICAL_SECTIONS);
    const seen = [];
    $('[data-slot]').each((_, el) => {
      const slot = $(el).attr('data-slot');
      if (wanted.has(slot) && seen[seen.length - 1] !== slot) seen.push(slot);
    });
    return JSON.stringify(seen) === JSON.stringify(CANONICAL_SECTIONS)
      ? pass('canonical order, start to finish')
      : fail(`order is [${seen.join(' → ')}]`);
  },

  'reveal-on-every-section': ({ $ }) => {
    const sections = $('main > section').toArray();
    if (sections.length === 0) return fail('no top-level sections in <main>');
    const bare = sections.filter(
      (s) => $(s).attr('data-reveal') === undefined && !$(s).hasClass('reveal'),
    );
    return bare.length === 0
      ? pass(`all ${sections.length} sections carry a reveal hook`)
      : fail(`${bare.length} section(s) arrive without a scroll reveal`);
  },

  'no-reduced-motion': ({ css }) =>
    /prefers-reduced-motion/i.test(css)
      ? fail('a prefers-reduced-motion block is present')
      : pass('no reduced-motion fallback anywhere'),
};

// ── text checks (cheerio) ────────────────────────────────────────────────────

const TEXT_CHECKS = {
  'unsourced-stats': ({ $ }) => {
    const text = textOf($, $('[data-slot="stats"]'));
    if (!text) return fail('no stats bar to check');
    const sourcing = text.match(/\bsource[sd]?\b|\bas of\b|\baccording to\b|\[\d+\]|†|‡|\bn\s*=\s*\d/i);
    return sourcing
      ? fail(`a stat carries sourcing: "${sourcing[0]}"`)
      : pass('no source, footnote, or date on any stat');
  },

  'testimonial-attribution': ({ $ }) => {
    const caps = $('[data-slot="testimonials"] figcaption').toArray();
    if (caps.length < 3) return fail(`${caps.length} attributed testimonials, needs 3+`);
    // Name · Title · Company, in any of the usual separators.
    const shape = /^[A-Z][a-z]+ [A-Z][A-Za-z'’.-]+\s*[,·–—]\s*[^,·–—]{3,}\s*[,·–—]\s*.{2,}$/;
    for (const [i, cap] of caps.entries()) {
      const t = textOf($, $(cap));
      if (!shape.test(t)) return fail(`testimonial ${i + 1} attribution is not name/title/company: "${t}"`);
    }
    return pass(`${caps.length} testimonials, each name + title + company`);
  },

  'template-swap': ({ $ }) => {
    const quotes = $('[data-slot="testimonials"] blockquote').toArray();
    if (quotes.length === 0) return fail('no testimonial quotes');
    for (const [i, q] of quotes.entries()) {
      const t = textOf($, $(q)).toLowerCase();
      const hit = INDUSTRY_MARKERS.find((m) => t.includes(m));
      if (hit) return fail(`quote ${i + 1} names "${hit}" — would not survive a company swap`);
    }
    return pass(`all ${quotes.length} quotes free of industry markers — fully interchangeable`);
  },

  'cta-label-pool': ({ $ }) => {
    const labels = $('.btn')
      .toArray()
      .map((el) => textOf($, $(el)).toLowerCase().replace(/\s*[→›»]\s*$/, '').trim())
      .filter(Boolean);
    if (labels.length === 0) return fail('no .btn CTAs found');
    const offenders = labels.filter((l) => !CTA_POOL.has(l));
    return offenders.length === 0
      ? pass(`all ${labels.length} CTA labels from the pool`)
      : fail(`off-pool CTA label(s): ${[...new Set(offenders)].map((o) => `"${o}"`).join(', ')}`);
  },

  'faq-voice': ({ $ }) => {
    const items = $('[data-slot="faq"] details').toArray();
    if (items.length === 0) return fail('no FAQ items');
    for (const [i, item] of items.entries()) {
      const q = textOf($, $(item).children('summary'));
      const a = textOf($, $(item)).slice(q.length);
      if (!/\byou\b|\byour\b|\bI\b/i.test(q)) return fail(`FAQ question ${i + 1} does not address the reader: "${q}"`);
      if (!/\bwe\b|\bour\b|\bus\b/i.test(a)) return fail(`FAQ answer ${i + 1} is not in the first-person plural`);
    }
    return pass(`all ${items.length} items ask "you", answer "we"`);
  },

  'brief-keyword-leak': ({ $, discarded }) => {
    if (!discarded || discarded.length === 0) return pass('no discard log to check against');
    const text = textOf($, $('body')).toLowerCase();
    const leaked = discarded.filter((term) => text.includes(String(term).toLowerCase()));
    return leaked.length === 0
      ? pass(`none of ${discarded.length} discarded brief term(s) reached the page`)
      : fail(`brief term(s) leaked into the copy: ${leaked.join(', ')}`);
  },
};

/** Generic text gate: match `pattern` against the text inside `selector`. */
function genericTextCheck(gate, { $ }) {
  const scope = gate.selector ? $(gate.selector) : $('body');
  if (scope.length === 0) return fail(`nothing matches ${gate.selector}`);
  const text = textOf($, scope);
  const re = new RegExp(gate.pattern, 'i');
  const m = text.match(re);
  return m ? pass(`matched "${m[0]}"`) : fail(`no match for /${gate.pattern}/i`);
}

// ── scoring ──────────────────────────────────────────────────────────────────

/** Read the Phase 7 discard log, if one exists. */
function readDiscarded(htmlPath) {
  for (const dir of [path.dirname(htmlPath), ROOT]) {
    const p = path.join(dir, '.slopify/discarded.json');
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8'));
      return Array.isArray(raw) ? raw : (raw.discarded ?? []);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Score one HTML file against every gate.
 * @returns {Promise<{slopScore: number, total: number, manual: number, results: Array<{gateId: string, category: string, checkType: string, passed: boolean, evidence: string}>}>}
 */
export async function scoreHtml(htmlPath, { gates = loadGates() } = {}) {
  const abs = path.resolve(htmlPath);
  const html = readFileSync(abs, 'utf8');
  const $ = cheerio.load(html);
  const ctx = { $, html, htmlPath: abs, css: collectCss($, abs), discarded: readDiscarded(abs) };

  const results = [];
  for (const gate of gates) {
    results.push({
      gateId: gate.id,
      category: gate.category,
      checkType: gate.check_type,
      ...(await runGate(gate, ctx)),
    });
  }

  return {
    slopScore: results.filter((r) => r.passed).length,
    total: gates.length,
    manual: results.filter((r) => r.checkType === 'manual').length,
    results,
  };
}

async function runGate(gate, ctx) {
  try {
    if (gate.check_type === 'manual') {
      return pass('manual gate — not machine-checkable, recorded as satisfied');
    }
    if (gate.check_type === 'dom') {
      const check = DOM_CHECKS[gate.handler];
      if (!check) return fail(`no DOM handler "${gate.handler}"`);
      return check(ctx);
    }
    if (gate.check_type === 'text') {
      if (gate.handler) {
        const check = TEXT_CHECKS[gate.handler];
        if (!check) return fail(`no text handler "${gate.handler}"`);
        return check(ctx);
      }
      return genericTextCheck(gate, ctx);
    }
    // css gates land in commit 7.
    return fail('css engine not wired yet');
  } catch (err) {
    return fail(`check threw: ${err.message}`);
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export function formatTable(report) {
  const lines = [];
  for (const r of report.results) {
    const mark = r.passed ? 'PASS' : 'FAIL';
    lines.push(`${mark}  ${r.gateId}  ${r.category.padEnd(14)} ${r.evidence}`);
  }
  lines.push('');
  lines.push(`slopScore: ${report.slopScore} / ${report.total}`);
  return lines.join('\n');
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: node scripts/score.mjs <file.html>');
    process.exit(2);
  }
  const report = await scoreHtml(target);
  console.log(formatTable(report));
  process.exit(report.slopScore < report.total ? 1 : 0);
}
