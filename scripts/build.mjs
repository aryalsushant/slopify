// The `slopify` verb (default).
//
// Brief in, maximally generic page out.
//
// Flow:
//   resolve theme -> apply the memory nudge -> fill the macrostructure with
//   generated copy -> score -> auto-patch any unsatisfied gate -> rescore ->
//   write output
//
// The auto-patch loop is deterministic fixups, not another model call: each
// patch is a named transformation keyed to the gate it satisfies. This is the
// inverse of Hallmark's Step 7, which runs the slop test and sends the build
// back to be fixed if any gate fails. Same loop, opposite target — here a
// failing gate means part of the page is too good, and the patch makes it worse.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { faker } from '@faker-js/faker';
import { resolveTheme, pickTheme, tokensToCss } from './themes.mjs';
import {
  generateCopy,
  discardLog as buildDiscardLog,
  formatDiscardNotice,
  HEADLINE_VERBS,
  HEADLINE_NOUNS,
  SUBHEADS,
  REASSURANCES,
  STATS,
  FAQS,
  FOOTER_COLUMNS,
  CTAS,
} from './copy-generator.mjs';
import {
  readLog,
  appendRecord,
  makeRecord,
  applyBriefJitter,
  nudgeTokens,
  formatConvergenceNotice,
} from './memory.mjs';
import { scoreHtml, failingGates, formatTable } from './score.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

export const TEMPLATE_PATH = path.join(ROOT, 'templates/macrostructure.html');

/** The line in the template's <style> that the token block replaces. */
const TOKEN_MARKER = /\/\* SLOPIFY:TOKENS[\s\S]*?\*\//;

/** Read the macrostructure template. */
export function loadTemplate(templatePath = TEMPLATE_PATH) {
  return readFileSync(templatePath, 'utf8');
}

/**
 * Fill the macrostructure with copy and tokens.
 *
 * Copy goes into data-slot targets only; no slot fill ever changes structure,
 * which is what keeps the layout gates satisfied for any brief. Values
 * containing markup are set as HTML (the headline needs its <em>), everything
 * else as text, so a brief cannot inject tags by accident.
 *
 * @param {{template: string, tokensCss: string, copy: Record<string,string>, stamp?: string}} args
 * @returns {string} complete HTML document
 */
export function renderPage({ template, tokensCss, copy, stamp }) {
  if (!TOKEN_MARKER.test(template)) {
    throw new Error('template has no SLOPIFY:TOKENS marker to replace');
  }
  const withTokens = template.replace(TOKEN_MARKER, () =>
    stamp ? `${stamp}\n\n${tokensCss}` : tokensCss,
  );

  const $ = cheerio.load(withTokens);
  const missing = [];

  for (const [slot, value] of Object.entries(copy)) {
    const el = $(`[data-slot="${slot}"]`);
    if (el.length === 0) {
      missing.push(slot);
      continue;
    }
    // The hero headline wraps its text in the gradient span; fill the span so the
    // gradient treatment survives.
    const gradient = el.children('.grad');
    const target = gradient.length === 1 ? gradient : el;
    if (/[<>]/.test(String(value))) {
      target.html(String(value));
    } else {
      target.text(String(value));
    }
  }

  if (missing.length > 0) {
    throw new Error(`copy names slots the template does not have: ${missing.join(', ')}`);
  }
  return $.html();
}

/** Write a page and its discard log to a directory. */
export function writeOutput(dir, { html, discardLog: log }) {
  mkdirSync(dir, { recursive: true });
  const htmlPath = path.join(dir, 'index.html');
  writeFileSync(htmlPath, html, 'utf8');

  if (log) {
    mkdirSync(path.join(dir, '.slopify'), { recursive: true });
    writeFileSync(
      path.join(dir, '.slopify/discarded.json'),
      `${JSON.stringify(log, null, 2)}\n`,
      'utf8',
    );
  }
  return htmlPath;
}

// ── auto-patch ───────────────────────────────────────────────────────────────
//
// One named transformation per gate, applied to the DOM. Deterministic: a given
// unsatisfied gate always produces the same fix, and a patch that cannot help
// returns false rather than pretending.
//
// The template already satisfies all 57 for generated copy, so in a normal build
// nothing here fires. It exists for the case the plan cares about — a page that
// came out too good — and for `corporatize`, which starts from arbitrary input.

/** The one stylesheet the page may load. */
const CANONICAL_FONT_URL =
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap';

/** Append rules to the page's last <style>, creating one if there is none. */
function appendCss($, css) {
  const styles = $('style');
  if (styles.length === 0) {
    $('head').append(`<style>${css}</style>`);
    return;
  }
  const last = styles.last();
  last.html(`${last.html() ?? ''}\n${css}`);
}

/** Whether any stylesheet on the page already contains a rule. */
const cssHas = ($, pattern) =>
  $('style')
    .toArray()
    .some((el) => pattern.test($(el).html() ?? ''));

/**
 * Make sure the tokens the patches reference actually exist.
 *
 * Checked one at a time rather than inferred from a single probe. An earlier
 * version bailed out if `--accent-gradient` was present, which meant a page
 * carrying that token but not `--font` had its font-family declarations rewritten
 * to `var(--font)` — an undeclared property — and dropped to the browser default.
 */
function ensureTokens($) {
  const needed = {
    font: "'Inter', sans-serif",
    'accent-from': '#7C3AED',
    'accent-to': '#EC4899',
    'accent-gradient': 'linear-gradient(135deg, #7C3AED 0%, #EC4899 100%)',
  };
  const missing = Object.entries(needed).filter(
    ([name]) => !cssHas($, new RegExp(`--${name}\\s*:`)),
  );
  if (missing.length === 0) return;
  appendCss(
    $,
    `:root {\n${missing.map(([name, value]) => `  --${name}: ${value};`).join('\n')}\n}`,
  );
}

/** @type {Record<string, (ctx: {$: import('cheerio').CheerioAPI, pass: number}) => boolean>} */
export const PATCHES = {
  // An off-allowlist webfont. Load Inter and nothing else.
  'SLOP-001': ({ $ }) => {
    const links = $('link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]');
    const alreadyCanonical =
      links.length === 1 && links.first().attr('href') === CANONICAL_FONT_URL;
    if (alreadyCanonical) return false;
    links.remove();
    $('head').append(
      `<link rel="stylesheet" data-slot="font-link" href="${CANONICAL_FONT_URL}" />`,
    );
    return true;
  },

  // A display/body pairing, or more than one family declared. Collapse to one.
  'SLOP-003': ({ $ }) => collapseFamilies($),
  'SLOP-007': ({ $ }) => collapseFamilies($),

  // A heading set in solid ink. Reinstate the gradient text fill.
  //
  // The class alone is not enough: a page that removed the .grad rule (or never
  // had one) would take the class and still fail the gate. So the rule is
  // injected too, and the patch reports false when both are already in place
  // rather than claiming a fix it did not make.
  'SLOP-005': ({ $ }) => {
    const headline = $('[data-slot="hero-headline"], h1').first();
    if (headline.length === 0) return false;

    let changed = false;
    ensureTokens($);
    if (!cssHas($, /\.grad\s*\{[^}]*background-clip/)) {
      appendCss(
        $,
        `.grad {
  background-image: var(--accent-gradient);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}`,
      );
      changed = true;
    }

    // The class goes on the heading itself as well as any inner span. The gate's
    // selector is `h1, h2, [data-slot="hero-headline"] span`, so on a page with no
    // data-slot markers only the heading is reachable — treating the span as the
    // sole target left such a page failing after a patch that reported success.
    if (!headline.hasClass('grad')) {
      headline.addClass('grad');
      changed = true;
    }
    const inner = headline.children('span').first();
    if (inner.length > 0 && !inner.hasClass('grad')) {
      inner.addClass('grad');
      changed = true;
    }
    return changed;
  },

  // A hero element off the centred axis. Put every one of them back on it.
  'SLOP-020': ({ $ }) => {
    if (cssHas($, /SLOPIFY-PATCH-020/)) return false;
    appendCss(
      $,
      `/* SLOPIFY-PATCH-020 */
[data-slot="hero"] { align-items: center; text-align: center; }
[data-slot="hero"] > * {
  text-align: center;
  align-self: center;
  margin-left: auto;
  margin-right: auto;
}`,
    );
    return true;
  },

  // No italicised emphasis word. Italicise the last word of the headline.
  'SLOP-009': ({ $ }) => {
    const target = $('[data-slot="hero-headline"]').find('.grad').first();
    const scope = target.length > 0 ? target : $('[data-slot="hero-headline"]');
    if (scope.length === 0) return false;
    if (scope.find('em, i').length > 0) return false;
    const words = scope.text().trim().split(/\s+/);
    if (words.length < 2) return false;
    const last = words.pop();
    scope.html(`${words.join(' ')} <em>${last}</em>`);
    return true;
  },

  // A footer scaled to the site. Rebuild the four canonical columns.
  'SLOP-035': ({ $ }) => rebuildFooter($),
  'SLOP-036': ({ $ }) => rebuildFooter($),

  // A reduced-motion fallback. Remove it; the animation runs for everybody.
  'SLOP-045': ({ $ }) => {
    let removed = false;
    $('style').each((_, el) => {
      const css = $(el).html() ?? '';
      if (!/prefers-reduced-motion/.test(css)) return;
      $(el).html(stripReducedMotion(css));
      removed = true;
    });
    return removed;
  },

  // A written headline. Replace it with the template fill.
  'SLOP-046': ({ $, pass }) => {
    const headline = $('[data-slot="hero-headline"]');
    if (headline.length === 0) return false;
    const verb = HEADLINE_VERBS[pass % HEADLINE_VERBS.length];
    const noun = HEADLINE_NOUNS[pass % HEADLINE_NOUNS.length];
    const target = headline.find('.grad').first();
    (target.length > 0 ? target : headline).html(`${verb} your <em>${noun}</em>`);
    return true;
  },

  // No frictionless adverb. Replace the subhead with one that carries one.
  'SLOP-047': ({ $, pass }) => {
    const subhead = $('[data-slot="hero-subhead"]');
    if (subhead.length === 0) return false;
    subhead.text(SUBHEADS[pass % SUBHEADS.length]);
    return true;
  },

  // Honest figures, or figures that are sourced. Replace the proof bar.
  'SLOP-048': ({ $ }) => replaceStats($),
  'SLOP-049': ({ $ }) => replaceStats($),

  // An off-pool CTA label. Draw from the pool.
  'SLOP-052': ({ $ }) => {
    const pool = [...CTAS.nav, ...CTAS.heroPrimary, ...CTAS.heroSecondary, ...CTAS.banner];
    const allowed = new Set(pool.map((l) => l.toLowerCase()));
    let changed = false;
    $('.btn').each((i, el) => {
      const label = $(el).text().trim().toLowerCase();
      if (allowed.has(label)) return;
      $(el).text(pool[i % pool.length]);
      changed = true;
    });
    return changed;
  },

  // No risk-reversal line. Add one.
  'SLOP-054': ({ $, pass }) => {
    const slot = $('[data-slot="hero-reassurance"]');
    const line = REASSURANCES[pass % REASSURANCES.length];
    if (slot.length > 0) {
      slot.text(line);
      return true;
    }
    const hero = $('[data-slot="hero"]');
    if (hero.length === 0) return false;
    hero.append(`<p class="hero__reassurance" data-slot="hero-reassurance">${line}</p>`);
    return true;
  },

  // FAQ voice off-register. Rewrite from the pool.
  'SLOP-055': ({ $ }) => {
    const items = $('[data-slot="faq"] details').toArray();
    if (items.length === 0) return false;
    items.forEach((item, i) => {
      const faq = FAQS[i % FAQS.length];
      $(item).children('summary').text(faq.q);
      const answer = $(item).children('p').first();
      if (answer.length > 0) answer.text(faq.a);
      else $(item).append(`<p>${faq.a}</p>`);
    });
    return true;
  },
};

/**
 * Route every font-family declaration through the one token.
 *
 * Rewriting the declarations rather than deleting the extra ones is what makes
 * this deterministic: whatever the input declared, the output declares exactly
 * one family. Custom-property declarations (`--font:`) do not match the pattern,
 * so the token block survives.
 */
function collapseFamilies($) {
  ensureTokens($);
  let changed = false;
  $('style').each((_, el) => {
    const css = $(el).html() ?? '';
    const next = css.replace(/font-family\s*:\s*[^;}]+/gi, 'font-family: var(--font)');
    if (next !== css) {
      $(el).html(next);
      changed = true;
    }
  });
  return changed;
}

function rebuildFooter($) {
  const cols = $('[data-slot="footer"] .footer__cols');
  if (cols.length === 0) return false;
  const links = {
    Product: ['Features', 'Pricing', 'Integrations', 'Changelog'],
    Company: ['About', 'Careers', 'Press', 'Contact'],
    Resources: ['Docs', 'Blog', 'Guides', 'Community'],
    Legal: ['Privacy', 'Terms', 'Security', 'Cookies'],
  };
  cols.html(
    FOOTER_COLUMNS.map(
      (title, i) => `
      <div class="footer__col">
        <h4 class="footer__col-title" data-slot="footer-col-${i + 1}-title">${title}</h4>
        <ul>${links[title].map((l) => `<li>${l}</li>`).join('')}</ul>
      </div>`,
    ).join(''),
  );
  return true;
}

function replaceStats($) {
  const grid = $('[data-slot="stats"] .stats__grid');
  if (grid.length === 0) return false;
  grid.html(
    STATS.slice(0, 4)
      .map(
        (stat, i) => `
      <div class="stat"><span class="stat__value" data-slot="stat-${i + 1}-value">${stat.value}</span><span class="stat__label" data-slot="stat-${i + 1}-label">${stat.label}</span></div>`,
      )
      .join(''),
  );
  // Any sourcing note alongside the bar goes too.
  $('[data-slot="stats"] .stats__note').remove();
  return true;
}

/** Remove every @media block mentioning prefers-reduced-motion, brace-balanced. */
export function stripReducedMotion(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media', i);
    if (at === -1) {
      out += css.slice(i);
      break;
    }
    const open = css.indexOf('{', at);
    if (open === -1) {
      out += css.slice(i);
      break;
    }
    const condition = css.slice(at, open);
    // Walk to the matching close brace so nested rules come out with the block.
    let depth = 0;
    let end = open;
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (/prefers-reduced-motion/.test(condition)) {
      out += css.slice(i, at);
    } else {
      out += css.slice(i, end + 1);
    }
    i = end + 1;
  }
  return out;
}

/**
 * Apply every patch that matches an unsatisfied gate.
 * @returns {{html: string, applied: string[], unpatchable: string[]}}
 */
export function autoPatch(html, failing, pass = 0) {
  const $ = cheerio.load(html);
  const applied = [];
  const unpatchable = [];
  for (const gateId of failing) {
    const patch = PATCHES[gateId];
    if (!patch) {
      unpatchable.push(gateId);
      continue;
    }
    if (patch({ $, pass })) applied.push(gateId);
    else unpatchable.push(gateId);
  }
  return { html: $.html(), applied, unpatchable };
}

// ── orchestration ────────────────────────────────────────────────────────────

export const MAX_PATCH_PASSES = 3;

/**
 * Build a page from a brief.
 *
 * @param {string} brief
 * @param {{outDir?: string, seed?: number, theme?: string, browser?: object,
 *          maxPasses?: number, quiet?: boolean, memoryDir?: string}} [options]
 */
export async function build(brief, options = {}) {
  const {
    outDir = path.join(ROOT, 'out'),
    seed = 0,
    theme,
    browser: givenBrowser,
    maxPasses = MAX_PATCH_PASSES,
    quiet = false,
    memoryDir = outDir,
  } = options;

  const say = quiet ? () => {} : (line) => console.log(line);

  // 1 — theme. The name is announced and then ignored.
  const themeName = theme ?? pickTheme(seed);
  const base = resolveTheme(themeName, { announce: !quiet });

  // 2 — the brief's one moment of influence, and the memory removing it.
  const jittered = applyBriefJitter(base, brief);
  const history = readLog(memoryDir);
  const nudge = nudgeTokens(jittered, history);
  say(formatConvergenceNotice(nudge));

  // 3 — copy. The brief is read once, to work out what to throw away.
  const { copy, discarded, leaks, meta } = generateCopy(brief, { seed, faker });
  say(formatDiscardNotice(discarded));

  // 4 — fill the one macrostructure.
  const stamp = buildStamp({ themeName, seed, nudge, discarded });
  const template = loadTemplate();
  let html = renderPage({
    template,
    tokensCss: tokensToCss(stripInternal(nudge.tokens)),
    copy,
    stamp,
  });

  // 5 — score, patch, rescore.
  const browser = givenBrowser ?? (await chromium.launch());
  const patchLog = [];
  let report;
  try {
    let htmlPath = writeOutput(outDir, {
      html,
      discardLog: buildDiscardLog({ brief, discarded, leaks }),
    });
    report = await scoreHtml(htmlPath, { browser });

    for (let pass = 0; pass < maxPasses && report.slopScore < report.total; pass++) {
      const failing = failingGates(report);
      const patched = autoPatch(html, failing, pass);
      patchLog.push({ pass: pass + 1, failing, ...patched });
      if (patched.applied.length === 0) break; // nothing left this loop can fix
      html = patched.html;
      htmlPath = writeOutput(outDir, { html });
      report = await scoreHtml(htmlPath, { browser });
      say(`Auto-patch pass ${pass + 1}: fixed ${patched.applied.join(', ')} — now ${report.slopScore}/${report.total}.`);
    }

    // 6 — remember this build, so the next one comes out closer to it.
    appendRecord(
      memoryDir,
      makeRecord({
        theme: themeName,
        primaryColor: nudge.tokens['accent-from'],
        secondaryColor: nudge.tokens['accent-to'],
        headlineTemplate: meta.headlineTemplate,
        brief,
      }),
    );

    say(`slopScore: ${report.slopScore} / ${report.total}`);
    return {
      htmlPath,
      html,
      report,
      themeName,
      tokens: nudge.tokens,
      copy,
      discarded,
      leaks,
      meta,
      nudge,
      patchLog,
    };
  } finally {
    if (!givenBrowser) await browser.close();
  }
}

/** Drop internal bookkeeping keys before the tokens become CSS. */
function stripInternal(tokens) {
  return Object.fromEntries(Object.entries(tokens).filter(([k]) => !k.startsWith('_')));
}

/**
 * The build stamp.
 *
 * Hallmark stamps its CSS so the NEXT run reads it and picks something
 * different. This stamp carries the same fields and is identical on every build,
 * which is what makes it a durable record.
 */
export function buildStamp({ themeName, seed, nudge, discarded }) {
  return `/* Slopify · theme: ${themeName} · macrostructure: canonical
 * axes: light / geometric-sans / violet → pink (as every theme)
 * seed: ${seed} · remembered builds: ${nudge.historyLength} · convergence: ${(nudge.factor * 100).toFixed(0)}%
 * discarded from brief: ${discarded.length} term(s)
 */`;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    return at === -1 ? fallback : args[at + 1];
  };
  const briefFile = flag('brief-file');
  const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

  let brief = positional.join(' ');
  if (briefFile) {
    if (!existsSync(briefFile)) {
      console.error(`slopify: no such brief file: ${briefFile}`);
      process.exit(2);
    }
    brief = readFileSync(briefFile, 'utf8');
  }
  if (!brief.trim()) {
    console.error('usage: node scripts/build.mjs "<brief>" [--out dir] [--seed n] [--theme name]');
    console.error('   or: node scripts/build.mjs --brief-file <path> [--out dir]');
    process.exit(2);
  }

  const result = await build(brief, {
    outDir: path.resolve(flag('out', path.join(ROOT, 'out'))),
    seed: Number(flag('seed', 0)) || 0,
    theme: flag('theme'),
  });

  if (args.includes('--verbose')) console.log(`\n${formatTable(result.report)}`);
  console.log(`\nWrote ${path.relative(process.cwd(), result.htmlPath)}`);
  process.exit(result.report.slopScore < result.report.total ? 1 : 0);
}
