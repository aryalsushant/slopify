import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';
import AjvModule from 'ajv';

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
