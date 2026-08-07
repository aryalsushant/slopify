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
import { chromium } from 'playwright';
import { parse as parseColor, converter } from 'culori';
import { checkDistinctiveness } from './distinctiveness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

export const TOTAL_GATES = 57;

/**
 * Fixed viewport for every computed-style read. Hallmark's gate 44 tests the
 * hero at 1280x800 rather than 1440x900, so the same laptop viewport is used
 * here for the area and fold measurements.
 */
export const VIEWPORT = { width: 1280, height: 800 };

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

// ── css checks (Playwright computed styles) ──────────────────────────────────
//
// The declared value in a stylesheet is not the value that renders, so these
// gates read getComputedStyle in a real headless Chromium at a fixed viewport.
// A handful reach into the CSSOM instead, because :hover styling has no
// computed form to read at rest.

/** Read named properties off the first match, or null when nothing matches. */
async function computedOne(page, selector, props) {
  return page.evaluate(
    ({ selector, props }) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
    },
    { selector, props },
  );
}

/** Read named properties off every match. */
async function computedAll(page, selector, props) {
  return page.evaluate(
    ({ selector, props }) => {
      return [...document.querySelectorAll(selector)].map((el) => {
        const cs = getComputedStyle(el);
        const out = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
        const r = el.getBoundingClientRect();
        out._tag = el.tagName.toLowerCase();
        out._class = el.getAttribute('class') ?? '';
        out._rect = { x: r.x, y: r.y, width: r.width, height: r.height };
        return out;
      });
    },
    { selector, props },
  );
}

/** First family in a computed font-family stack, unquoted. */
export function firstFamily(stack) {
  return (stack ?? '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
}

/** Parse a px length, or NaN. */
const px = (v) => parseFloat(String(v ?? ''));

// ── colour science (culori) ──────────────────────────────────────────────────
//
// Gradient direction and neutral-tint checks are done in OKLCH, not by matching
// CSS strings. Chromium normalises authored hexes into rgb()/rgba() and may
// reorder or expand stops, so a string match would be checking the serialiser
// rather than the design. Comparing hue and chroma survives all of that.

const toOklch = converter('oklch');

/** Convert any CSS colour string to OKLCH, or null if it isn't a colour. */
export function oklchOf(value) {
  const parsed = parseColor(String(value ?? '').trim());
  if (!parsed) return null;
  const c = toOklch(parsed);
  return { l: c.l ?? 0, c: c.c ?? 0, h: c.h ?? 0, alpha: parsed.alpha ?? 1 };
}

/** Pull the colour stops out of a computed gradient, in order. */
export function gradientStops(backgroundImage) {
  const stops = [];
  for (const m of String(backgroundImage ?? '').matchAll(
    /rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g,
  )) {
    const c = oklchOf(m[0]);
    if (c) stops.push(c);
  }
  return stops;
}

/**
 * Hue bands for the two canonical slop gradients, measured off the reference
 * palette: violet #7C3AED sits at hue 293, pink #EC4899 at 354, blue #3B82F6
 * at 260, cyan #06B6D4 at 215.
 */
const GRADIENT_DIRECTIONS = [
  {
    name: 'purple → pink',
    from: (h) => h >= 270 && h <= 325,
    to: (h) => h >= 325 || h <= 15,
  },
  {
    name: 'blue → cyan',
    from: (h) => h >= 240 && h < 280,
    to: (h) => h >= 185 && h < 240,
  },
];

/** Is this gradient one of the two canonical directions? */
export function classifyGradient(backgroundImage) {
  const stops = gradientStops(backgroundImage).filter((s) => s.alpha > 0 && s.c >= 0.08);
  if (stops.length < 2) return null;
  const from = stops[0];
  const to = stops[stops.length - 1];
  for (const dir of GRADIENT_DIRECTIONS) {
    if (dir.from(from.h) && dir.to(to.h)) {
      return { name: dir.name, fromHue: from.h, toHue: to.h };
    }
  }
  return null;
}

const CSS_CHECKS = {
  'font-allowlist-computed': async (page) => {
    const s = await computedOne(page, 'body', ['font-family']);
    if (!s) return fail('no body element');
    const family = firstFamily(s['font-family']);
    return FONT_ALLOWLIST.includes(family)
      ? pass(`body resolves to ${family}`)
      : fail(`body resolves to ${family || '(empty)'}, which is off-allowlist`);
  },

  'single-family-page': async (page) => {
    const head = await computedOne(page, '[data-slot="hero-headline"]', ['font-family']);
    const body = await computedOne(page, 'body', ['font-family']);
    if (!head) return fail('no hero headline slot');
    const h = firstFamily(head['font-family']);
    const b = firstFamily(body['font-family']);
    return h === b
      ? pass(`headline and body both ${h} — no pairing`)
      : fail(`headline is ${h} against body ${b} — that is a type pairing`);
  },

  'body-weight-cap': async (page) => {
    const s = await computedOne(page, 'body', ['font-weight']);
    const w = px(s?.['font-weight']);
    return w <= 400
      ? pass(`body weight ${w}`)
      : fail(`body weight ${w} exceeds 400, so it was chosen`);
  },

  'gradient-text-fill': async (page, _ctx, gate) => {
    const els = await computedAll(page, gate.selector, [
      'background-clip',
      '-webkit-background-clip',
      'background-image',
      'color',
      '-webkit-text-fill-color',
    ]);
    const hit = els.find(
      (e) =>
        (e['background-clip'] === 'text' || e['-webkit-background-clip'] === 'text') &&
        /gradient\(/.test(e['background-image']) &&
        /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(
          `${e['-webkit-text-fill-color']} ${e['color']}`,
        ),
    );
    return hit
      ? pass(`gradient text fill on ${hit._tag}.${hit._class}`)
      : fail('no heading combines background-clip: text with a gradient and transparent fill');
  },

  'uppercase-tracking': async (page, _ctx, gate) => {
    const els = await computedAll(page, gate.selector, ['letter-spacing', 'text-transform']);
    if (els.length === 0) return fail(`nothing matches ${gate.selector}`);
    const flat = els.filter((e) => !(px(e['letter-spacing']) > 0));
    return flat.length === 0
      ? pass(`all ${els.length} uppercase labels tracked out`)
      : fail(`${flat.length} label(s) at non-positive tracking (e.g. .${flat[0]._class})`);
  },

  'loose-display-leading': async (page, _ctx, gate) => {
    const s = await computedOne(page, gate.selector, ['line-height', 'font-size']);
    if (!s) return fail(`nothing matches ${gate.selector}`);
    const ratio = px(s['line-height']) / px(s['font-size']);
    return ratio >= 1.1
      ? pass(`display leading at ${ratio.toFixed(2)}`)
      : fail(`display leading at ${ratio.toFixed(2)} — tighter than 1.1 only happens on purpose`);
  },

  'default-body-size': async (page) => {
    const s = await computedOne(page, 'body', ['font-size']);
    return px(s?.['font-size']) === 16
      ? pass('body at the untouched 16px default')
      : fail(`body font-size is ${s?.['font-size']}, not 16px`);
  },

  'gradient-angle-135': async (page, _ctx, gate) => {
    const els = await computedAll(page, gate.selector, ['background-image']);
    const hit = els.find((e) => /linear-gradient\(\s*135deg/.test(e['background-image']));
    return hit
      ? pass(`135deg gradient on ${hit._tag}.${hit._class}`)
      : fail('no 135deg linear-gradient on any heading or CTA');
  },

  'gradient-hue-direction': async (page, _ctx, gate) => {
    const els = await computedAll(page, gate.selector, ['background-image']);
    const gradients = els.filter((e) => /gradient\(/.test(e['background-image']));
    if (gradients.length === 0) return fail('no gradient on any heading or CTA');
    for (const e of gradients) {
      const hit = classifyGradient(e['background-image']);
      if (hit) {
        return pass(
          `${hit.name} on ${e._tag}.${e._class} (hue ${hit.fromHue.toFixed(0)} → ${hit.toHue.toFixed(0)})`,
        );
      }
    }
    const stops = gradientStops(gradients[0]['background-image']);
    return fail(
      `gradient hue direction is off-canon (${stops.map((s) => s.h.toFixed(0)).join(' → ')})`,
    );
  },

  'light-tint-section': async (page, _ctx, gate) => {
    const els = await computedAll(page, gate.selector, ['background-color']);
    if (els.length === 0) return fail(`nothing matches ${gate.selector}`);
    for (const e of els) {
      const c = oklchOf(e['background-color']);
      if (!c || c.alpha === 0) continue;
      if (c.l >= 0.95 && c.c >= 0.005 && c.c <= 0.05) {
        return pass(
          `.${e._class.split(/\s+/)[0]} tinted at L ${c.l.toFixed(3)} / C ${c.c.toFixed(4)}`,
        );
      }
    }
    return fail('no section background lands in the very-light tint band (L ≥ 0.95, C 0.005–0.05)');
  },

  'slate-body-ink': async (page) => {
    const s = await computedOne(page, 'body', ['color']);
    const c = oklchOf(s?.color);
    if (!c) return fail(`body colour reads "${s?.color}"`);
    return c.l >= 0.3 && c.l <= 0.6 && c.c <= 0.04
      ? pass(`body ink at L ${c.l.toFixed(3)} / C ${c.c.toFixed(4)} — standard slate`)
      : fail(`body ink at L ${c.l.toFixed(3)} / C ${c.c.toFixed(4)} sits outside the slate band`);
  },

  /**
   * Accent footprint by area. Candidates are elements painted with a gradient or
   * a chromatic background; their rects are rasterised onto a 10px grid over the
   * first viewport so overlapping paint is counted once rather than summed.
   */
  'accent-footprint': async (page) => {
    const painted = await page.evaluate(() => {
      return [...document.querySelectorAll('*')]
        .map((el) => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return {
            bgImage: cs.backgroundImage,
            bgColor: cs.backgroundColor,
            rect: { x: r.x, y: r.y, width: r.width, height: r.height },
          };
        })
        .filter((e) => e.rect.width > 0 && e.rect.height > 0);
    });

    const accent = painted.filter((e) => {
      if (/gradient\(/.test(e.bgImage)) return true;
      const c = oklchOf(e.bgColor);
      return Boolean(c) && c.alpha > 0 && c.c >= 0.08;
    });
    if (accent.length === 0) return fail('no accent-painted element on the page');

    const CELL = 10;
    const cols = Math.ceil(VIEWPORT.width / CELL);
    const rows = Math.ceil(VIEWPORT.height / CELL);
    const covered = new Uint8Array(cols * rows);
    for (const { rect } of accent) {
      const x0 = Math.max(0, Math.floor(rect.x / CELL));
      const x1 = Math.min(cols - 1, Math.floor((rect.x + rect.width) / CELL));
      const y0 = Math.max(0, Math.floor(rect.y / CELL));
      const y1 = Math.min(rows - 1, Math.floor((rect.y + rect.height) / CELL));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) covered[y * cols + x] = 1;
      }
    }
    const share = covered.reduce((a, b) => a + b, 0) / covered.length;
    const pct = (share * 100).toFixed(1);
    return share > 0.05
      ? pass(`accent covers ${pct}% of the fold — well past the 5% restraint ceiling`)
      : fail(`accent covers only ${pct}% of the fold, which reads as restraint`);
  },

  'icon-in-circle': async (page, _ctx, gate) => {
    const els = await computedAll(page, gate.selector, ['border-radius', 'background-color']);
    if (els.length === 0) return fail(`nothing matches ${gate.selector}`);
    for (const e of els) {
      const raw = e['border-radius'];
      const round = raw.includes('%')
        ? px(raw) >= 50
        : px(raw) >= e._rect.width / 2 - 0.5;
      if (!round) return fail(`an icon frame is not a circle (border-radius ${raw})`);
      const c = oklchOf(e['background-color']);
      if (!c || c.alpha === 0 || c.c < 0.02) {
        return fail(`an icon frame is not on a tinted ground (${e['background-color']})`);
      }
    }
    return pass(`all ${els.length} icons circle-framed on a tinted accent ground`);
  },

  'popular-tier-lift': async (page, _ctx, gate) => {
    const popular = await computedOne(page, gate.selector, [
      'transform',
      'box-shadow',
      'border-top-color',
      'border-top-width',
    ]);
    if (!popular) return fail(`nothing matches ${gate.selector}`);
    if (popular.transform === 'none') return fail('popular tier carries no transform');
    if (!popular['box-shadow'] || popular['box-shadow'] === 'none') {
      return fail('popular tier carries no shadow');
    }
    const border = oklchOf(popular['border-top-color']);
    if (!border || border.c < 0.05) {
      return fail(`popular tier border is not accent-coloured (${popular['border-top-color']})`);
    }
    const siblings = await computedAll(page, '.tier:not(.tier--popular)', ['transform']);
    const alsoLifted = siblings.filter((s) => s.transform !== 'none');
    return alsoLifted.length === 0
      ? pass('popular tier lifted, accent-bordered, and shadowed above flat siblings')
      : fail(`${alsoLifted.length} sibling tier(s) are lifted too, so nothing stands out`);
  },

  'radius-band': async (page, _ctx, gate) => {
    const s = await computedOne(page, gate.selector, ['border-radius', 'width']);
    if (!s) return fail(`nothing matches ${gate.selector}`);
    const r = px(s['border-radius']);
    if (Number.isNaN(r)) return fail(`border-radius reads "${s['border-radius']}"`);
    if (r >= 9999) return pass(`fully pilled at ${r}px`);
    if (r >= 12 && r <= 16) return pass(`inside the 12–16px band at ${r}px`);
    return fail(`radius ${r}px falls outside both default bands, so somebody picked it`);
  },

  'pure-white-base': async (page) => {
    const s = await computedOne(page, 'body', ['background-color']);
    const bg = (s?.['background-color'] ?? '').replace(/\s+/g, '');
    return bg === 'rgb(255,255,255)'
      ? pass('base paper is pure #fff')
      : fail(`base background is ${s?.['background-color']}, not pure white`);
  },

  'gradient-reuse': async (page) => {
    const els = await computedAll(page, '*', ['background-image']);
    const counts = new Map();
    for (const e of els) {
      const img = e['background-image'];
      if (!/gradient\(/.test(img)) continue;
      counts.set(img, (counts.get(img) ?? 0) + 1);
    }
    const reused = [...counts.entries()].filter(([, n]) => n >= 2);
    return reused.length > 0
      ? pass(`one gradient reused verbatim on ${reused[0][1]} elements`)
      : fail(`${counts.size} gradient(s) on the page, none reused verbatim`);
  },

  'hero-centred-axis': async (page) => {
    const data = await page.evaluate(() => {
      const hero = document.querySelector('[data-slot="hero"]');
      if (!hero) return null;
      const hr = hero.getBoundingClientRect();
      const parts = ['hero-eyebrow', 'hero-headline', 'hero-subhead'].map((slot) => {
        const el = hero.querySelector(`[data-slot="${slot}"]`);
        if (!el) return { slot, missing: true };
        const r = el.getBoundingClientRect();
        return {
          slot,
          textAlign: getComputedStyle(el).textAlign,
          centre: r.x + r.width / 2,
        };
      });
      const row = hero.querySelector('.hero__ctas');
      if (row) {
        const r = row.getBoundingClientRect();
        parts.push({
          slot: 'hero-ctas',
          textAlign: getComputedStyle(row).textAlign,
          centre: r.x + r.width / 2,
        });
      }
      return { heroCentre: hr.x + hr.width / 2, parts };
    });
    if (!data) return fail('no hero');
    const missing = data.parts.find((p) => p.missing);
    if (missing) return fail(`hero is missing ${missing.slot}`);
    const offAxis = data.parts.filter(
      (p) => p.textAlign !== 'center' || Math.abs(p.centre - data.heroCentre) > 2,
    );
    return offAxis.length === 0
      ? pass(`all ${data.parts.length} hero elements on one centred axis`)
      : fail(`${offAxis.map((p) => p.slot).join(', ')} sits off the centred axis`);
  },

  'hero-min-height': async (page, _ctx, gate) => {
    const s = await computedOne(page, gate.selector, ['min-height']);
    if (!s) return fail('no hero');
    const floor = VIEWPORT.height * 0.8;
    const h = px(s['min-height']);
    return h >= floor
      ? pass(`min-height ${Math.round(h)}px against a ${floor}px floor`)
      : fail(`min-height ${Number.isNaN(h) ? s['min-height'] : Math.round(h) + 'px'} is under the ${floor}px floor`);
  },

  'three-equal-columns': async (page, _ctx, gate) => {
    const s = await computedOne(page, gate.selector, ['grid-template-columns']);
    if (!s) return fail(`nothing matches ${gate.selector}`);
    const tracks = s['grid-template-columns'].trim().split(/\s+/).map(px);
    if (tracks.length !== 3) return fail(`${tracks.length} grid tracks, needs exactly 3`);
    const spread = Math.max(...tracks) - Math.min(...tracks);
    return spread <= 1
      ? pass(`3 equal tracks at ${Math.round(tracks[0])}px`)
      : fail(`3 tracks but unequal (spread ${spread.toFixed(1)}px) — size variation is rhythm`);
  },

  'uniform-reveal-timing': async (page, _ctx, gate) => {
    const els = await computedAll(page, gate.selector, [
      'transition-duration',
      'transition-timing-function',
    ]);
    if (els.length === 0) return fail(`nothing matches ${gate.selector}`);
    const key = (e) => `${e['transition-duration']}|${e['transition-timing-function']}`;
    const distinct = new Set(els.map(key));
    if (distinct.size > 1) return fail(`${distinct.size} distinct reveal timings across sections`);
    if (px(els[0]['transition-duration']) <= 0) return fail('reveal transition has no duration');
    return pass(`one timing across all ${els.length} sections: ${els[0]['transition-duration']}`);
  },

  'transition-all': async (page, _ctx, gate) => {
    const els = await computedAll(page, gate.selector, ['transition-property']);
    if (els.length === 0) return fail(`nothing matches ${gate.selector}`);
    const named = els.filter((e) => e['transition-property'] !== 'all');
    return named.length === 0
      ? pass(`all ${els.length} interactive elements transition on "all"`)
      : fail(`${named.length} element(s) name their transition properties (e.g. "${named[0]['transition-property']}")`);
  },

  // :hover has no computed form at rest, so these two read the CSSOM.
  'hover-lift-shadow': async (page) => {
    const rules = await hoverRules(page);
    const lift = rules.find(
      (r) => /translateY\(\s*-\s*[\d.]+/.test(r.transform) && r.boxShadow && r.boxShadow !== 'none',
    );
    return lift
      ? pass(`lift + shadow stacked on "${lift.selectorText}"`)
      : fail('no hover rule stacks a negative translateY with a box-shadow');
  },

  'uniform-hover-scale': async (page) => {
    const rules = await hoverRules(page);
    const scales = new Map();
    for (const r of rules) {
      const m = r.transform.match(/scale\(\s*([\d.]+)/);
      if (!m) continue;
      for (const sel of r.selectorText.split(',')) {
        scales.set(sel.trim(), m[1]);
      }
    }
    const wanted = ['.btn', '.feature', '.tier'];
    const found = wanted.map((w) => [w, scales.get(`${w}:hover`)]);
    const missing = found.filter(([, v]) => v === undefined).map(([k]) => k);
    if (missing.length) return fail(`no hover scale on ${missing.join(', ')}`);
    const factors = new Set(found.map(([, v]) => v));
    return factors.size === 1
      ? pass(`one scale factor (${[...factors][0]}) across button, card, and tier`)
      : fail(`hover scale varies by element type: ${[...factors].join(', ')}`);
  },

  'floating-blob': async (page, _ctx, gate) => {
    const els = await computedAll(page, gate.selector, [
      'filter',
      'background-image',
      'animation-name',
      'animation-iteration-count',
    ]);
    if (els.length === 0) return fail('no blob decoration on the page');
    const hit = els.find(
      (e) =>
        /blur\(/.test(e.filter) &&
        /gradient\(/.test(e['background-image']) &&
        e['animation-name'] !== 'none' &&
        e['animation-iteration-count'] === 'infinite',
    );
    return hit
      ? pass(`blurred gradient blob "${hit._class}" on an infinite ${hit['animation-name']} loop`)
      : fail(`${els.length} blob element(s), none blurred + gradient-filled + infinitely animated`);
  },

  /**
   * The self-sabotage meta-gate. Runs last, and needs its own pages rather than
   * the shared one — it captures two normalized screenshots and diffs them. See
   * scripts/distinctiveness.mjs.
   */
  distinctiveness: async (page, ctx) => {
    const { passed, evidence } = await checkDistinctiveness(ctx.htmlPath, {
      browser: page.context().browser(),
      goldenPath: ctx.goldenPath,
      threshold: ctx.threshold,
    });
    return { passed, evidence };
  },
};

/** Every :hover rule in the document, flattened out of the CSSOM. */
async function hoverRules(page) {
  return page.evaluate(() => {
    const out = [];
    const walk = (list) => {
      for (const rule of list) {
        if (rule.cssRules) walk(rule.cssRules);
        if (!rule.selectorText || !rule.selectorText.includes(':hover')) continue;
        out.push({
          selectorText: rule.selectorText,
          transform: rule.style.transform || '',
          boxShadow: rule.style.boxShadow || '',
        });
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules);
      } catch {
        /* cross-origin sheet; skip */
      }
    }
    return out;
  });
}

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
export async function scoreHtml(
  htmlPath,
  { gates = loadGates(), browser: given, goldenPath, threshold } = {},
) {
  const abs = path.resolve(htmlPath);
  const html = readFileSync(abs, 'utf8');
  const $ = cheerio.load(html);
  const ctx = {
    $,
    html,
    htmlPath: abs,
    css: collectCss($, abs),
    discarded: readDiscarded(abs),
    goldenPath,
    threshold,
  };

  const needsBrowser = gates.some((g) => g.check_type === 'css');
  const browser = needsBrowser ? (given ?? (await chromium.launch())) : null;
  let page = null;

  try {
    if (browser) {
      page = await browser.newPage({ viewport: VIEWPORT });
      // Blocking remote font requests keeps scoring deterministic and offline;
      // SLOP-001 already checks the <link> in the markup, and the computed
      // family gates read the declared stack rather than the loaded file.
      await page.route('**://fonts.googleapis.com/**', (r) => r.abort());
      await page.route('**://fonts.gstatic.com/**', (r) => r.abort());
      await page.goto(pathToFileURL(abs).href, { waitUntil: 'load' });
    }

    const results = [];
    for (const gate of gates) {
      results.push({
        gateId: gate.id,
        category: gate.category,
        checkType: gate.check_type,
        ...(await runGate(gate, ctx, page)),
      });
    }

    return {
      slopScore: results.filter((r) => r.passed).length,
      total: gates.length,
      manual: results.filter((r) => r.checkType === 'manual').length,
      results,
    };
  } finally {
    if (page) await page.close();
    if (browser && !given) await browser.close();
  }
}

async function runGate(gate, ctx, page) {
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
    if (gate.check_type === 'css') {
      if (!page) return fail('css gate needs a browser page');
      const check = CSS_CHECKS[gate.handler];
      if (!check) return fail(`no css handler "${gate.handler}"`);
      return check(page, ctx, gate);
    }
    return fail(`unknown check_type "${gate.check_type}"`);
  } catch (err) {
    return fail(`check threw: ${err.message}`);
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

/** Gate ids that did not pass, in id order. */
export function failingGates(report) {
  return report.results.filter((r) => !r.passed).map((r) => r.gateId);
}

const CATEGORY_ORDER = ['typography', 'color', 'layout', 'motion', 'copy', 'self_sabotage'];

export function formatTable(report, { target = '' } = {}) {
  const lines = [];
  if (target) lines.push(`Slopify · gate scorer · ${target}`, '');

  for (const category of CATEGORY_ORDER) {
    const rows = report.results.filter((r) => r.category === category);
    if (rows.length === 0) continue;
    const passed = rows.filter((r) => r.passed).length;
    lines.push(`${category}  (${passed}/${rows.length})`);
    for (const r of rows) {
      lines.push(`  ${r.passed ? 'PASS' : 'FAIL'}  ${r.gateId}  ${r.evidence}`);
    }
    lines.push('');
  }

  const failing = failingGates(report);
  lines.push(`slopScore: ${report.slopScore} / ${report.total}`);
  if (report.manual > 0) {
    lines.push(`${report.manual} gate(s) are manual and were recorded as satisfied.`);
  }
  if (failing.length === 0) {
    lines.push('Ship it. Nothing about this page is memorable.');
  } else {
    lines.push(`Blocked. ${failing.length} gate(s) unsatisfied: ${failing.join(', ')}`);
    lines.push('Those are the parts of the page that are accidentally too good.');
  }
  return lines.join('\n');
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const target = args.find((a) => !a.startsWith('--'));

  if (!target) {
    console.error('usage: node scripts/score.mjs <file.html> [--json]');
    process.exit(2);
  }
  if (!existsSync(path.resolve(target))) {
    console.error(`score: no such file: ${target}`);
    process.exit(2);
  }

  const report = await scoreHtml(target);
  if (asJson) {
    console.log(JSON.stringify({ target, ...report }, null, 2));
  } else {
    console.log(formatTable(report, { target }));
  }
  // Non-zero unless the page is maximally generic. Hallmark's "one failure
  // blocks ship", pointed the other way.
  process.exit(report.slopScore < report.total ? 1 : 0);
}
