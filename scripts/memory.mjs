// Project memory.
//
// `.slopify/log.json` records every build and pulls each new one closer to the
// average of the ones before it. Over repeated runs the output converges.
//
// The most direct inversion in the project (docs/inversion-map.md § 5).
// Hallmark's `.hallmark/log.json` is read before picking so that the pick
// DIFFERS: the macrostructure must not match any of the last three, the theme
// must differ from the last on at least one axis, the enrichment must not
// repeat. Same file convention, same newest-first array, same trim-to-20, same
// OKLCH colour reasoning — aimed at collapsing variety instead of spacing it
// out.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parse as parseColor, converter, formatHex, clampChroma } from 'culori';

/** Matches Hallmark's own trim: the log keeps the last 20 entries. */
export const LOG_LIMIT = 20;

/** Where the log lives, relative to a build output directory. */
export const LOG_RELATIVE = '.slopify/log.json';

export const logPathFor = (dir) => path.join(dir, LOG_RELATIVE);

/**
 * Read the build log. Newest entry first.
 *
 * Returns [] for a missing, empty, or unparseable file. A corrupt log must not
 * break a build — the worst case is a build with no history to converge toward,
 * which is just the first-run case.
 */
export function readLog(dir) {
  const file = logPathFor(dir);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry && typeof entry === 'object');
  } catch {
    return [];
  }
}

/** Write the log, trimmed to the most recent LOG_LIMIT entries. */
export function writeLog(dir, records) {
  const trimmed = records.slice(0, LOG_LIMIT);
  mkdirSync(path.dirname(logPathFor(dir)), { recursive: true });
  writeFileSync(logPathFor(dir), `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
  return trimmed;
}

/**
 * Build a log record.
 *
 * The shape mirrors Hallmark's — a per-build row carrying the decisions a later
 * run reads — except that where Hallmark records what to avoid repeating, this
 * records what to move toward.
 */
export function makeRecord({ theme, primaryColor, secondaryColor, headlineTemplate, brief = '' }) {
  return {
    theme,
    primaryColor,
    secondaryColor,
    headlineTemplate,
    briefFirstLine: String(brief).split('\n').find((l) => l.trim())?.slice(0, 120) ?? '',
  };
}

/** Prepend a record and persist. Newest first, same as Hallmark's log. */
export function appendRecord(dir, record) {
  const next = [record, ...readLog(dir)];
  return writeLog(dir, next);
}

// ── colour maths ─────────────────────────────────────────────────────────────
//
// All averaging is done in OKLCH, the same space Hallmark reasons about colour
// in, for the same reason: averaging two hues in sRGB walks through grey, and a
// palette that converges through grey would be converging on the wrong thing.

const toOklch = converter('oklch');

/** Parse a colour to OKLCH, or null. */
export function toOk(value) {
  const parsed = parseColor(String(value ?? '').trim());
  if (!parsed) return null;
  const c = toOklch(parsed);
  return { l: c.l ?? 0, c: c.c ?? 0, h: c.h ?? 0 };
}

/** Back to a hex string, chroma clamped into sRGB so the value is renderable. */
export function fromOk({ l, c, h }) {
  return formatHex(clampChroma({ mode: 'oklch', l, c, h })).toUpperCase();
}

/**
 * Circular mean of hues, in degrees.
 *
 * Hue is an angle, so the arithmetic mean of 350 and 10 is 180 — the opposite
 * side of the wheel. Averaging unit vectors instead keeps the result next to its
 * inputs, which matters because the canonical pink stop sits at 354.
 */
export function meanHue(hues) {
  if (hues.length === 0) return 0;
  let x = 0;
  let y = 0;
  for (const h of hues) {
    const rad = (h * Math.PI) / 180;
    x += Math.cos(rad);
    y += Math.sin(rad);
  }
  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) return hues[0];
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Shortest signed angular distance from a to b, in degrees. */
export function hueDelta(a, b) {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/** Mean of a list of OKLCH colours, hue averaged circularly. */
export function meanColor(colors) {
  const usable = colors.filter(Boolean);
  if (usable.length === 0) return null;
  return {
    l: usable.reduce((s, c) => s + c.l, 0) / usable.length,
    c: usable.reduce((s, c) => s + c.c, 0) / usable.length,
    h: meanHue(usable.map((c) => c.h)),
  };
}

/** Move `from` a fraction of the way toward `to`, in OKLCH. */
export function lerpColor(from, to, t) {
  return {
    l: from.l + (to.l - from.l) * t,
    c: from.c + (to.c - from.c) * t,
    h: (from.h + hueDelta(from.h, to.h) * t + 360) % 360,
  };
}

// ── the brief jitter ─────────────────────────────────────────────────────────

/** How far a brief may move the accent hue, in degrees. */
export const JITTER_DEGREES = 6;

/**
 * A deterministic hue offset derived from the brief.
 *
 * This is the only thing in Slopify that varies with what the user asked for,
 * and it exists so the memory has something to take away. The palette appears
 * for a moment to be responding to the brief; convergence then removes the
 * response, build by build, until every page is the same violet again.
 *
 * Capped at ±6°, which keeps the stops inside the hue bands SLOP-012 checks, so
 * a jittered or converged palette still reads as the canonical purple→pink.
 */
export function briefJitter(brief, maxDegrees = JITTER_DEGREES) {
  const text = String(brief ?? '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unit = ((hash >>> 0) % 20001) / 20000; // 0..1
  return (unit * 2 - 1) * maxDegrees;
}

/** Apply the brief jitter to a token set's accent stops. */
export function applyBriefJitter(tokens, brief) {
  const offset = briefJitter(brief);
  const shift = (value) => {
    const c = toOk(value);
    if (!c) return value;
    return fromOk({ ...c, h: (c.h + offset + 360) % 360 });
  };
  return {
    ...withGradient({
      ...tokens,
      'accent-from': shift(tokens['accent-from']),
      'accent-to': shift(tokens['accent-to']),
    }),
    _jitter: offset,
  };
}

// ── convergence ──────────────────────────────────────────────────────────────

/** Per-remembered-build pull toward the running average. */
export const NUDGE_PER_BUILD = 0.1;

/**
 * How far this build moves toward the average of the builds before it.
 *
 * Each remembered build pulls the palette another 10% closer, so the factor
 * compounds: 1 - 0.9^n. A flat 10% would shave the spread once and then
 * plateau, which is not convergence — it is a one-off offset. Compounding is
 * what makes run ten measurably more alike than run two, and it is the exact
 * mirror of Hallmark's rule getting *harder* to satisfy as its log fills up.
 *
 * Capped below 1 so the palette never collapses to a hard-coded value; it
 * approaches the mean asymptotically.
 */
export function convergenceFactor(historyLength, per = NUDGE_PER_BUILD) {
  const n = Math.max(0, Math.trunc(historyLength));
  return Math.min(0.95, 1 - (1 - per) ** n);
}

/** Rebuild the gradient strings so they match the stops. */
function withGradient(tokens) {
  const angle = tokens['accent-angle'] ?? '135deg';
  return {
    ...tokens,
    'accent-gradient': `linear-gradient(${angle}, ${tokens['accent-from']} 0%, ${tokens['accent-to']} 100%)`,
  };
}

/**
 * Nudge a token set toward the average of every past build.
 *
 * @param {Record<string,string>} tokens
 * @param {Array<object>} log newest first
 * @returns {{tokens: Record<string,string>, factor: number, historyLength: number, target: object|null}}
 */
export function nudgeTokens(tokens, log, { per = NUDGE_PER_BUILD } = {}) {
  const history = (log ?? []).filter((r) => r && r.primaryColor);
  const factor = convergenceFactor(history.length, per);

  if (history.length === 0 || factor === 0) {
    return { tokens: withGradient({ ...tokens }), factor: 0, historyLength: 0, target: null };
  }

  const targetFrom = meanColor(history.map((r) => toOk(r.primaryColor)));
  const targetTo = meanColor(history.map((r) => toOk(r.secondaryColor ?? r.primaryColor)));

  const from = toOk(tokens['accent-from']);
  const to = toOk(tokens['accent-to']);
  if (!from || !to || !targetFrom || !targetTo) {
    return { tokens: withGradient({ ...tokens }), factor: 0, historyLength: history.length, target: null };
  }

  const nudged = withGradient({
    ...tokens,
    'accent-from': fromOk(lerpColor(from, targetFrom, factor)),
    'accent-to': fromOk(lerpColor(to, targetTo, factor)),
  });

  return {
    tokens: nudged,
    factor,
    historyLength: history.length,
    target: { from: targetFrom, to: targetTo },
  };
}

/** One-line summary for the build's stdout, in Hallmark's rotation register. */
export function formatConvergenceNotice({ factor, historyLength }) {
  if (historyLength === 0) {
    return 'No project memory — this is the first build. Nothing to converge toward yet.';
  }
  return `${historyLength} previous build(s) remembered. Palette pulled ${(factor * 100).toFixed(0)}% toward their average.`;
}
