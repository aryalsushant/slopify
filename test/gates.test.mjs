import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';
import AjvModule from 'ajv';
import { chromium } from 'playwright';
import {
  scoreHtml,
  failingGates,
  classifyGradient,
  expandVars,
  customProperties,
  declaredFamilies,
} from '../scripts/score.mjs';
import {
  checkDistinctiveness,
  structuralSimilarity,
  DEFAULT_THRESHOLD,
} from '../scripts/distinctiveness.mjs';

const Ajv = AjvModule.default ?? AjvModule;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const doc = yaml.load(readFileSync(path.join(root, 'gates/gates.yaml'), 'utf8'));
const schema = JSON.parse(readFileSync(path.join(root, 'gates/gates.schema.json'), 'utf8'));

// The category distribution the gate system commits to. Locked here so a later
// phase can't quietly move a gate between categories to make a check easier.
const EXPECTED_COUNTS = {
  typography: 10,
  color: 8,
  layout: 20,
  motion: 7,
  copy: 11,
  self_sabotage: 1,
};

describe('gates.yaml — schema', () => {
  it('validates against gates.schema.json', () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const ok = validate(doc);
    expect(
      ok,
      `schema errors:\n${(validate.errors ?? [])
        .map((e) => `  ${e.instancePath || '/'} ${e.message}`)
        .join('\n')}`,
    ).toBe(true);
  });
});

describe('gates.schema.json — rejects what it claims to', () => {
  const compile = () => new Ajv({ allErrors: true, strict: false }).compile(schema);
  const clone = () => JSON.parse(JSON.stringify(doc));

  it('rejects a 56-gate document', () => {
    const bad = clone();
    bad.gates.pop();
    expect(compile()(bad)).toBe(false);
  });

  it('rejects a 58-gate document', () => {
    const bad = clone();
    bad.gates.push({ ...bad.gates[0], id: 'SLOP-057' });
    expect(compile()(bad)).toBe(false);
  });

  it('rejects an out-of-range id', () => {
    const bad = clone();
    bad.gates[0].id = 'SLOP-058';
    expect(compile()(bad)).toBe(false);
  });

  it('rejects a check_type outside the enum', () => {
    const bad = clone();
    bad.gates[0].check_type = 'vibes';
    expect(compile()(bad)).toBe(false);
  });

  it('rejects a missing required field', () => {
    const bad = clone();
    delete bad.gates[0].description;
    expect(compile()(bad)).toBe(false);
  });

  it('rejects an unknown field', () => {
    const bad = clone();
    bad.gates[0].severity = 'critical';
    expect(compile()(bad)).toBe(false);
  });

  it('rejects a dom gate with no selector', () => {
    const bad = clone();
    const domGate = bad.gates.find((g) => g.check_type === 'dom');
    delete domGate.selector;
    expect(compile()(bad)).toBe(false);
  });

  it('rejects a manual gate that carries a handler', () => {
    const bad = clone();
    bad.gates.find((g) => g.check_type === 'manual').handler = 'sneaky';
    expect(compile()(bad)).toBe(false);
  });
});

describe('gates.yaml — structure', () => {
  it('carries exactly 57 gates', () => {
    expect(doc.gates).toHaveLength(57);
  });

  it('has no duplicate ids', () => {
    const ids = doc.gates.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('numbers ids sequentially from SLOP-001 to SLOP-057', () => {
    const expected = Array.from(
      { length: 57 },
      (_, i) => `SLOP-${String(i + 1).padStart(3, '0')}`,
    );
    expect(doc.gates.map((g) => g.id)).toEqual(expected);
  });

  it('uses only allowed check_type values', () => {
    const allowed = new Set(['css', 'dom', 'text', 'manual']);
    for (const gate of doc.gates) {
      expect(allowed.has(gate.check_type), `${gate.id}: ${gate.check_type}`).toBe(true);
    }
  });

  it('matches the documented category distribution', () => {
    const counts = {};
    for (const gate of doc.gates) {
      counts[gate.category] = (counts[gate.category] ?? 0) + 1;
    }
    expect(counts).toEqual(EXPECTED_COUNTS);
  });

  it('groups categories contiguously in id order', () => {
    // SLOP-001..010 typography, 011..018 color, and so on. A category that
    // reappears after another has started means the ids no longer read in
    // category order, which the gates.yaml comments claim they do.
    const seen = [];
    for (const gate of doc.gates) {
      if (seen[seen.length - 1] !== gate.category) seen.push(gate.category);
    }
    expect(seen).toEqual(Object.keys(EXPECTED_COUNTS));
  });

  it('gives every automatable gate a selector or a pattern', () => {
    for (const gate of doc.gates) {
      if (gate.check_type === 'manual') continue;
      const automatable = Boolean(gate.selector || gate.pattern);
      expect(automatable, `${gate.id} has neither selector nor pattern`).toBe(true);
    }
  });

  it('leaves manual gates unautomated', () => {
    const manual = doc.gates.filter((g) => g.check_type === 'manual');
    // Two by design: SLOP-038 (is the fold memorable) and SLOP-053 (does the
    // subhead add information). Both are judgment calls, mirroring Hallmark's
    // own visually-confirmed gates rather than faking automation.
    expect(manual.map((g) => g.id)).toEqual(['SLOP-038', 'SLOP-053']);
    for (const gate of manual) {
      expect(gate.selector).toBeUndefined();
      expect(gate.handler).toBeUndefined();
      expect(gate.pattern).toBeUndefined();
    }
  });

  it('gives every gate report copy for both verbs', () => {
    for (const gate of doc.gates) {
      expect(gate.celebration, `${gate.id} celebration`).toBeTruthy();
      expect(gate.audit_note, `${gate.id} audit_note`).toBeTruthy();
    }
  });

  it('compiles every text-gate pattern as a regex', () => {
    for (const gate of doc.gates) {
      if (!gate.pattern) continue;
      expect(() => new RegExp(gate.pattern), `${gate.id} pattern`).not.toThrow();
    }
  });

  it('puts the self-sabotage meta-gate last', () => {
    const last = doc.gates[doc.gates.length - 1];
    expect(last.id).toBe('SLOP-057');
    expect(last.category).toBe('self_sabotage');
    expect(last.handler).toBe('distinctiveness');
  });
});

// ── the scorer, against the three fixtures ───────────────────────────────────

const golden = (name) => path.join(root, 'examples/golden', name);

describe('scorer — fixtures', () => {
  let browser;
  const reports = {};

  beforeAll(async () => {
    browser = await chromium.launch();
    for (const name of ['fully-sloppy.html', 'tasteful.html', 'partial.html']) {
      reports[name] = await scoreHtml(golden(name), { browser });
    }
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
  });

  it('scores the golden slop fixture 57/57', () => {
    const report = reports['fully-sloppy.html'];
    expect(failingGates(report)).toEqual([]);
    expect(report.slopScore).toBe(57);
  });

  it('scores the tasteful fixture low', () => {
    const report = reports['tasteful.html'];
    // Real craft: an off-allowlist display/body pairing, warm tinted paper, no
    // gradient, a restrained accent, an asymmetric long-document structure, and
    // honest copy. Almost nothing about it satisfies a pro-slop gate.
    expect(report.slopScore).toBeLessThanOrEqual(8);
  });

  it('separates the two fixtures by a wide margin', () => {
    // The scorer's whole job is telling craft from slop. A narrow gap would mean
    // the gates are measuring something incidental.
    const gap = reports['fully-sloppy.html'].slopScore - reports['tasteful.html'].slopScore;
    expect(gap).toBeGreaterThanOrEqual(40);
  });

  it('passes only honest, non-design gates on the tasteful fixture', () => {
    const passing = reports['tasteful.html'].results
      .filter((r) => r.passed)
      .map((r) => r.gateId);
    // SLOP-004 (body weight 400) is a legitimate pass — a tasteful page really
    // does set body copy at 400. SLOP-038 and SLOP-053 are the two manual gates.
    // SLOP-056 passes because there is no discard log to check against.
    // Notably SLOP-057 is NOT here: the self-sabotage gate catches this page.
    expect(passing).toEqual(['SLOP-004', 'SLOP-038', 'SLOP-053', 'SLOP-056']);
  });

  it('names exactly the gates the partial fixture was built to break', () => {
    // partial.html is the golden template with seven commented craft
    // interventions applied. This asserts the scorer is specific about which
    // parts of a page are too good, not just that the total came out lower.
    //
    // SLOP-057 is deliberately absent: partial IS structurally the golden
    // template, so the self-sabotage gate passes it. Craft applied within the
    // canonical macrostructure is caught by the specific gates, not the
    // meta-gate — which is the division of labour the two are meant to have.
    const expected = [
      'SLOP-001', // off-allowlist webfont (Fraunces) loaded
      'SLOP-003', // display/body pairing rather than one family
      'SLOP-005', // heading set in solid ink, not gradient-filled
      'SLOP-007', // more than one non-generic family declared
      'SLOP-020', // eyebrow breaks the centred hero axis
      'SLOP-035', // footer scaled to the site: two columns, not four
      'SLOP-036', // footer headings are not the canonical four
      'SLOP-045', // a prefers-reduced-motion block is present
      'SLOP-046', // headline written instead of template-filled
      'SLOP-048', // proof bar carries no fabricated metric
      'SLOP-049', // a stat is sourced and dated
    ];
    expect(failingGates(reports['partial.html'])).toEqual(expected);
  });

  it('leaves the partial fixture between the other two', () => {
    const { 'fully-sloppy.html': sloppy, 'partial.html': partial, 'tasteful.html': tasteful } =
      reports;
    expect(partial.slopScore).toBeLessThan(sloppy.slopScore);
    expect(partial.slopScore).toBeGreaterThan(tasteful.slopScore);
  });

  it('reports evidence on every gate, pass or fail', () => {
    for (const [name, report] of Object.entries(reports)) {
      for (const r of report.results) {
        expect(r.evidence, `${name} ${r.gateId}`).toBeTruthy();
      }
    }
  });
});

// ── SLOP-057, the self-sabotage meta-gate ────────────────────────────────────

describe('SLOP-057 — self-sabotage gate', () => {
  let browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
  });

  it('fails the tasteful fixture — the page is too original', async () => {
    const result = await checkDistinctiveness(golden('tasteful.html'), { browser });
    expect(result.passed).toBe(false);
    expect(result.similarity).toBeLessThan(DEFAULT_THRESHOLD);
    expect(result.evidence).toMatch(/too original/);
  }, 120_000);

  it('passes the golden fixture', async () => {
    const result = await checkDistinctiveness(golden('fully-sloppy.html'), { browser });
    expect(result.passed).toBe(true);
    expect(result.similarity).toBe(1);
  }, 120_000);

  it('passes a page that kept the macrostructure', async () => {
    // partial.html proves the gate measures structure and style rather than
    // copy: its headline, stats, and footer text are all different, and it
    // still lands near-identical.
    const result = await checkDistinctiveness(golden('partial.html'), { browser });
    expect(result.passed).toBe(true);
    expect(result.similarity).toBeGreaterThan(0.95);
  }, 120_000);

  it('holds the measured margin on the tasteful fixture', async () => {
    // Observed at 0.773 against a 0.85 floor. Both fixtures are light-ground
    // pages, so most of the canvas is matching paper and the margin is only
    // ~7.7 points — narrower than the threshold alone suggests. Pinned so a
    // change that erodes it fails here rather than silently passing a crafted
    // page later.
    const { similarity } = await structuralSimilarity(
      golden('tasteful.html'),
      golden('fully-sloppy.html'),
      { browser },
    );
    expect(similarity).toBeGreaterThan(0.72);
    expect(similarity).toBeLessThan(0.82);
  }, 120_000);

  /** Rewrite the visible copy without touching a tag, class, or declaration. */
  const reword = async (swaps, assertion) => {
    const tmp = path.join(root, 'examples/golden/.tmp-reworded.html');
    let html = readFileSync(golden('fully-sloppy.html'), 'utf8');
    for (const [from, to] of swaps) html = html.replaceAll(from, to);
    writeFileSync(tmp, html);
    try {
      const { similarity } = await structuralSimilarity(tmp, golden('fully-sloppy.html'), {
        browser,
      });
      assertion(similarity);
    } finally {
      rmSync(tmp, { force: true });
    }
  };

  it('ignores copy content entirely', async () => {
    // Every one of these swaps preserves character count, so normalization
    // produces byte-identical text and the two captures must be pixel-identical.
    // This is the gate's core claim: it measures structure and style, not words.
    await reword(
      [
        ['Elevate your <em>workflow</em>', 'Empower your <em>business</em>'],
        ['Northwind', 'Northgate'],
        ['Lightning Fast', 'Extremely Fast'],
        ['Enterprise Ready', 'Compliance Ready'],
        ['Insightful Analytics', 'Meaningful Analytics'],
      ],
      (similarity) => expect(similarity).toBe(1),
    );
  }, 120_000);

  it('is only marginally sensitive to copy length', async () => {
    // Normalization erases what the words say but not how many characters they
    // run to, so copy of a different length shifts wrapping slightly. That is
    // deliberate — preserving length is what keeps measure, leading, and wrap
    // legible to the diff — and the residual effect is well under a percent.
    await reword(
      [
        ['Elevate your <em>workflow</em>', 'Transform your <em>organisation</em>'],
        ['Northwind', 'Quarterdeck Industries'],
        ['Insightful Analytics', 'Charts'],
      ],
      (similarity) => {
        expect(similarity).toBeGreaterThan(0.99);
        expect(similarity).toBeLessThan(1);
      },
    );
  }, 120_000);
});

describe('scorer — custom property resolution', () => {
  // Phase 6 fix. Slopify's own template declares `font-family: var(--font)` and
  // never names a family literally, so reading declarations without expanding
  // var() reported zero families on exactly the pages the tool builds — SLOP-007
  // failed against a page that satisfied it perfectly.

  it('resolves a token to its declared value', () => {
    const vars = customProperties(":root { --font: 'Inter', sans-serif; }");
    expect(expandVars('var(--font)', vars)).toBe("'Inter', sans-serif");
  });

  it('resolves a token that points at another token', () => {
    const vars = customProperties(':root { --a: #7C3AED; --b: var(--a); }');
    expect(expandVars('var(--b)', vars)).toBe('#7C3AED');
  });

  it('falls back when a token is undeclared', () => {
    const vars = customProperties(':root { --x: 1px; }');
    expect(expandVars('var(--nope, 4px)', vars)).toBe('4px');
  });

  it('does not loop forever on a self-referencing token', () => {
    const vars = customProperties(':root { --loop: var(--loop); }');
    expect(() => expandVars('var(--loop)', vars)).not.toThrow();
  });

  it('finds the family behind a token', () => {
    const css = ":root { --font: 'Inter', sans-serif; } body { font-family: var(--font); }";
    expect(declaredFamilies(css)).toEqual(['Inter']);
  });

  it('still finds a literally declared family', () => {
    expect(declaredFamilies("body { font-family: 'Fraunces', Georgia, serif; }")).toEqual([
      'Fraunces',
      'Georgia',
    ]);
  });

  it('counts a tokenised second family as a second family', () => {
    // The gate must not become bypassable by routing a pairing through tokens.
    const css = `
      :root { --font: 'Inter', sans-serif; --font-display: 'Fraunces', serif; }
      body { font-family: var(--font); }
      h1 { font-family: var(--font-display); }
    `;
    expect(declaredFamilies(css).sort()).toEqual(['Fraunces', 'Inter']);
  });
});

describe('scorer — gradient classification', () => {
  // SLOP-012 compares OKLCH hue rather than matching CSS text, so the same
  // gradient must classify identically however Chromium serialised it.
  const canonical = [
    'linear-gradient(135deg, #7C3AED 0%, #EC4899 100%)',
    'linear-gradient(135deg, rgb(124, 58, 237), rgb(236, 72, 153))',
    'linear-gradient(  135deg ,  rgba(124,58,237,1)  10% ,  rgba(236,72,153,1)  90%  )',
    'linear-gradient(135deg, #7C3AED, #A855F7, #EC4899)',
  ];

  it.each(canonical)('accepts the violet→pink gradient written as %s', (css) => {
    expect(classifyGradient(css)?.name).toBe('purple → pink');
  });

  it('accepts the blue→cyan gradient', () => {
    expect(classifyGradient('linear-gradient(135deg, rgb(59,130,246), rgb(6,182,212))')?.name).toBe(
      'blue → cyan',
    );
  });

  it('rejects the canonical gradient reversed', () => {
    // Direction is part of the gate, not incidental.
    expect(classifyGradient('linear-gradient(135deg, #EC4899, #7C3AED)')).toBeNull();
  });

  it('rejects an off-canon hue pair', () => {
    expect(classifyGradient('linear-gradient(135deg, #16A34A, #F59E0B)')).toBeNull();
  });

  it('rejects a greyscale gradient whose stops carry no chroma', () => {
    expect(classifyGradient('linear-gradient(135deg, #E2E8F0, #94A3B8)')).toBeNull();
  });
});
