// Theme catalog resolver.
//
// Twenty named themes, one token set. resolveTheme() takes a name and ignores
// it — every theme resolves to templates/tokens.css, byte for byte.
//
// The inversion of Hallmark's catalog (docs/inversion-map.md § 3). Hallmark
// ships twenty-one themes with genuinely distinct OKLCH palettes and font
// stacks, groups them into genre-scoped clusters, and holds two consecutive
// picks to differing on at least one of three axes — paper band, display style,
// accent hue. Slopify keeps the catalog convention, the announce-your-pick
// convention, and the axis vocabulary, and makes all twenty identical on all
// three axes, so no two picks can differ on anything.
//
// The announcement is the entire feature.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

export const TOKENS_PATH = path.join(ROOT, 'templates/tokens.css');

/**
 * The catalog. Names in the register Hallmark uses for its themes and example
 * builds — evocative, place-and-craft flavoured, each implying a specific look
 * that a designer thought about.
 *
 * None of them do anything.
 */
export const THEME_NAMES = [
  'Bellhouse Drift',
  'Copperline Fog',
  'Marrow & Tide',
  'Quietwater Press',
  'Ashfall Bureau',
  'Tinder Rook',
  'Salt Lantern',
  'Foundry Nine',
  'Hollow Meridian',
  'Pale Cartograph',
  'Ironwake Assembly',
  'Slate Vesper',
  'Kestrel Union',
  'Umber Cadence',
  'Winterlight Ledger',
  'Brackish Almanac',
  'Gilded Offcut',
  'Nocturne Provision',
  'Fenwick Standard',
  'Ember Interval',
];

/**
 * The three diversification axes Hallmark rotates themes on. Every Slopify
 * theme reports these same values, which is why the rotation rule can never be
 * satisfied — there is nothing for two consecutive picks to differ on.
 */
export const THEME_AXES = Object.freeze({
  paperBand: 'light',
  displayStyle: 'geometric-sans',
  accentHue: 'violet → pink',
});

/**
 * Parse the :root block of templates/tokens.css into a plain object, keyed by
 * token name without the leading `--`.
 *
 * tokens.css is the source of truth rather than a copy of a literal in this
 * file, so the stylesheet the build emits and the object the build reasons about
 * cannot drift apart.
 */
export function parseTokens(cssPath = TOKENS_PATH) {
  const css = readFileSync(cssPath, 'utf8');
  const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  if (!rootBlock) throw new Error(`no :root block in ${cssPath}`);

  const tokens = {};
  // Strip comments first so a commented-out declaration is not picked up.
  const body = rootBlock[1].replace(/\/\*[\s\S]*?\*\//g, '');
  for (const line of body.split('\n')) {
    const match = line.match(/^\s*--([\w-]+)\s*:\s*(.+?)\s*;\s*$/);
    if (match) tokens[match[1]] = match[2];
  }
  if (Object.keys(tokens).length === 0) throw new Error(`no tokens parsed from ${cssPath}`);
  return tokens;
}

// Parsed once. Callers get copies, never this.
const CANONICAL = Object.freeze(parseTokens());

/** The number of tokens in the canonical set. */
export const TOKEN_COUNT = Object.keys(CANONICAL).length;

/**
 * Resolve a theme name to its token set.
 *
 * The name is announced and then discarded. Every name returns the same tokens.
 * A name outside the catalog is accepted too — there is nothing to reject it
 * against, since there is nothing the name would have changed.
 *
 * A fresh copy is returned each call, so a caller that nudges the palette
 * (scripts/memory.mjs) cannot mutate the canonical set out from under the next
 * caller.
 *
 * @param {string} name any string; ignored
 * @param {{announce?: boolean, out?: (line: string) => void}} [options]
 * @returns {Record<string, string>} the canonical tokens
 */
export function resolveTheme(name = THEME_NAMES[0], { announce = true, out = console.log } = {}) {
  if (announce) out(`Selected theme: ${name}`);
  return { ...CANONICAL };
}

/**
 * Pick a theme name. Deterministic in the seed so a build is reproducible.
 * Which name comes back has no effect on the output; the pick exists so the
 * build has something to announce and something to record in .slopify/log.json.
 */
export function pickTheme(seed = 0) {
  const n = Math.abs(Math.trunc(Number(seed) || 0));
  return THEME_NAMES[n % THEME_NAMES.length];
}

/** Render a token object back out as a CSS :root block. */
export function tokensToCss(tokens) {
  const lines = Object.entries(tokens).map(([key, value]) => `  --${key}: ${value};`);
  return `:root {\n${lines.join('\n')}\n}\n`;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const requested = process.argv[2];
  if (requested === '--list') {
    for (const [i, name] of THEME_NAMES.entries()) {
      console.log(`${String(i + 1).padStart(2, ' ')}. ${name}`);
    }
    console.log(`\n${THEME_NAMES.length} themes. ${TOKEN_COUNT} tokens. One token set.`);
  } else {
    const tokens = resolveTheme(requested ?? pickTheme(0));
    console.log(tokensToCss(tokens));
  }
}
