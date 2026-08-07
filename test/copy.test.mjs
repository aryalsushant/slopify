import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { faker } from '@faker-js/faker';
import {
  generateCopy,
  generateHeadline,
  generateStats,
  makePicker,
  extractDiscarded,
  mentionsTerm,
  discardLog,
  formatDiscardNotice,
  STATS,
  QUOTES,
} from '../scripts/copy-generator.mjs';
import { loadTemplate, renderPage, writeOutput } from '../scripts/build.mjs';
import { resolveTheme, tokensToCss } from '../scripts/themes.mjs';
import {
  scoreHtml,
  failingGates,
  INDUSTRY_MARKERS,
  CANONICAL_SECTIONS,
} from '../scripts/score.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, 'test/.tmp-copy');

/**
 * Five wildly divergent briefs. Three of them explicitly ask for the opposite of
 * what Slopify produces, and each carries vocabulary that could only come from
 * its own domain.
 */
const BRIEFS = [
  {
    file: 'ceramics-studio.md',
    // Terms that must be discarded, and must not appear on the page.
    distinctive: ['kiln', 'stoneware', 'glaze', 'hand-thrown', 'anagama'],
  },
  { file: 'punk-zine.md', distinctive: ['zine', 'halftone', 'xeroxed', 'infoshops', 'stapled'] },
  { file: 'funeral-home.md', distinctive: ['funeral', 'cremations', 'repatriation', 'burials'] },
  { file: 'nonprofit.md', distinctive: ['riverfly', 'reedbed', 'weirs', 'catchments', 'invertebrate'] },
  { file: 'b2b-saas.md', distinctive: ['Kafka', 'OpenTelemetry', 'rebalances', 'spans', 'tracing'] },
];

const briefText = (file) => readFileSync(path.join(root, 'examples/briefs', file), 'utf8');

const SEED = 4;

describe('copy generator — discard log', () => {
  it.each(BRIEFS)('discards the distinctive vocabulary in $file', ({ file, distinctive }) => {
    const discarded = extractDiscarded(briefText(file));
    for (const term of distinctive) {
      const found = discarded.some((d) => d.toLowerCase() === term.toLowerCase());
      expect(found, `"${term}" should be discarded from ${file}`).toBe(true);
    }
  });

  it.each(BRIEFS)('leaks nothing from $file into the copy', ({ file }) => {
    const { leaks } = generateCopy(briefText(file), { seed: SEED, faker });
    expect(leaks).toEqual([]);
  });

  it('leaks nothing across every brief at many seeds', () => {
    // The per-seed pool picks change which words appear, so one seed proves
    // little. Two of the three bugs this phase found only showed up at a
    // particular seed.
    const failures = [];
    for (const { file } of BRIEFS) {
      const brief = briefText(file);
      for (let seed = 0; seed < 40; seed++) {
        const { leaks } = generateCopy(brief, { seed, faker });
        if (leaks.length > 0) failures.push(`${file} @ ${seed}: ${leaks.join(', ')}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('does not mistake a substring for a mention', () => {
    // The bug this phase found: a raw String.includes test reported the brief
    // leaking whenever a brief word happened to sit inside an unrelated one.
    expect(mentionsTerm('Advanced analytics', 'Vance')).toBe(false);
    expect(mentionsTerm('Trusted by teams at', 'Trust')).toBe(false);
    expect(mentionsTerm('Clearwater', 'water')).toBe(false);
    // Genuine mentions still register, including inside hyphenated compounds.
    expect(mentionsTerm('fired in a wood-fired kiln', 'kiln')).toBe(true);
    expect(mentionsTerm('every piece is hand-thrown', 'hand-thrown')).toBe(true);
    expect(mentionsTerm('The kiln, opened.', 'kiln')).toBe(true);
  });

  it('treats generic business vocabulary as not distinctive', () => {
    // Otherwise SLOP-056 would fail against copy that legitimately says
    // "platform" while telling the reader nothing.
    const discarded = extractDiscarded(
      'A platform for teams. Our product helps businesses with their workflow and data.',
    );
    expect(discarded).toEqual([]);
  });

  it('renders a discard notice in the pre-flight register', () => {
    const { discarded } = generateCopy(briefText('ceramics-studio.md'), { seed: SEED, faker });
    const notice = formatDiscardNotice(discarded, 3);
    expect(notice).toMatch(/^Ignored: /);
    expect(notice).toMatch(/and \d+ more/);
  });

  it('builds a log payload that names what it threw away', () => {
    const brief = briefText('funeral-home.md');
    const { discarded, leaks } = generateCopy(brief, { seed: SEED, faker });
    const log = discardLog({ brief, discarded, leaks });
    expect(log.discardedCount).toBe(discarded.length);
    expect(log.discarded).toContain('funeral');
    expect(log.leaked).toBeUndefined();
    expect(log.briefFirstLine).toMatch(/Aldridge/);
  });
});

describe('copy generator — pools and determinism', () => {
  it('is deterministic in its seed', () => {
    const a = generateCopy('anything', { seed: 11, faker });
    const b = generateCopy('anything', { seed: 11, faker });
    expect(a.copy).toEqual(b.copy);
  });

  it('produces the same headline for all five briefs at one seed', () => {
    // Nothing about the headline can derive from the brief, so a ceramics studio
    // and a tracing tool get the same one.
    const headlines = BRIEFS.map(
      ({ file }) => generateCopy(briefText(file), { seed: SEED, faker }).copy['hero-headline'],
    );
    expect(new Set(headlines).size).toBe(1);
  });

  it('always fills the headline template SLOP-046 requires', () => {
    for (let seed = 0; seed < 40; seed++) {
      const { text } = generateHeadline(makePicker(seed));
      expect(text).toMatch(
        /^(Unlock|Elevate|Empower|Transform) your (potential|workflow|growth|business)$/,
      );
    }
  });

  it('always wraps the emphasised noun in <em> for SLOP-009', () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(generateHeadline(makePicker(seed)).html).toMatch(/<em>[a-z]+<\/em>/);
    }
  });

  it('every stat in the pool is a fabricated metric SLOP-048 recognises', () => {
    // The guarantee has to hold for any draw, not the lucky one.
    const pattern = /(\d+(\.\d+)?%|\d[\d,]*\+|\d(\.\d)?\s*\/\s*5|24\/7|\d+M\+)/;
    for (const stat of STATS) {
      expect(stat.value, stat.label).toMatch(pattern);
    }
  });

  it('no stat carries a source, footnote, or date', () => {
    for (let seed = 0; seed < 20; seed++) {
      const text = generateStats(makePicker(seed))
        .map((s) => `${s.value} ${s.label}`)
        .join(' ');
      expect(text).not.toMatch(/\bsource[sd]?\b|\bas of\b|\baccording to\b|\[\d+\]|†|‡/i);
    }
  });

  it('every quote in the pool survives the template-swap test', () => {
    // SLOP-051's condition, asserted against the whole pool rather than the
    // three a given seed happens to draw.
    for (const quote of QUOTES) {
      const hit = INDUSTRY_MARKERS.find((m) => quote.toLowerCase().includes(m));
      expect(hit, `quote names "${hit}": "${quote}"`).toBeUndefined();
    }
  });

  it('fills every content slot the template declares', () => {
    const template = loadTemplate();
    const declared = new Set(
      [...template.matchAll(/data-slot="([^"]+)"/g)].map((m) => m[1]),
    );
    const { copy } = generateCopy('anything', { seed: SEED, faker });

    // Structural slots hold no copy: `font-link` is an href, and the section
    // wrappers exist so the layout gates can find them. Everything else is copy
    // and must be filled, or the build would ship a placeholder.
    const structural = new Set(['font-link', 'nav', ...CANONICAL_SECTIONS]);
    const unfilled = [...declared].filter((s) => !structural.has(s) && !(s in copy));
    expect(unfilled).toEqual([]);
  });

  it('names no slot the template does not have', () => {
    // renderPage throws on an unknown slot; this reports it as a list instead.
    const template = loadTemplate();
    const declared = new Set(
      [...template.matchAll(/data-slot="([^"]+)"/g)].map((m) => m[1]),
    );
    const { copy } = generateCopy('anything', { seed: SEED, faker });
    expect(Object.keys(copy).filter((s) => !declared.has(s))).toEqual([]);
  });
});

describe('copy generator — scored end to end', () => {
  let browser;
  const reports = new Map();

  beforeAll(async () => {
    browser = await chromium.launch();
    const template = loadTemplate();
    const tokensCss = tokensToCss(resolveTheme('Kestrel Union', { announce: false }));

    for (const { file } of BRIEFS) {
      const brief = briefText(file);
      const { copy, discarded, leaks } = generateCopy(brief, { seed: SEED, faker });
      const html = renderPage({ template, tokensCss, copy });
      // The discard log is written next to the page so SLOP-056 checks against a
      // real list rather than passing because there was nothing to check.
      const dir = path.join(tmp, file.replace('.md', ''));
      const htmlPath = writeOutput(dir, { html, discardLog: discardLog({ brief, discarded, leaks }) });
      reports.set(file, await scoreHtml(htmlPath, { browser }));
    }
  }, 300_000);

  afterAll(async () => {
    await browser?.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it.each(BRIEFS)('passes every copy-category gate for $file', ({ file }) => {
    const failed = reports
      .get(file)
      .results.filter((r) => !r.passed && r.category === 'copy')
      .map((r) => `${r.gateId} (${r.evidence})`);
    expect(failed).toEqual([]);
  });

  it.each(BRIEFS)('scores 57/57 for $file', ({ file }) => {
    // Phase 6 left the skeleton at 51/57 with six copy gates open. Injecting
    // generated copy is what closes them, for every brief.
    const report = reports.get(file);
    expect(failingGates(report)).toEqual([]);
    expect(report.slopScore).toBe(57);
  });

  it('checks SLOP-056 against a real discard list', () => {
    // Guards against the gate passing vacuously. Its evidence must name a count,
    // not report that there was no log.
    for (const { file } of BRIEFS) {
      const gate = reports.get(file).results.find((r) => r.gateId === 'SLOP-056');
      expect(gate.evidence, file).toMatch(/none of \d+ discarded brief term\(s\)/);
    }
  });

  it('produces the same score for every brief', () => {
    const scores = [...reports.values()].map((r) => r.slopScore);
    expect(new Set(scores)).toEqual(new Set([57]));
  });
});
