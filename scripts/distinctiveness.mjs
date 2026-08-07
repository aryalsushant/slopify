// Distinctiveness measurement for SLOP-057, the self-sabotage meta-gate.
//
// The inversion of Hallmark's pre-emit self-critique. Hallmark scores its output
// 1–5 on six axes — Philosophy, Hierarchy, Execution, Specificity, Restraint,
// Variety — before the gate sweep, and revises anything under 3. Slopify runs one
// meta-gate after the sweep, and where Hallmark's critique is a subjective
// judgment call ("does this look like THIS brief?"), this is mechanical:
//
//   1. render the candidate and the golden slop template at a fixed viewport
//   2. normalize every text node so the diff compares structure and style
//      rather than copy
//   3. diff with pixelmatch
//   4. fail the build when similarity falls BELOW the threshold — that is, when
//      the page is accidentally too original
//
// Nothing here is a judgment call, which is the point: Hallmark asks a model to
// grade its own taste, and this asks a differ whether anything survived.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import pixelmatchModule from 'pixelmatch';
import pngjs from 'pngjs';

const pixelmatch = pixelmatchModule.default ?? pixelmatchModule;
const { PNG } = pngjs;

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

/** Must match scripts/score.mjs VIEWPORT, or the two images cannot be diffed. */
export const VIEWPORT = { width: 1280, height: 800 };

/** The reference target. */
export const GOLDEN_TEMPLATE = path.join(ROOT, 'examples/golden/fully-sloppy.html');

/**
 * Structural similarity floor. A page below this is measurably more original
 * than the golden template, which fails SLOP-057.
 */
export const DEFAULT_THRESHOLD = 0.85;

/** Per-pixel colour tolerance handed to pixelmatch. */
const PIXEL_TOLERANCE = 0.1;

/**
 * Injected before every capture.
 *
 * Text nodes keep their length and word boundaries but lose their content, so
 * two pages with identical structure and styling diff to zero however different
 * their copy is. Substituting a real glyph rather than a block character
 * preserves the font's own advance widths and line wrapping, so type size,
 * leading, measure, and colour all still register in the diff — those are style,
 * and style is what the gate is measuring.
 *
 * Animations are reset rather than paused. Pausing freezes at whatever moment
 * the screenshot lands on, which is not reproducible; resetting renders every
 * animated element at its base style every time.
 */
function normalizePage() {
  const freeze = document.createElement('style');
  freeze.textContent = `
    *, *::before, *::after {
      animation: none !important;
      transition: none !important;
      caret-color: transparent !important;
    }
  `;
  document.head.appendChild(freeze);

  const SKIP = new Set(['SCRIPT', 'STYLE', 'TITLE', 'NOSCRIPT']);
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let replaced = 0;
  for (const node of nodes) {
    const parent = node.parentElement;
    if (!parent || SKIP.has(parent.tagName)) continue;
    if (!/\S/.test(node.data)) continue;
    node.data = node.data.replace(/\S/g, 'x');
    replaced++;
  }
  return replaced;
}

/** Screenshot one page at the fixed viewport, text normalized. */
async function capture(browser, htmlPath) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  try {
    // Remote fonts would make the measurement depend on the network. Both pages
    // are captured under the same rule, so neither is advantaged.
    await page.route('**://fonts.googleapis.com/**', (r) => r.abort());
    await page.route('**://fonts.gstatic.com/**', (r) => r.abort());
    await page.goto(pathToFileURL(path.resolve(htmlPath)).href, { waitUntil: 'load' });
    const normalized = await page.evaluate(normalizePage);
    const buffer = await page.screenshot({ type: 'png', animations: 'disabled' });
    return { png: PNG.sync.read(buffer), normalized };
  } finally {
    await page.close();
  }
}

/**
 * Compare two pages structurally.
 * @returns {Promise<{similarity: number, diffPixels: number, totalPixels: number, normalized: {candidate: number, golden: number}}>}
 */
export async function structuralSimilarity(
  candidatePath,
  goldenPath = GOLDEN_TEMPLATE,
  { browser: given } = {},
) {
  const browser = given ?? (await chromium.launch());
  try {
    const a = await capture(browser, candidatePath);
    const b = await capture(browser, goldenPath);

    const { width, height } = VIEWPORT;
    if (a.png.width !== width || b.png.width !== width) {
      throw new Error(`capture width mismatch: ${a.png.width} vs ${b.png.width}`);
    }

    const diff = new PNG({ width, height });
    const diffPixels = pixelmatch(a.png.data, b.png.data, diff.data, width, height, {
      threshold: PIXEL_TOLERANCE,
    });
    const totalPixels = width * height;

    return {
      similarity: 1 - diffPixels / totalPixels,
      diffPixels,
      totalPixels,
      normalized: { candidate: a.normalized, golden: b.normalized },
    };
  } finally {
    if (!given) await browser.close();
  }
}

/**
 * SLOP-057 itself. Passes when the page is at or above the similarity floor.
 * @returns {Promise<{passed: boolean, evidence: string, similarity: number}>}
 */
export async function checkDistinctiveness(
  candidatePath,
  { browser, goldenPath = GOLDEN_TEMPLATE, threshold = DEFAULT_THRESHOLD } = {},
) {
  const abs = path.resolve(candidatePath);
  const golden = path.resolve(goldenPath);

  // A page compared against itself is trivially at 1.0. Said out loud rather
  // than quietly reported as a measurement.
  if (abs === golden) {
    return {
      passed: true,
      similarity: 1,
      evidence: 'page IS the golden template — structurally identical by definition',
    };
  }

  const { similarity, diffPixels, totalPixels } = await structuralSimilarity(abs, golden, {
    browser,
  });
  const pct = (similarity * 100).toFixed(1);
  const floor = (threshold * 100).toFixed(0);
  return {
    passed: similarity >= threshold,
    similarity,
    evidence: similarity >= threshold
      ? `${pct}% structurally identical to the golden template (floor ${floor}%) — nothing survived`
      : `only ${pct}% similar to the golden template (floor ${floor}%); ${diffPixels.toLocaleString()} of ${totalPixels.toLocaleString()} pixels diverge — the page is too original`,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: node scripts/distinctiveness.mjs <file.html> [golden.html]');
    process.exit(2);
  }
  const goldenPath = process.argv[3] ?? GOLDEN_TEMPLATE;
  for (const p of [target, goldenPath]) {
    if (!existsSync(path.resolve(p))) {
      console.error(`distinctiveness: no such file: ${p}`);
      process.exit(2);
    }
  }
  const result = await checkDistinctiveness(target, { goldenPath });
  console.log(`SLOP-057  ${result.passed ? 'PASS' : 'FAIL'}  ${result.evidence}`);
  process.exit(result.passed ? 0 : 1);
}
