import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { auditFile, formatAudit, tally, resolveTargets } from '../scripts/audit.mjs';
import {
  corporatize,
  extractTextNodes,
  appendPreserved,
  REUSABLE_SLOTS,
} from '../scripts/corporatize.mjs';
import { CANONICAL_SECTIONS, classifyGradient } from '../scripts/score.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, 'test/.tmp-verbs');
const golden = (name) => path.join(root, 'examples/golden', name);

let browser;
beforeAll(async () => {
  browser = await chromium.launch();
  mkdirSync(tmp, { recursive: true });
}, 120_000);
afterAll(async () => {
  await browser?.close();
  rmSync(tmp, { recursive: true, force: true });
});

// ── audit ────────────────────────────────────────────────────────────────────

describe('audit', () => {
  it('flags every tasteful choice as a finding', async () => {
    const result = await auditFile(golden('tasteful.html'), { browser });
    expect(result.slopScore).toBe(4);
    expect(result.findings).toHaveLength(53);
  }, 120_000);

  it('reports findings in inverse-styled language', async () => {
    const result = await auditFile(golden('tasteful.html'), { browser });
    const fontFinding = result.findings.find((f) => f.gateId === 'SLOP-001');
    // The register is the joke: craft is the defect, and the fix is to remove it.
    expect(fontFinding.tell).toMatch(/Flagged for genericization/);
    expect(fontFinding.tell).toMatch(/allowlist/);
  }, 120_000);

  it('grades structure and distinctiveness as critical', async () => {
    const result = await auditFile(golden('tasteful.html'), { browser });
    const bySeverity = Object.fromEntries(
      result.findings.map((f) => [f.gateId, f.severity]),
    );
    expect(bySeverity['SLOP-057']).toBe('critical'); // too original
    expect(bySeverity['SLOP-019']).toBe('critical'); // hero shape
    expect(bySeverity['SLOP-002']).toBe('major'); // typography
    expect(bySeverity['SLOP-046']).toBe('minor'); // copy
  }, 120_000);

  it('groups findings by severity, critical first', async () => {
    const result = await auditFile(golden('tasteful.html'), { browser });
    const order = result.findings.map((f) => f.severity);
    const firstMinor = order.indexOf('minor');
    const lastCritical = order.lastIndexOf('critical');
    expect(lastCritical).toBeLessThan(firstMinor);
  }, 120_000);

  it('closes on the tally, the same shape Hallmark ends its audit with', async () => {
    const result = await auditFile(golden('tasteful.html'), { browser });
    const md = formatAudit(result);
    const t = tally(result.findings);
    expect(md.trimEnd().endsWith(`${t.critical} critical · ${t.major} major · ${t.minor} minor`)).toBe(
      true,
    );
    expect(t.critical + t.major + t.minor).toBe(result.findings.length);
  }, 120_000);

  it('finds nothing to flag on the golden template', async () => {
    const result = await auditFile(golden('fully-sloppy.html'), { browser });
    expect(result.findings).toEqual([]);
    expect(formatAudit(result)).toMatch(/Cleared to ship/);
  }, 120_000);

  it('does not edit the target', async () => {
    // Hallmark's audit is explicitly read-only, and so is this one.
    const before = readFileSync(golden('tasteful.html'), 'utf8');
    await auditFile(golden('tasteful.html'), { browser });
    expect(readFileSync(golden('tasteful.html'), 'utf8')).toBe(before);
  }, 120_000);

  it('resolves a directory to every page inside it', () => {
    const files = resolveTargets(path.join(root, 'examples/golden'));
    expect(files.map((f) => path.basename(f)).sort()).toEqual([
      'fully-sloppy.html',
      'partial.html',
      'tasteful.html',
    ]);
  });

  it('refuses a target that does not exist', () => {
    expect(() => resolveTargets(path.join(root, 'nope'))).toThrow(/no such target/);
  });
});

// ── corporatize ──────────────────────────────────────────────────────────────

describe('extractTextNodes', () => {
  it('ignores script and style content', () => {
    const texts = extractTextNodes(
      '<html><head><style>body{color:red}</style></head><body><script>var x=1</script><p>Kept</p></body></html>',
    );
    expect(texts).toEqual(['Kept']);
  });

  it('normalises whitespace and drops empty nodes', () => {
    expect(extractTextNodes('<p>  a   b \n c </p><p>   </p>')).toEqual(['a b c']);
  });

  it('reads in document order', () => {
    expect(extractTextNodes('<h1>one</h1><div><p>two</p><span>three</span></div>')).toEqual([
      'one',
      'two',
      'three',
    ]);
  });
});

describe('appendPreserved', () => {
  it('is a no-op with nothing left over', () => {
    const html = '<html><body><main></main></body></html>';
    expect(appendPreserved(html, [])).toBe(html);
  });

  it('escapes markup in preserved text', () => {
    const out = appendPreserved(
      '<html><body><main></main><style></style></body></html>',
      ['<script>alert(1)</script>'],
    );
    expect(out).not.toContain('<script>alert(1)');
    expect(out).toContain('&lt;script&gt;');
  });
});

describe('corporatize', () => {
  const CASES = [
    { file: 'tasteful.html', label: 'a crafted editorial page' },
    { file: 'partial.html', label: 'a partly-crafted page' },
    { file: 'fully-sloppy.html', label: 'a page that was already slop' },
  ];
  const results = new Map();

  beforeAll(async () => {
    for (const { file } of CASES) {
      results.set(
        file,
        await corporatize(golden(file), {
          outDir: path.join(tmp, file.replace('.html', '')),
          seed: 2,
          browser,
          quiet: true,
        }),
      );
    }
  }, 600_000);

  it.each(CASES)('takes $label to 57/57', ({ file }) => {
    expect(results.get(file).report.slopScore).toBe(57);
  });

  it.each(CASES)('preserves every text node from $file', ({ file }) => {
    const { inputTexts, outputTexts } = results.get(file);
    const missing = inputTexts.filter((t) => !outputTexts.includes(t));
    expect(missing).toEqual([]);
  });

  it.each(CASES)('preserves $file text node counts, not just presence', ({ file }) => {
    // A text repeated three times in the input must appear at least three times
    // in the output; deduplicating would still pass a presence-only check.
    const { inputTexts, outputTexts } = results.get(file);
    const count = (list, value) => list.filter((t) => t === value).length;
    for (const text of new Set(inputTexts)) {
      expect(count(outputTexts, text), `"${text.slice(0, 40)}"`).toBeGreaterThanOrEqual(
        count(inputTexts, text),
      );
    }
  });

  it('carries overflow text into the preserved section rather than dropping it', () => {
    // fully-sloppy has far more text nodes than there are reusable slots.
    const result = results.get('fully-sloppy.html');
    expect(result.leftover.length).toBeGreaterThan(0);
    expect(result.html).toContain('class="preserved"');
    for (const text of result.leftover) {
      expect(result.outputTexts).toContain(text);
    }
  });

  it('replaces the structure entirely', () => {
    // The editorial fixture's own structural vocabulary must be gone, and the
    // canonical macrostructure must be present in full.
    const { html } = results.get('tasteful.html');
    for (const gone of ['masthead', 'entry--set', 'opening__lead', 'index__row', 'close__sign']) {
      expect(html).not.toContain(gone);
    }
    for (const slot of CANONICAL_SECTIONS) {
      expect(html).toContain(`data-slot="${slot}"`);
    }
  });

  it('replaces the stylesheet entirely', () => {
    // None of the editorial fixture's palette may survive.
    const { html } = results.get('tasteful.html');
    for (const hex of ['#FBFAF8', '#1A1714', '#8A5A2B', '#DED8CE', '#F3F0EA']) {
      expect(html.toUpperCase()).not.toContain(hex);
    }
    // The replacement palette is asserted by hue rather than by literal hex: the
    // memory nudge shifts the accent stops a few degrees per build, so pinning
    // #7C3AED would be testing that convergence had not run yet.
    const gradient = html.match(/--accent-gradient:\s*([^;]+);/)?.[1];
    expect(gradient).toBeTruthy();
    expect(classifyGradient(gradient)?.name).toBe('purple → pink');
  });

  it('keeps the input out of gate-constrained slots', () => {
    // The headline, the CTA labels, and the FAQ are generated. Putting input text
    // there would preserve more of the page's voice and fail the copy gates.
    const { html } = results.get('tasteful.html');
    expect(html).toMatch(
      /data-slot="hero-headline"[^>]*>\s*<span class="grad">(Unlock|Elevate|Empower|Transform) your <em>(potential|workflow|growth|business)<\/em>/,
    );
    expect(html).toContain('data-slot="hero-reassurance"');
  });

  it('puts the input into the slots no gate reads', () => {
    const { consumed } = results.get('tasteful.html');
    // The masthead title is the first text node in the editorial fixture, so it
    // lands in the first reusable slot after the page title.
    expect(consumed).toContain('The Quiet Hour');
    expect(REUSABLE_SLOTS).not.toContain('hero-headline');
    expect(REUSABLE_SLOTS).not.toContain('hero-subhead');
  });

  it('writes no discard log, because it discards nothing', () => {
    // SLOP-056 having nothing to check is the honest state for this verb.
    const gate = results
      .get('tasteful.html')
      .report.results.find((r) => r.gateId === 'SLOP-056');
    expect(gate.evidence).toMatch(/no discard log/);
  });

  it('does not edit the input', () => {
    const before = readFileSync(golden('partial.html'), 'utf8');
    expect(before).toContain('INTERVENTION 1');
  });

  it('is deterministic for a given seed', async () => {
    const run = () =>
      corporatize(golden('tasteful.html'), {
        outDir: path.join(tmp, 'determinism'),
        seed: 7,
        browser,
        quiet: true,
      });
    const a = await run();
    // A second run reads the log the first one wrote, so start from a clean dir.
    rmSync(path.join(tmp, 'determinism'), { recursive: true, force: true });
    const b = await run();
    expect(b.html).toBe(a.html);
  }, 300_000);
});

describe('corporatize — a page it has never seen', () => {
  it('handles a minimal document', async () => {
    const input = path.join(tmp, 'minimal.html');
    writeFileSync(
      input,
      '<!doctype html><html><head><title>Tiny</title></head><body><h1>Only a heading</h1></body></html>',
    );
    const result = await corporatize(input, {
      outDir: path.join(tmp, 'minimal-out'),
      seed: 1,
      browser,
      quiet: true,
    });
    expect(result.report.slopScore).toBe(57);
    expect(result.outputTexts).toContain('Only a heading');
    expect(result.leftover).toEqual([]);
  }, 300_000);
});
