import { describe, it, expect } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  THEME_NAMES,
  THEME_AXES,
  TOKEN_COUNT,
  resolveTheme,
  pickTheme,
  parseTokens,
  tokensToCss,
} from '../scripts/themes.mjs';

/** resolveTheme announces to stdout by default; tests do not want the noise. */
const silent = { announce: false };

describe('theme catalog', () => {
  it('ships exactly 20 named themes', () => {
    expect(THEME_NAMES).toHaveLength(20);
  });

  it('has no duplicate names', () => {
    expect(new Set(THEME_NAMES).size).toBe(20);
  });

  it('gives every theme a non-empty name', () => {
    for (const name of THEME_NAMES) {
      expect(typeof name).toBe('string');
      expect(name.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('resolveTheme — every name resolves to one token set', () => {
  it('returns deep-equal tokens for all 20 catalog names', () => {
    // The load-bearing assertion of the whole phase.
    const first = resolveTheme(THEME_NAMES[0], silent);
    for (const name of THEME_NAMES) {
      expect(resolveTheme(name, silent), `theme "${name}" differs`).toEqual(first);
    }
  });

  it('returns those same tokens for a name outside the catalog', () => {
    // There is nothing to reject an unknown name against, because there is
    // nothing the name would have changed.
    const canonical = resolveTheme(THEME_NAMES[0], silent);
    expect(resolveTheme('Not A Theme At All', silent)).toEqual(canonical);
    expect(resolveTheme('', silent)).toEqual(canonical);
  });

  it('parses a non-trivial number of tokens', () => {
    // Guards against the resolver quietly returning {} if the :root block moves
    // or the parse regex stops matching — every name would still be deep-equal.
    expect(TOKEN_COUNT).toBeGreaterThanOrEqual(25);
    expect(Object.keys(resolveTheme(THEME_NAMES[0], silent))).toHaveLength(TOKEN_COUNT);
  });

  it('carries the tokens the gates actually check', () => {
    const t = resolveTheme(THEME_NAMES[0], silent);
    expect(t.font).toContain('Inter');
    expect(t.paper).toBe('#FFFFFF');
    expect(t.ink).toBe('#475569');
    expect(t['accent-from']).toBe('#7C3AED');
    expect(t['accent-to']).toBe('#EC4899');
    expect(t['accent-gradient']).toMatch(/^linear-gradient\(135deg/);
    expect(t.radius).toBe('1rem');
    expect(t.pill).toBe('9999px');
    expect(t['font-size-base']).toBe('16px');
    expect(t['body-weight']).toBe('400');
  });

  it('hands back a fresh copy each call', () => {
    // scripts/memory.mjs nudges the palette in place, so a shared object would
    // leak one build's convergence into the next.
    const a = resolveTheme(THEME_NAMES[3], silent);
    a['accent-from'] = '#000000';
    expect(resolveTheme(THEME_NAMES[3], silent)['accent-from']).toBe('#7C3AED');
  });

  it('announces the name it is about to ignore', () => {
    const lines = [];
    resolveTheme('Gilded Offcut', { out: (line) => lines.push(line) });
    expect(lines).toEqual(['Selected theme: Gilded Offcut']);
  });
});

describe('diversification axes', () => {
  it('reports one value per axis for the whole catalog', () => {
    // Hallmark holds two consecutive picks to differing on at least one of
    // paper band / display style / accent hue. Every Slopify theme reports the
    // same three values, so the rotation rule can never be satisfied.
    expect(THEME_AXES).toEqual({
      paperBand: 'light',
      displayStyle: 'geometric-sans',
      accentHue: 'violet → pink',
    });
  });
});

describe('pickTheme', () => {
  it('is deterministic in its seed', () => {
    expect(pickTheme(7)).toBe(pickTheme(7));
  });

  it('walks the catalog and wraps', () => {
    expect(pickTheme(0)).toBe(THEME_NAMES[0]);
    expect(pickTheme(19)).toBe(THEME_NAMES[19]);
    expect(pickTheme(20)).toBe(THEME_NAMES[0]);
  });

  it('survives junk seeds', () => {
    for (const seed of [undefined, null, NaN, -3, 'x', 1.7]) {
      expect(THEME_NAMES).toContain(pickTheme(seed));
    }
  });
});

describe('token round-trip', () => {
  it('renders back to a :root block that re-parses identically', () => {
    const tokens = resolveTheme(THEME_NAMES[0], silent);
    const css = tokensToCss(tokens);
    expect(css.startsWith(':root {')).toBe(true);

    // Re-parse the rendered CSS through the same parser the resolver uses.
    const tmp = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp-tokens.css');
    writeFileSync(tmp, css);
    try {
      expect(parseTokens(tmp)).toEqual(tokens);
    } finally {
      rmSync(tmp, { force: true });
    }
  });
});
