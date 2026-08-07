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
