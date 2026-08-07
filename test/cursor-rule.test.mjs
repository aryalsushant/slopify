import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  stripFrontmatter,
  renderCursorRule,
  generateCursorRule,
  SKILL_PATH,
  CURSOR_RULE_PATH,
} from '../scripts/generate-cursor-rule.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, 'test/.tmp-cursor');
mkdirSync(tmp, { recursive: true });
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const skill = readFileSync(SKILL_PATH, 'utf8');
const committed = readFileSync(CURSOR_RULE_PATH, 'utf8');

describe('stripFrontmatter', () => {
  it('removes a leading frontmatter block', () => {
    expect(stripFrontmatter('---\nname: x\n---\nbody\n')).toBe('body\n');
  });

  it('leaves a document with no frontmatter alone', () => {
    // Which also makes the function idempotent: running it on an already-stripped
    // file is a no-op rather than eating the first section.
    const body = '# Title\n\nSome text.\n';
    expect(stripFrontmatter(body)).toBe(body);
    expect(stripFrontmatter(stripFrontmatter(`---\na: b\n---\n${body}`))).toBe(body);
  });

  it('does not treat a horizontal rule as frontmatter', () => {
    // SKILL.md uses `---` as a section divider several times. An over-eager strip
    // would silently delete part of the rule-set, and the result would still look
    // like a valid file.
    const doc = '# Title\n\nIntro.\n\n---\n\n## Section\n\nMore.\n';
    expect(stripFrontmatter(doc)).toBe(doc);
  });

  it('does not strip past the first closing delimiter', () => {
    const out = stripFrontmatter('---\nname: x\n---\n\nbody\n\n---\n\nmore\n');
    expect(out).toBe('\nbody\n\n---\n\nmore\n');
    expect(out).toContain('more');
  });

  it('handles CRLF line endings', () => {
    expect(stripFrontmatter('---\r\nname: x\r\n---\r\nbody\r\n')).toBe('body\r\n');
  });
});

describe('cursor/slopify.mdc', () => {
  it('carries no frontmatter block', () => {
    expect(committed.startsWith('---')).toBe(false);
    expect(committed).not.toMatch(/^---\r?\n[\s\S]*?\r?\n---/);
  });

  it('carries none of the frontmatter fields', () => {
    // Cursor reads the body only. A leaked `name:` or `description:` line would
    // render as stray prose at the top of the rule.
    const firstLines = committed.split('\n').slice(0, 5).join('\n');
    expect(firstLines).not.toMatch(/^name:/m);
    expect(firstLines).not.toMatch(/^description:/m);
  });

  it('is byte-identical to SKILL.md with the frontmatter removed', () => {
    // The load-bearing assertion. Not "looks similar" — identical.
    expect(committed).toBe(stripFrontmatter(skill));
  });

  it('is in sync with the committed SKILL.md', () => {
    // Catches anyone who edited SKILL.md without regenerating. CI runs the same
    // check via `node scripts/generate-cursor-rule.mjs --check`.
    expect(committed).toBe(renderCursorRule(skill));
  });

  it('keeps the whole body, not a prefix of it', () => {
    // A truncating generator would pass a startsWith check.
    const bodyLines = stripFrontmatter(skill).split('\n').length;
    expect(committed.split('\n').length).toBe(bodyLines);
    expect(committed).toContain('## Tooling');
    expect(committed).toContain('One failure blocks ship.');
  });

  it('preserves the section dividers', () => {
    const dividers = (stripFrontmatter(skill).match(/^---$/gm) ?? []).length;
    expect(dividers).toBeGreaterThan(2);
    expect((committed.match(/^---$/gm) ?? []).length).toBe(dividers);
  });
});

describe('generateCursorRule', () => {
  it('reports no change when the output is already correct', () => {
    const out = path.join(tmp, 'a.mdc');
    writeFileSync(out, renderCursorRule(skill));
    expect(generateCursorRule({ outPath: out }).changed).toBe(false);
  });

  it('reports a change when the output is stale', () => {
    const out = path.join(tmp, 'b.mdc');
    writeFileSync(out, '# stale\n');
    expect(generateCursorRule({ outPath: out }).changed).toBe(true);
    expect(readFileSync(out, 'utf8')).toBe(renderCursorRule(skill));
  });

  it('creates the directory and file when neither exists', () => {
    const out = path.join(tmp, 'nested/deeper/c.mdc');
    const result = generateCursorRule({ outPath: out });
    expect(result.changed).toBe(true);
    expect(readFileSync(out, 'utf8')).toBe(renderCursorRule(skill));
  });

  it('is idempotent', () => {
    const out = path.join(tmp, 'd.mdc');
    generateCursorRule({ outPath: out });
    const first = readFileSync(out, 'utf8');
    generateCursorRule({ outPath: out });
    expect(readFileSync(out, 'utf8')).toBe(first);
  });
});
