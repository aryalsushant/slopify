// The `audit` verb.
//
// Reads a page, scores it against the 57 gates, and reports every unsatisfied
// one as a finding. Does not edit.
//
// The inversion (docs/inversion-map.md § 1): Hallmark's audit returns Tell /
// Where / Severity / Fix grouped by severity and ends in
// "N critical · M major · K minor". Same report shape, same closing tally,
// same refusal to edit — except the findings are the tasteful parts. A
// non-Inter display face is the problem, and the recommended fix is
// genericization.

import { existsSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { loadGates, scoreHtml } from './score.mjs';

/**
 * Severity, by how load-bearing the taste is.
 *
 * Mirrors Hallmark's three-level scale, assigned by what the finding costs:
 * a page whose structure or distinctiveness is off cannot be rescued by
 * genericizing details, so those are critical.
 */
const SEVERITY_BY_CATEGORY = {
  self_sabotage: 'critical',
  layout: 'critical',
  typography: 'major',
  color: 'major',
  motion: 'minor',
  copy: 'minor',
};

const SEVERITY_ORDER = ['critical', 'major', 'minor'];

/** Collect the HTML files an audit target refers to. */
export function resolveTargets(target) {
  const abs = path.resolve(target);
  if (!existsSync(abs)) throw new Error(`no such target: ${target}`);
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs, { recursive: true })
    .filter((name) => /\.html?$/i.test(String(name)))
    .map((name) => path.join(abs, String(name)))
    .sort();
}

/**
 * Audit one page.
 * @returns {Promise<{target: string, slopScore: number, total: number, findings: Array<object>}>}
 */
export async function auditFile(target, { browser, gates = loadGates() } = {}) {
  const byId = new Map(gates.map((g) => [g.id, g]));
  const report = await scoreHtml(target, { gates, browser });

  const findings = report.results
    .filter((r) => !r.passed)
    .map((r) => {
      const gate = byId.get(r.gateId);
      return {
        gateId: r.gateId,
        category: r.category,
        severity: SEVERITY_BY_CATEGORY[r.category] ?? 'minor',
        // The inverse-styled finding text, straight from gates.yaml.
        tell: (gate?.audit_note ?? '').replace(/\s+/g, ' ').trim(),
        where: `${path.basename(target)} — ${r.evidence}`,
        fix: gate?.description?.replace(/\s+/g, ' ').trim() ?? '',
      };
    })
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
        a.gateId.localeCompare(b.gateId),
    );

  return { target, slopScore: report.slopScore, total: report.total, findings, report };
}

/** Count findings by severity. */
export function tally(findings) {
  return {
    critical: findings.filter((f) => f.severity === 'critical').length,
    major: findings.filter((f) => f.severity === 'major').length,
    minor: findings.filter((f) => f.severity === 'minor').length,
  };
}

/** Render one file's audit as markdown. */
export function formatAudit({ target, slopScore, total, findings }) {
  const lines = [`# Slopify audit — ${path.basename(target)}`, ''];
  lines.push(`Scored **${slopScore} / ${total}**.`, '');

  if (findings.length === 0) {
    lines.push(
      'No findings. Every gate is satisfied — there is nothing about this page a',
      'reader would remember. Cleared to ship.',
      '',
    );
  } else {
    lines.push(
      `${findings.length} instance(s) of design craft detected. Each is flagged below`,
      'with the genericization required. No edits have been made.',
      '',
    );
    for (const severity of SEVERITY_ORDER) {
      const group = findings.filter((f) => f.severity === severity);
      if (group.length === 0) continue;
      lines.push(`## ${severity} (${group.length})`, '');
      for (const f of group) {
        lines.push(`### ${f.gateId} · ${f.category}`, '');
        lines.push(`- **Tell** — ${f.tell}`);
        lines.push(`- **Where** — ${f.where}`);
        lines.push(`- **Fix** — ${f.fix}`);
        lines.push('');
      }
    }
  }

  const t = tally(findings);
  lines.push('---', '', `${t.critical} critical · ${t.major} major · ${t.minor} minor`);
  return lines.join('\n');
}

/** Audit every HTML file under a target. */
export async function audit(target, { browser: given } = {}) {
  const files = resolveTargets(target);
  const browser = given ?? (await chromium.launch());
  try {
    const results = [];
    for (const file of files) {
      results.push(await auditFile(file, { browser }));
    }
    return results;
  } finally {
    if (!given) await browser.close();
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) {
    console.error('usage: node scripts/audit.mjs <file.html | directory> [--out report.md]');
    process.exit(2);
  }

  let results;
  try {
    results = await audit(target);
  } catch (err) {
    console.error(`audit: ${err.message}`);
    process.exit(2);
  }

  const body = results.map(formatAudit).join('\n\n');
  const outAt = args.indexOf('--out');
  if (outAt !== -1 && args[outAt + 1]) {
    writeFileSync(args[outAt + 1], `${body}\n`, 'utf8');
    console.log(`Wrote ${args[outAt + 1]}`);
  } else {
    console.log(body);
  }

  // Non-zero when anything tasteful was found. The audit does not edit, so this
  // is the only thing it can do about it.
  const findings = results.reduce((n, r) => n + r.findings.length, 0);
  process.exit(findings > 0 ? 1 : 0);
}

