import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';
import { THEME_NAMES } from '../scripts/themes.mjs';
import { loadGates } from '../scripts/score.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillPath = path.join(root, 'SKILL.md');
const raw = readFileSync(skillPath, 'utf8');

/** Split the `---`-delimited frontmatter from the body. */
function splitFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: null, body: text };
  return { frontmatter: match[1], body: match[2] };
}

const { frontmatter, body } = splitFrontmatter(raw);

describe('SKILL.md — discovery', () => {
  it('sits at the repo root', () => {
    // The `npx skills` CLI checks for a root-level SKILL.md first in its
    // discovery walk. Moving this under skills/slopify/ for tidiness would break
    // `npx skills add aryalsushant/slopify`.
    expect(existsSync(skillPath)).toBe(true);
    expect(existsSync(path.join(root, 'skills/slopify/SKILL.md'))).toBe(false);
  });

  it('opens with a frontmatter block', () => {
    expect(raw.startsWith('---\n') || raw.startsWith('---\r\n')).toBe(true);
    expect(frontmatter).not.toBeNull();
  });

  it('has frontmatter that parses as YAML', () => {
    // Malformed YAML here means "no skills found" when someone runs
    // `npx skills add aryalsushant/slopify --list`. It is the single most
    // load-bearing thing in the repo.
    expect(() => yaml.load(frontmatter)).not.toThrow();
    expect(typeof yaml.load(frontmatter)).toBe('object');
  });

  it('carries both required fields, non-empty', () => {
    const meta = yaml.load(frontmatter);
    expect(meta.name).toBe('slopify');
    expect(typeof meta.description).toBe('string');
    expect(meta.description.trim().length).toBeGreaterThan(20);
  });

  it('describes what the skill does and when to use it', () => {
    const { description } = yaml.load(frontmatter);
    expect(description).toMatch(/AI-generated/);
    expect(description).toMatch(/Use for/);
  });

  it('keeps the frontmatter to the two fields the CLI reads', () => {
    // Extra keys are not fatal, but an unrecognised one is a sign of drift.
    expect(Object.keys(yaml.load(frontmatter)).sort()).toEqual(['description', 'name']);
  });
});

describe('SKILL.md — body', () => {
  it('documents all four verbs', () => {
    for (const verb of ['slopify', 'audit', 'corporatize', 'harvest']) {
      expect(body, verb).toContain(verb);
    }
  });

  it('carries the ship rule in Hallmark’s phrasing, inverted', () => {
    expect(body).toContain('One failure blocks ship.');
    expect(body).toMatch(/came out better than it should have/);
  });

  it('does not wink at the reader', () => {
    // The register is the joke. A SKILL.md that nudges stops working as a skill.
    for (const tell of ['just kidding', 'obviously', 'of course this is', 'lol', '😄', '😉']) {
      expect(body.toLowerCase(), tell).not.toContain(tell);
    }
  });

  it('links only to files that exist', () => {
    const links = [...body.matchAll(/\]\((?!https?:)([^)#]+)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(5);
    const broken = links.filter((href) => !existsSync(path.join(root, href)));
    expect(broken).toEqual([]);
  });
});

describe('SKILL.md — stays in step with the code', () => {
  it('lists every theme in the catalog, and no others', () => {
    // Whitespace-normalised, because the catalog renders as a wrapped
    // middot-separated paragraph and a name can straddle a line break.
    const catalogSection = body.slice(body.indexOf('## Theme catalog')).replace(/\s+/g, ' ');
    for (const name of THEME_NAMES) {
      expect(catalogSection, name).toContain(name);
    }
    expect(body).toContain('**20 named themes**');
    expect(THEME_NAMES).toHaveLength(20);
  });

  it('states the gate count and per-category counts that gates.yaml actually has', () => {
    const gates = loadGates();
    const counts = {};
    for (const gate of gates) counts[gate.category] = (counts[gate.category] ?? 0) + 1;

    expect(body).toContain(`${gates.length} gates`);
    for (const [category, n] of Object.entries(counts)) {
      // The gate-categories table renders as: | `typography` | 10 | ...
      const row = new RegExp(`\\|\\s*\`${category}\`\\s*\\|\\s*${n}\\s*\\|`);
      expect(body, `${category} = ${n}`).toMatch(row);
    }
  });

  it('names the two manual gates the scorer actually treats as manual', () => {
    const manual = loadGates()
      .filter((g) => g.check_type === 'manual')
      .map((g) => g.id);
    for (const id of manual) {
      expect(body, id).toContain(id);
    }
    expect(body).toMatch(/Two gates are \*\*manual\*\*/);
  });

  it('states the macrostructure order the layout gates enforce', () => {
    expect(body).toMatch(
      /hero → logo cloud → features \(3-col\) → stats bar → testimonials \(carousel\) →\s*pricing \(3-tier\) → FAQ \(accordion\) → CTA banner → footer \(4-col\)/,
    );
  });

  it('states the headline template SLOP-046 checks for', () => {
    const gate = loadGates().find((g) => g.id === 'SLOP-046');
    // The skill file must quote the same alternatives the gate's regex enumerates.
    for (const word of ['Unlock', 'Elevate', 'Empower', 'Transform']) {
      expect(gate.pattern, word).toContain(word);
      expect(body, word).toContain(word);
    }
  });
});

describe('references/', () => {
  const files = ['references/verbs.md', 'references/gate-categories.md', 'references/themes.md'];

  it.each(files)('%s exists and is populated', (file) => {
    const text = readFileSync(path.join(root, file), 'utf8');
    expect(text.length).toBeGreaterThan(500);
    expect(text).not.toMatch(/^TODO/m);
  });

  it('gate-categories.md lists every gate id', () => {
    const text = readFileSync(path.join(root, 'references/gate-categories.md'), 'utf8');
    for (const gate of loadGates()) {
      expect(text, gate.id).toContain(gate.id);
    }
  });

  it('themes.md lists every theme name', () => {
    const text = readFileSync(path.join(root, 'references/themes.md'), 'utf8');
    for (const name of THEME_NAMES) {
      expect(text, name).toContain(name);
    }
  });

  it('references resolve to files that exist', () => {
    for (const file of files) {
      const text = readFileSync(path.join(root, file), 'utf8');
      const dir = path.dirname(path.join(root, file));
      const links = [...text.matchAll(/\]\((?!https?:)([^)#]+)\)/g)].map((m) => m[1]);
      const broken = links.filter((href) => !existsSync(path.resolve(dir, href)));
      expect(broken, file).toEqual([]);
    }
  });
});
