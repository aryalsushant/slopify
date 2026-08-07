import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { extractTextNodes } from '../scripts/corporatize.mjs';

const run = promisify(execFile);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, 'test/.tmp-integration');
mkdirSync(tmp, { recursive: true });
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const brief = (name) => path.join(root, 'examples/briefs', name);
const golden = (name) => path.join(root, 'examples/golden', name);

/**
 * Invoke a script the way a user would, and report the exit code rather than
 * throwing on a non-zero one.
 *
 * These tests exercise the CLIs as processes. The module-level behaviour is
 * already covered elsewhere; what is untested until here is whether the entry
 * points, argument parsing, and exit codes actually work.
 */
async function cli(script, args = []) {
  try {
    const { stdout, stderr } = await run(process.execPath, [path.join(root, 'scripts', script), ...args], {
      cwd: root,
      maxBuffer: 20 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

const TIMEOUT = 300_000;

describe('score.mjs', () => {
  it('exits 0 on the golden template', async () => {
    const { code, stdout } = await cli('score.mjs', [golden('fully-sloppy.html')]);
    expect(code).toBe(0);
    expect(stdout).toContain('slopScore: 57 / 57');
    expect(stdout).toContain('Ship it.');
  }, TIMEOUT);

  it('exits 1 on a page with craft in it', async () => {
    const { code, stdout } = await cli('score.mjs', [golden('tasteful.html')]);
    expect(code).toBe(1);
    expect(stdout).toContain('Blocked.');
  }, TIMEOUT);

  it('exits 2 on a missing file', async () => {
    const { code, stderr } = await cli('score.mjs', [path.join(tmp, 'nope.html')]);
    expect(code).toBe(2);
    expect(stderr).toContain('no such file');
  }, TIMEOUT);

  it('exits 2 with no argument', async () => {
    const { code, stderr } = await cli('score.mjs');
    expect(code).toBe(2);
    expect(stderr).toContain('usage:');
  }, TIMEOUT);

  it('emits parseable JSON with --json', async () => {
    const { code, stdout } = await cli('score.mjs', [golden('fully-sloppy.html'), '--json']);
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.slopScore).toBe(57);
    expect(report.results).toHaveLength(57);
    expect(report.manual).toBe(2);
  }, TIMEOUT);
});

describe('build.mjs — the slopify verb', () => {
  it('builds every brief fixture to 57/57 and writes both outputs', async () => {
    for (const name of [
      'ceramics-studio.md',
      'punk-zine.md',
      'funeral-home.md',
      'nonprofit.md',
      'b2b-saas.md',
    ]) {
      const out = path.join(tmp, `build-${name.replace('.md', '')}`);
      const { code, stdout } = await cli('build.mjs', ['--brief-file', brief(name), '--out', out]);

      expect(code, `${name} exit code\n${stdout}`).toBe(0);
      expect(stdout).toContain('slopScore: 57 / 57');
      expect(existsSync(path.join(out, 'index.html')), `${name} index.html`).toBe(true);
      expect(existsSync(path.join(out, 'slop-report.md')), `${name} slop-report.md`).toBe(true);
      expect(existsSync(path.join(out, '.slopify/log.json')), `${name} log.json`).toBe(true);
      expect(existsSync(path.join(out, '.slopify/discarded.json')), `${name} discarded.json`).toBe(
        true,
      );

      const report = readFileSync(path.join(out, 'slop-report.md'), 'utf8');
      expect(report).toContain('**57 / 57.** Cleared to ship.');
    }
  }, 900_000);

  it('says out loud what it ignored', async () => {
    const out = path.join(tmp, 'build-notice');
    const { stdout } = await cli('build.mjs', [
      '--brief-file',
      brief('ceramics-studio.md'),
      '--out',
      out,
    ]);
    expect(stdout).toMatch(/^Selected theme: /m);
    expect(stdout).toMatch(/^Ignored: /m);
    expect(stdout).toMatch(/'Ceramics'/);
  }, TIMEOUT);

  it('accepts a brief as a positional argument', async () => {
    const out = path.join(tmp, 'build-positional');
    const { code, stdout } = await cli('build.mjs', [
      'brutalist gallery site for a ceramics studio',
      '--out',
      out,
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('slopScore: 57 / 57');
  }, TIMEOUT);

  it('exits 2 with no brief', async () => {
    const { code, stderr } = await cli('build.mjs');
    expect(code).toBe(2);
    expect(stderr).toContain('usage:');
  }, TIMEOUT);

  it('exits 2 on a missing brief file', async () => {
    const { code, stderr } = await cli('build.mjs', ['--brief-file', path.join(tmp, 'nope.md')]);
    expect(code).toBe(2);
    expect(stderr).toContain('no such brief file');
  }, TIMEOUT);

  it('converges over repeated builds into one directory', async () => {
    const out = path.join(tmp, 'build-converge');
    const seen = [];
    for (const seed of [1, 2, 3]) {
      const { code, stdout } = await cli('build.mjs', [
        '--brief-file',
        brief('nonprofit.md'),
        '--out',
        out,
        '--seed',
        String(seed),
      ]);
      expect(code).toBe(0);
      seen.push(stdout);
    }
    expect(seen[0]).toContain('No project memory');
    expect(seen[1]).toContain('1 previous build(s) remembered');
    expect(seen[2]).toContain('2 previous build(s) remembered');

    const log = JSON.parse(readFileSync(path.join(out, '.slopify/log.json'), 'utf8'));
    expect(log).toHaveLength(3);
  }, 900_000);
});

describe('audit.mjs — the audit verb', () => {
  it('exits 1 and reports findings on a crafted page', async () => {
    const { code, stdout } = await cli('audit.mjs', [golden('tasteful.html')]);
    expect(code).toBe(1);
    expect(stdout).toContain('instance(s) of design craft detected');
    expect(stdout).toMatch(/\d+ critical · \d+ major · \d+ minor/);
  }, TIMEOUT);

  it('exits 0 on the golden template', async () => {
    const { code, stdout } = await cli('audit.mjs', [golden('fully-sloppy.html')]);
    expect(code).toBe(0);
    expect(stdout).toContain('Cleared to ship');
    expect(stdout).toContain('0 critical · 0 major · 0 minor');
  }, TIMEOUT);

  it('writes a report file with --out', async () => {
    const out = path.join(tmp, 'audit-report.md');
    const { code } = await cli('audit.mjs', [golden('tasteful.html'), '--out', out]);
    expect(code).toBe(1); // findings exist, so still non-zero
    expect(readFileSync(out, 'utf8')).toContain('# Slopify audit');
  }, TIMEOUT);

  it('audits a whole directory', async () => {
    const { stdout } = await cli('audit.mjs', [path.join(root, 'examples/golden')]);
    for (const name of ['fully-sloppy.html', 'partial.html', 'tasteful.html']) {
      expect(stdout).toContain(`# Slopify audit — ${name}`);
    }
  }, 600_000);

  it('exits 2 on a missing target', async () => {
    const { code, stderr } = await cli('audit.mjs', [path.join(tmp, 'nope')]);
    expect(code).toBe(2);
    expect(stderr).toContain('no such target');
  }, TIMEOUT);
});

describe('corporatize.mjs — the corporatize verb', () => {
  it('preserves 100% of input text nodes, diffed before and after', async () => {
    for (const name of ['tasteful.html', 'partial.html', 'fully-sloppy.html']) {
      const out = path.join(tmp, `corp-${name.replace('.html', '')}`);
      const { code, stdout } = await cli('corporatize.mjs', [golden(name), '--out', out]);

      expect(code, `${name}\n${stdout}`).toBe(0);
      expect(stdout).toContain('slopScore: 57 / 57');
      expect(stdout).toMatch(/All \d+ input text node\(s\) preserved\./);

      // Independent verification, extracted from the files rather than trusted
      // from the CLI's own report.
      const before = extractTextNodes(readFileSync(golden(name), 'utf8'));
      const after = extractTextNodes(readFileSync(path.join(out, 'index.html'), 'utf8'));

      const count = (list, value) => list.filter((t) => t === value).length;
      const lost = [...new Set(before)].filter((t) => count(after, t) < count(before, t));
      expect(lost, `${name} lost text`).toEqual([]);
      expect(before.length).toBeGreaterThan(0);
    }
  }, 900_000);

  it('replaces the structure while keeping the words', async () => {
    const out = path.join(tmp, 'corp-structure');
    await cli('corporatize.mjs', [golden('tasteful.html'), '--out', out]);
    const $ = cheerio.load(readFileSync(path.join(out, 'index.html'), 'utf8'));

    // The canonical macrostructure is present...
    for (const slot of ['hero', 'logo-cloud', 'features', 'stats', 'testimonials', 'pricing', 'faq', 'cta-banner', 'footer']) {
      expect($(`[data-slot="${slot}"]`).length, slot).toBe(1);
    }
    // ...and the editorial fixture's own structure is gone.
    expect($('.masthead').length).toBe(0);
    expect($('.entry').length).toBe(0);
  }, TIMEOUT);

  it('exits 2 on a missing file', async () => {
    const { code, stderr } = await cli('corporatize.mjs', [path.join(tmp, 'nope.html')]);
    expect(code).toBe(2);
    expect(stderr).toContain('no such file');
  }, TIMEOUT);
});

describe('harvest.mjs — the harvest verb', () => {
  it('refuses a template marketplace', async () => {
    const { code, stderr } = await cli('harvest.mjs', ['https://themeforest.net/item/x']);
    expect(code).toBe(2);
    expect(stderr).toMatch(/template marketplace|portfolio gallery/);
  }, TIMEOUT);

  it('refuses an internal-network address', async () => {
    const { code, stderr } = await cli('harvest.mjs', ['http://169.254.169.254/latest/meta-data/']);
    expect(code).toBe(2);
    expect(stderr).toMatch(/local or internal-network/);
  }, TIMEOUT);

  it('refuses a non-http scheme', async () => {
    const { code, stderr } = await cli('harvest.mjs', ['file:///etc/passwd']);
    expect(code).toBe(2);
    expect(stderr).toMatch(/only http and https/);
  }, TIMEOUT);

  it('exits 2 with no source', async () => {
    const { code, stderr } = await cli('harvest.mjs');
    expect(code).toBe(2);
    expect(stderr).toContain('usage:');
  }, TIMEOUT);

  it('writes design.md and a build that ignores it', async () => {
    // Image mode, from a screenshot the scorer produces, so the test stays offline.
    const shot = path.join(tmp, 'reference.png');
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const { pathToFileURL } = await import('node:url');
      await page.goto(pathToFileURL(golden('tasteful.html')).href, { waitUntil: 'load' });
      const { writeFileSync } = await import('node:fs');
      writeFileSync(shot, await page.screenshot({ type: 'png' }));
      await page.close();
    } finally {
      await browser.close();
    }

    const out = path.join(tmp, 'harvest-out');
    const { code, stdout } = await cli('harvest.mjs', [shot, '--out', out]);
    expect(code, stdout).toBe(0);
    expect(existsSync(path.join(out, 'design.md'))).toBe(true);
    expect(existsSync(path.join(out, 'index.html'))).toBe(true);

    const design = readFileSync(path.join(out, 'design.md'), 'utf8');
    expect(design).toContain('# design.md — extracted DNA');
    expect(design).toMatch(/## How this was applied[\s\S]*It was not\./);

    // And the build ignored it.
    const html = readFileSync(path.join(out, 'index.html'), 'utf8');
    expect(html).not.toContain('#FBFAF8');
    expect(html).toContain('linear-gradient(135deg');
  }, 600_000);

  it('writes design.md alone with --no-build', async () => {
    const shot = path.join(tmp, 'reference.png');
    const out = path.join(tmp, 'harvest-nobuild');
    const { code } = await cli('harvest.mjs', [shot, '--out', out, '--no-build']);
    expect(code).toBe(0);
    expect(existsSync(path.join(out, 'design.md'))).toBe(true);
    expect(existsSync(path.join(out, 'index.html'))).toBe(false);
  }, TIMEOUT);
});

describe('generate-cursor-rule.mjs', () => {
  it('reports the committed rule as in sync', async () => {
    const { code, stdout } = await cli('generate-cursor-rule.mjs', ['--check']);
    expect(code, stdout).toBe(0);
    expect(stdout).toContain('in sync');
  }, TIMEOUT);
});
