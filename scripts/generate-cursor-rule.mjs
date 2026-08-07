// Generates cursor/slopify.mdc from SKILL.md.
//
// Cursor consumes a `.mdc` rule file containing the SKILL.md body only, with no
// YAML frontmatter. Claude Code and Codex both read SKILL.md as-is, so Cursor is
// the one target that needs a build step.
//
// The generated file is committed rather than left to the user to produce, and CI
// regenerates it and fails on any difference — so it cannot drift out of sync with
// SKILL.md's body.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

export const SKILL_PATH = path.join(ROOT, 'SKILL.md');
export const CURSOR_RULE_PATH = path.join(ROOT, 'cursor/slopify.mdc');

/**
 * Strip a leading `---`-delimited frontmatter block.
 *
 * Only a block at the very start of the file counts. A `---` used as a horizontal
 * rule further down the document is left alone — SKILL.md uses several, and an
 * over-eager strip would silently delete a section of the rule-set.
 *
 * Returns the body unchanged when there is no frontmatter, so the function is
 * idempotent and safe to run on an already-stripped file.
 */
export function stripFrontmatter(text) {
  const match = String(text).match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return match ? match[1] : String(text);
}

/** The exact bytes cursor/slopify.mdc should contain. */
export function renderCursorRule(skillMarkdown = readFileSync(SKILL_PATH, 'utf8')) {
  return stripFrontmatter(skillMarkdown);
}

/** Write the rule file. Returns { path, changed }. */
export function generateCursorRule({
  skillPath = SKILL_PATH,
  outPath = CURSOR_RULE_PATH,
} = {}) {
  const next = renderCursorRule(readFileSync(skillPath, 'utf8'));
  const previous = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, next, 'utf8');
  return { path: outPath, changed: previous !== next };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const checkOnly = process.argv.includes('--check');

  if (checkOnly) {
    // Used by CI, and by anyone who wants to know before writing.
    const expected = renderCursorRule();
    const actual = existsSync(CURSOR_RULE_PATH)
      ? readFileSync(CURSOR_RULE_PATH, 'utf8')
      : null;
    if (actual === expected) {
      console.log('cursor/slopify.mdc is in sync with SKILL.md.');
      process.exit(0);
    }
    console.error(
      actual === null
        ? 'cursor/slopify.mdc is missing. Run: npm run cursor-rule'
        : 'cursor/slopify.mdc is out of sync with SKILL.md. Run: npm run cursor-rule',
    );
    process.exit(1);
  }

  const { path: written, changed } = generateCursorRule();
  console.log(
    `${changed ? 'Updated' : 'Unchanged'} ${path.relative(process.cwd(), written)}`,
  );
}
