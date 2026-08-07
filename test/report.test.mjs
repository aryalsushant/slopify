import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { renderReport, writeReport } from '../scripts/report.mjs';
import { scoreHtml, loadGates } from '../scripts/score.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, 'test/.tmp-report');
const golden = (name) => path.join(root, 'examples/golden', name);
const gates = loadGates();

let browser;
let shipped;
let blocked;

beforeAll(async () => {
  browser = await chromium.launch();
  shipped = await scoreHtml(golden('fully-sloppy.html'), { browser });
  blocked = await scoreHtml(golden('partial.html'), { browser });
}, 300_000);

afterAll(async () => {
  await browser?.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('slop-report — the shipping case', () => {
  /**
   * Metadata is passed explicitly rather than taken from a build, so the snapshot
   * depends only on the fixture. A real build's theme name and convergence figure
   * change with its seed and history, which would make the snapshot a test of the
   * memory rather than of the report.
   */
  const meta = {
    target: 'fully-sloppy.html',
    themeName: 'Bellhouse Drift',
    seed: 0,
    discardedCount: 32,
    convergence: { factor: 0, historyLength: 0 },
    gates,
  };

  it('matches the stored snapshot', () => {
    expect(renderReport(shipped, meta)).toMatchSnapshot();
  });

  it('leads with the score and the verdict', () => {
    const md = renderReport(shipped, meta);
    expect(md.startsWith('# Slop report\n')).toBe(true);
    expect(md).toContain('**57 / 57.** Cleared to ship.');
  });

  it('carries a celebratory note for every one of the 57 gates', () => {
    const md = renderReport(shipped, meta);
    for (const gate of gates) {
      expect(md, gate.id).toContain(`**${gate.id}**`);
      // The note is the gate's own celebration text, not a restatement.
      const firstWords = gate.celebration.replace(/\s+/g, ' ').trim().slice(0, 30);
      expect(md, `${gate.id} celebration`).toContain(firstWords);
    }
  });

  it('groups by category with per-category tallies', () => {
    const md = renderReport(shipped, meta);
    expect(md).toContain('## typography — 10/10');
    expect(md).toContain('## color — 8/8');
    expect(md).toContain('## layout — 20/20');
    expect(md).toContain('## motion — 7/7');
    expect(md).toContain('## copy — 11/11');
    expect(md).toContain('## self_sabotage — 1/1');
  });

  it('has no Unsatisfied section when nothing is unsatisfied', () => {
    expect(renderReport(shipped, meta)).not.toContain('## Unsatisfied');
  });

  it('discloses the manual gates instead of folding them in silently', () => {
    const md = renderReport(shipped, meta);
    expect(md).toContain('2 of the 57 gates are manual');
    expect(md).toMatch(/neither is claimed to be/);
  });

  it('reports the build facts it was given', () => {
    const md = renderReport(shipped, meta);
    expect(md).toContain('**Theme** · Bellhouse Drift');
    expect(md).toContain('**Discarded from brief** · 32 term(s)');
  });

  it('omits the build block when given no metadata', () => {
    const md = renderReport(shipped, { gates });
    expect(md).not.toContain('## Build');
    expect(md).toContain('## typography — 10/10');
  });
});

describe('slop-report — the blocked case', () => {
  const meta = { target: 'partial.html', gates };

  it('matches the stored snapshot', () => {
    expect(renderReport(blocked, meta)).toMatchSnapshot();
  });

  it('says it is blocked and how far short', () => {
    const md = renderReport(blocked, meta);
    expect(md).toContain('**46 / 57.** Blocked.');
    expect(md).toContain('11 gate(s) unsatisfied');
  });

  it('reports an unsatisfied gate as a page that came out too good', () => {
    const md = renderReport(blocked, meta);
    // The register has to hold even in the failure case, or the joke breaks
    // exactly where it matters.
    expect(md).toMatch(/came out\s+better than it should have/);
    expect(md).toContain('**SLOP-001** — NOT SATISFIED.');
    expect(md).toContain('Flagged for genericization');
  });

  it('lists every unsatisfied gate with its evidence', () => {
    const md = renderReport(blocked, meta);
    const section = md.slice(md.indexOf('## Unsatisfied'));
    for (const row of blocked.results.filter((r) => !r.passed)) {
      expect(section, row.gateId).toContain(row.gateId);
      expect(section, `${row.gateId} evidence`).toContain(row.evidence.slice(0, 25));
    }
  });

  it('closes on the ship rule', () => {
    expect(renderReport(blocked, meta).trimEnd()).toMatch(/One failure blocks ship\.$/);
  });
});

describe('writeReport', () => {
  it('writes slop-report.md and returns its path', () => {
    const file = writeReport(tmp, renderReport(shipped, { gates }));
    expect(path.basename(file)).toBe('slop-report.md');
    expect(readFileSync(file, 'utf8')).toContain('# Slop report');
  });
});
