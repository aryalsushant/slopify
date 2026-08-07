import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  readLog,
  writeLog,
  appendRecord,
  makeRecord,
  logPathFor,
  LOG_LIMIT,
  nudgeTokens,
  convergenceFactor,
  applyBriefJitter,
  briefJitter,
  meanHue,
  hueDelta,
  meanColor,
  toOk,
  fromOk,
  NUDGE_PER_BUILD,
  JITTER_DEGREES,
} from '../scripts/memory.mjs';
import { resolveTheme } from '../scripts/themes.mjs';
import { classifyGradient } from '../scripts/score.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, 'test/.tmp-convergence');

const fresh = () => {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
};

/** Population standard deviation. */
const stddev = (xs) => {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
};

/** Ten briefs, deliberately unalike. Five are the real fixtures. */
const BRIEFS = [
  ...['ceramics-studio', 'punk-zine', 'funeral-home', 'nonprofit', 'b2b-saas'].map((n) =>
    readFileSync(path.join(root, 'examples/briefs', `${n}.md`), 'utf8'),
  ),
  'A wholesale fishmonger in Grimsby. Day boats only, no farmed stock.',
  'Chamber choir, forty voices, Advent programme of Renaissance polyphony.',
  'Mobile bicycle repair van covering three boroughs, cargo bikes a speciality.',
  'Independent cinema, 92 seats, 35mm projection, repertory double bills.',
  'Soil testing laboratory for allotment societies. Heavy metals and pH panels.',
];

/**
 * Run the build's palette pipeline the way build.mjs will: resolve the theme,
 * apply the brief jitter, nudge toward remembered builds, record the result.
 */
function runBuild(dir, brief) {
  const jittered = applyBriefJitter(resolveTheme('Salt Lantern', { announce: false }), brief);
  const { tokens, factor, historyLength } = nudgeTokens(jittered, readLog(dir));
  appendRecord(
    dir,
    makeRecord({
      theme: 'Salt Lantern',
      primaryColor: tokens['accent-from'],
      secondaryColor: tokens['accent-to'],
      headlineTemplate: 'Elevate your workflow',
      brief,
    }),
  );
  return { tokens, factor, historyLength, jitter: jittered._jitter };
}

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('log file', () => {
  beforeEach(fresh);

  it('reads empty for a project with no history', () => {
    expect(readLog(tmp)).toEqual([]);
  });

  it('keeps newest first', () => {
    appendRecord(tmp, makeRecord({ theme: 'First', primaryColor: '#7C3AED' }));
    appendRecord(tmp, makeRecord({ theme: 'Second', primaryColor: '#7C3AED' }));
    expect(readLog(tmp).map((r) => r.theme)).toEqual(['Second', 'First']);
  });

  it('trims to the last 20, like Hallmark', () => {
    for (let i = 0; i < 30; i++) {
      appendRecord(tmp, makeRecord({ theme: `T${i}`, primaryColor: '#7C3AED' }));
    }
    const log = readLog(tmp);
    expect(log).toHaveLength(LOG_LIMIT);
    expect(log[0].theme).toBe('T29');
  });

  it('survives a corrupt log rather than breaking the build', () => {
    // Worst case must be a build with no history to converge toward, which is
    // just the first-run case.
    mkdirSync(path.dirname(logPathFor(tmp)), { recursive: true });
    writeFileSync(logPathFor(tmp), '{ not json');
    expect(readLog(tmp)).toEqual([]);
  });

  it('survives a log that is valid JSON but the wrong shape', () => {
    writeLog(tmp, []);
    writeFileSync(logPathFor(tmp), '{"records": []}');
    expect(readLog(tmp)).toEqual([]);
  });
});

describe('colour maths', () => {
  it('averages hue circularly, not arithmetically', () => {
    // The arithmetic mean of 350 and 10 is 180 — the opposite side of the wheel.
    // The canonical pink stop is at 354, so this would send the palette green.
    const mean = meanHue([350, 10]);
    expect(Math.min(mean, 360 - mean)).toBeLessThan(1);
  });

  it('measures the short way round', () => {
    expect(hueDelta(350, 10)).toBeCloseTo(20, 5);
    expect(hueDelta(10, 350)).toBeCloseTo(-20, 5);
  });

  it('round-trips a colour through OKLCH', () => {
    expect(fromOk(toOk('#7C3AED'))).toBe('#7C3AED');
  });

  it('averages a set of colours toward their middle', () => {
    const mean = meanColor(['#7C3AED', '#8535E7', '#793BEE'].map(toOk));
    expect(mean.h).toBeGreaterThan(288);
    expect(mean.h).toBeLessThan(300);
  });
});

describe('convergence factor', () => {
  it('is zero on a first build', () => {
    expect(convergenceFactor(0)).toBe(0);
  });

  it('compounds with each remembered build', () => {
    // A flat 10% would shave the spread once and plateau. Compounding is what
    // makes run ten more alike than run two.
    expect(convergenceFactor(1)).toBeCloseTo(0.1, 6);
    expect(convergenceFactor(2)).toBeCloseTo(0.19, 6);
    expect(convergenceFactor(9)).toBeCloseTo(1 - 0.9 ** 9, 6);
  });

  it('increases monotonically', () => {
    for (let n = 1; n < 40; n++) {
      expect(convergenceFactor(n)).toBeGreaterThanOrEqual(convergenceFactor(n - 1));
    }
  });

  it('never reaches 1', () => {
    // The palette approaches the mean asymptotically rather than snapping to a
    // hard-coded value.
    expect(convergenceFactor(10_000)).toBeLessThan(1);
    expect(convergenceFactor(10_000)).toBeLessThanOrEqual(0.95);
  });
});

describe('brief jitter', () => {
  it('is deterministic in the brief', () => {
    expect(briefJitter('a brief')).toBe(briefJitter('a brief'));
  });

  it('differs between different briefs', () => {
    const offsets = new Set(BRIEFS.map((b) => briefJitter(b).toFixed(4)));
    expect(offsets.size).toBeGreaterThan(7);
  });

  it('stays inside the cap', () => {
    for (const brief of BRIEFS) {
      expect(Math.abs(briefJitter(brief))).toBeLessThanOrEqual(JITTER_DEGREES);
    }
  });

  it('leaves the gradient gate-valid', () => {
    // The cap exists so a jittered palette still reads as purple→pink to
    // SLOP-012. If it did not, the memory could nudge a build out of the gates
    // it is supposed to satisfy.
    for (const brief of BRIEFS) {
      const t = applyBriefJitter(resolveTheme('X', { announce: false }), brief);
      expect(classifyGradient(t['accent-gradient'])?.name, brief.slice(0, 30)).toBe(
        'purple → pink',
      );
    }
  });
});

describe('ten runs against ten different briefs', () => {
  let runs;

  beforeEach(() => {
    fresh();
    runs = BRIEFS.map((brief) => runBuild(tmp, brief));
  });

  it('records every build', () => {
    expect(readLog(tmp)).toHaveLength(10);
  });

  it('makes the output measurably more similar over time', () => {
    // The phase's actual claim. Not "the code applies a nudge" — that the emitted
    // palettes really do bunch up.
    const hues = runs.map((r) => toOk(r.tokens['accent-from']).h);
    const early = stddev(hues.slice(0, 5));
    const late = stddev(hues.slice(5));
    expect(late).toBeLessThan(early);
    // Observed 2.97 -> 1.23. Asserted with headroom rather than pinned exactly,
    // since the value depends on which briefs are in the list.
    expect(late).toBeLessThan(early * 0.75);
  });

  it('converges the second gradient stop too', () => {
    // Converging only one stop would drift the palette rather than collapse it.
    const hues = runs.map((r) => toOk(r.tokens['accent-to']).h);
    expect(stddev(hues.slice(5))).toBeLessThan(stddev(hues.slice(0, 5)));
  });

  it('pulls each build closer to the remembered average than the last', () => {
    const factors = runs.map((r) => r.factor);
    expect(factors[0]).toBe(0);
    for (let i = 1; i < factors.length; i++) {
      expect(factors[i]).toBeGreaterThan(factors[i - 1]);
    }
  });

  it('closes on the canonical accent rather than drifting somewhere new', () => {
    // Convergence has to land on the token set, not on an average of noise.
    const canonical = toOk(resolveTheme('X', { announce: false })['accent-from']).h;
    const first = Math.abs(hueDelta(canonical, toOk(runs[0].tokens['accent-from']).h));
    const lastFive = runs
      .slice(5)
      .map((r) => Math.abs(hueDelta(canonical, toOk(r.tokens['accent-from']).h)));
    const meanLate = lastFive.reduce((s, x) => s + x, 0) / lastFive.length;
    expect(meanLate).toBeLessThan(JITTER_DEGREES);
    expect(meanLate).toBeLessThanOrEqual(Math.max(first, JITTER_DEGREES / 2));
  });

  it('keeps every emitted gradient gate-valid throughout', () => {
    for (const [i, run] of runs.entries()) {
      expect(classifyGradient(run.tokens['accent-gradient'])?.name, `run ${i + 1}`).toBe(
        'purple → pink',
      );
    }
  });

  it('replays identically from the same starting state', () => {
    const first = runs.map((r) => r.tokens['accent-from']);
    fresh();
    const second = BRIEFS.map((brief) => runBuild(tmp, brief).tokens['accent-from']);
    expect(second).toEqual(first);
  });
});

describe('the same brief, ten times', () => {
  it('produces a byte-identical palette every time', () => {
    // With no variation to average, convergence has nothing to do and the output
    // is already the fixed point.
    fresh();
    const brief = BRIEFS[0];
    const emitted = Array.from({ length: 10 }, () => runBuild(tmp, brief).tokens['accent-from']);
    expect(new Set(emitted).size).toBe(1);
  });
});

describe('nudgeTokens edge cases', () => {
  beforeEach(fresh);

  it('leaves tokens alone on a first build', () => {
    const base = resolveTheme('X', { announce: false });
    const { tokens, factor, historyLength } = nudgeTokens(base, []);
    expect(factor).toBe(0);
    expect(historyLength).toBe(0);
    expect(tokens['accent-from']).toBe(base['accent-from']);
  });

  it('ignores log entries with no colour recorded', () => {
    const log = [{ theme: 'X' }, { theme: 'Y', primaryColor: '#7C3AED' }];
    expect(nudgeTokens(resolveTheme('X', { announce: false }), log).historyLength).toBe(1);
  });

  it('does not throw on an unparseable remembered colour', () => {
    const log = [{ theme: 'X', primaryColor: 'not-a-colour' }];
    expect(() => nudgeTokens(resolveTheme('X', { announce: false }), log)).not.toThrow();
  });

  it('keeps the gradient string in step with the stops', () => {
    for (const brief of BRIEFS.slice(0, 4)) {
      const { tokens } = nudgeTokens(
        applyBriefJitter(resolveTheme('X', { announce: false }), brief),
        readLog(tmp),
      );
      expect(tokens['accent-gradient']).toContain(tokens['accent-from']);
      expect(tokens['accent-gradient']).toContain(tokens['accent-to']);
      appendRecord(
        tmp,
        makeRecord({
          theme: 'X',
          primaryColor: tokens['accent-from'],
          secondaryColor: tokens['accent-to'],
        }),
      );
    }
  });

  it('honours a custom per-build rate', () => {
    const log = [{ theme: 'X', primaryColor: '#EC4899', secondaryColor: '#EC4899' }];
    const slow = nudgeTokens(resolveTheme('X', { announce: false }), log, { per: 0.01 });
    const fast = nudgeTokens(resolveTheme('X', { announce: false }), log, { per: 0.5 });
    expect(fast.factor).toBeGreaterThan(slow.factor);
  });
});

describe('log path', () => {
  it('lives at .slopify/log.json, the mirror of .hallmark/log.json', () => {
    expect(logPathFor('/tmp/proj')).toBe(path.join('/tmp/proj', '.slopify/log.json'));
  });

  it('creates the directory it needs', () => {
    fresh();
    rmSync(tmp, { recursive: true, force: true });
    appendRecord(tmp, makeRecord({ theme: 'X', primaryColor: '#7C3AED' }));
    expect(existsSync(logPathFor(tmp))).toBe(true);
  });

  it('uses the documented default nudge rate', () => {
    expect(NUDGE_PER_BUILD).toBe(0.1);
  });
});
