// The `corporatize` verb.
//
// Input: an existing HTML page. Output: the same visible text, on the canonical
// macrostructure, with every structural and stylistic choice replaced.
//
// The inversion (docs/inversion-map.md § 1): Hallmark's `redesign` keeps copy,
// IA, and brand and throws out the visual structure to rebuild with a DIFFERENT
// fingerprint. Same preservation contract — every visible text node survives,
// asserted byte-for-byte in the tests — and the opposite target state: rebuild
// with THE fingerprint.
//
// The tension worth naming
// ------------------------
// Two requirements pull against each other. Text preservation says every word of
// the input must survive. The copy gates say specific slots must carry specific
// words — SLOP-046 wants the headline to match a template, SLOP-052 wants CTA
// labels from a fixed pool, SLOP-055 wants a particular FAQ voice. An input
// headline will not match the template, so it cannot both occupy the headline
// slot and satisfy the gate.
//
// So slots are split in two. Gate-constrained slots get generated copy.
// Everything else is filled from the input's own text, in document order, and any
// text that does not fit a slot is carried into a preserved-content section below
// the CTA banner. Nothing is dropped, and the page still ships at 57/57.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { faker } from '@faker-js/faker';
import { resolveTheme, pickTheme, tokensToCss } from './themes.mjs';
import { generateCopy } from './copy-generator.mjs';
import { applyBriefJitter, nudgeTokens, readLog } from './memory.mjs';
import {
  loadTemplate,
  renderPage,
  writeOutput,
  autoPatch,
  buildStamp,
  MAX_PATCH_PASSES,
} from './build.mjs';
import { scoreHtml, failingGates } from './score.mjs';

/**
 * Slots that may carry the input's own words.
 *
 * Deliberately excludes every slot a copy gate reads: hero-headline (SLOP-046,
 * SLOP-009), hero-subhead (SLOP-047), the stats bar (SLOP-048, SLOP-049),
 * testimonial quotes and attributions (SLOP-050, SLOP-051), every .btn label
 * (SLOP-052), hero-reassurance (SLOP-054), the FAQ (SLOP-055), and the footer
 * column headings (SLOP-036).
 *
 * Order matches the template, so the input reads top-to-bottom in the output.
 */
export const REUSABLE_SLOTS = [
  'page-title',
  'wordmark',
  'nav-link-1',
  'nav-link-2',
  'nav-link-3',
  'nav-link-4',
  'hero-eyebrow',
  'logo-cloud-label',
  'logo-1',
  'logo-2',
  'logo-3',
  'logo-4',
  'logo-5',
  'logo-6',
  'features-title',
  'features-lede',
  'feature-1-title',
  'feature-1-body',
  'feature-2-title',
  'feature-2-body',
  'feature-3-title',
  'feature-3-body',
  'testimonials-title',
  'pricing-title',
  'tier-1-name',
  'tier-1-price',
  'tier-1-period',
  'tier-1-feature-1',
  'tier-1-feature-2',
  'tier-1-feature-3',
  'tier-2-name',
  'tier-2-price',
  'tier-2-period',
  'tier-2-feature-1',
  'tier-2-feature-2',
  'tier-2-feature-3',
  'tier-3-name',
  'tier-3-price',
  'tier-3-period',
  'tier-3-feature-1',
  'tier-3-feature-2',
  'tier-3-feature-3',
  'faq-title',
  'cta-banner-headline',
  'cta-banner-subhead',
  'footer-legal',
];

/**
 * Every visible text node in a page, normalized, in document order.
 *
 * This is the unit of preservation. Both the input and the output are read
 * through this function in the tests, so the comparison is symmetric.
 */
export function extractTextNodes(html) {
  const $ = cheerio.load(html);
  $('script, style, head title').remove();
  const out = [];
  const walk = (node) => {
    for (const child of node.children ?? []) {
      if (child.type === 'text') {
        const text = String(child.data).replace(/\s+/g, ' ').trim();
        if (text) out.push(text);
      } else if (child.children) {
        walk(child);
      }
    }
  };
  const body = $('body').get(0) ?? $.root().get(0);
  walk(body);
  return out;
}

/** The page's <title>, if it has one. */
function extractTitle(html) {
  const text = cheerio.load(html)('head title').text().replace(/\s+/g, ' ').trim();
  return text || null;
}

/**
 * Append the text that did not fit a slot, so nothing is dropped.
 *
 * The section carries data-reveal (SLOP-039 requires every top-level section to)
 * and no canonical data-slot, so it is invisible to SLOP-037's order check. It
 * sits after the CTA banner and before the footer, which is below the first
 * viewport and therefore does not move SLOP-057's diff.
 */
export function appendPreserved(html, texts) {
  if (texts.length === 0) return html;
  const $ = cheerio.load(html);
  const body = texts.map((t) => `<p>${escapeHtml(t)}</p>`).join('\n        ');
  $('main').append(
    `\n  <section class="preserved" data-reveal>
    <div class="shell">
      <div class="preserved__body">
        ${body}
      </div>
    </div>
  </section>\n`,
  );
  const styles = $('style').last();
  styles.html(
    `${styles.html() ?? ''}
.preserved { padding: 96px 24px; background-color: var(--paper); }
.preserved__body { max-width: 65ch; margin: 0 auto; }
.preserved__body p + p { margin-top: 1em; }
`,
  );
  return $.html();
}

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Corporatize a page.
 *
 * @param {string} inputPath
 * @param {{outDir: string, seed?: number, theme?: string, browser?: object,
 *          maxPasses?: number, quiet?: boolean}} options
 */
export async function corporatize(inputPath, options) {
  const {
    outDir,
    seed = 0,
    theme,
    browser: givenBrowser,
    maxPasses = MAX_PATCH_PASSES,
    quiet = false,
  } = options;
  const say = quiet ? () => {} : (line) => console.log(line);

  const inputHtml = readFileSync(path.resolve(inputPath), 'utf8');
  const inputTitle = extractTitle(inputHtml);
  const texts = extractTextNodes(inputHtml);
  say(`Read ${texts.length} text node(s) from ${path.basename(inputPath)}. All will be preserved.`);

  const themeName = theme ?? pickTheme(seed);
  const base = resolveTheme(themeName, { announce: !quiet });
  const nudge = nudgeTokens(applyBriefJitter(base, texts.join(' ')), readLog(outDir));

  // Generated copy first, so the gate-constrained slots are correct...
  const { copy: generated, meta } = generateCopy(texts.join(' '), { seed, faker });

  // ...then the input's own words over every slot that no gate reads.
  const copy = { ...generated };
  const consumed = [];
  let cursor = 0;
  if (inputTitle) {
    copy['page-title'] = inputTitle;
    consumed.push(inputTitle);
  }
  for (const slot of REUSABLE_SLOTS) {
    if (slot === 'page-title' && inputTitle) continue;
    if (cursor >= texts.length) break;
    copy[slot] = texts[cursor];
    consumed.push(texts[cursor]);
    cursor += 1;
  }
  const leftover = texts.slice(cursor);

  const template = loadTemplate();
  const tokensCss = tokensToCss(
    Object.fromEntries(Object.entries(nudge.tokens).filter(([k]) => !k.startsWith('_'))),
  );
  let html = appendPreserved(
    renderPage({
      template,
      tokensCss,
      copy,
      stamp: buildStamp({ themeName, seed, nudge, discarded: [] }),
    }),
    leftover,
  );

  const browser = givenBrowser ?? (await chromium.launch());
  const patchLog = [];
  try {
    // No discard log is written: corporatize discards nothing, so SLOP-056 has
    // nothing to check against, which is the honest state for this verb.
    let htmlPath = writeOutput(outDir, { html });
    let report = await scoreHtml(htmlPath, { browser });

    for (let pass = 0; pass < maxPasses && report.slopScore < report.total; pass++) {
      const patched = autoPatch(html, failingGates(report), pass);
      patchLog.push({ pass: pass + 1, ...patched });
      if (patched.applied.length === 0) break;
      html = patched.html;
      htmlPath = writeOutput(outDir, { html });
      report = await scoreHtml(htmlPath, { browser });
    }

    say(
      `Restructured onto the canonical macrostructure. ${consumed.length} text node(s) into slots, ${leftover.length} preserved below the CTA banner.`,
    );
    say(`slopScore: ${report.slopScore} / ${report.total}`);

    return {
      htmlPath,
      html,
      report,
      inputTexts: texts,
      outputTexts: extractTextNodes(html),
      consumed,
      leftover,
      themeName,
      meta,
      patchLog,
    };
  } finally {
    if (!givenBrowser) await browser.close();
  }
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
  const target = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

  if (!target) {
    console.error('usage: node scripts/corporatize.mjs <file.html> [--out dir] [--seed n]');
    process.exit(2);
  }
  if (!existsSync(path.resolve(target))) {
    console.error(`corporatize: no such file: ${target}`);
    process.exit(2);
  }

  const result = await corporatize(target, {
    outDir: path.resolve(flag('out', 'out/corporatized')),
    seed: Number(flag('seed', 0)) || 0,
  });

  const missing = result.inputTexts.filter((t) => !result.outputTexts.includes(t));
  if (missing.length > 0) {
    console.error(`corporatize: ${missing.length} input text node(s) were lost — refusing to ship.`);
    process.exit(1);
  }
  console.log(`All ${result.inputTexts.length} input text node(s) preserved.`);
  console.log(`Wrote ${path.relative(process.cwd(), result.htmlPath)}`);
  process.exit(result.report.slopScore < result.report.total ? 1 : 0);
}
