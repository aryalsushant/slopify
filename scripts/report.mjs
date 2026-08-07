// slop-report.md generator.
//
// The inversion of Hallmark's audit report (docs/inversion-map.md § 6). Hallmark
// returns a ranked punch list: each finding is a tell, a location, a severity, and
// a fix, and the report exists to tell you what to change. This lists all 57 gates
// with a one-line note per satisfied one, and exists to tell you that nothing
// needs changing.
//
// Celebratory, not corrective. A gate that did NOT pass is the only bad news in
// the file, and it is reported in the same inverse register `audit` uses: the
// unsatisfied gate means part of the page is too good.

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadGates } from './score.mjs';

const CATEGORY_ORDER = ['typography', 'color', 'layout', 'motion', 'copy', 'self_sabotage'];

const CATEGORY_BLURB = {
  typography: 'One family, doing both jobs.',
  color: 'One gradient, everywhere it will fit.',
  layout: 'The canonical shape, section for section.',
  motion: 'Everything animates, unconditionally.',
  copy: 'Written for no one in particular.',
  self_sabotage: 'Checked against the golden template, last.',
};

/**
 * Render slop-report.md.
 *
 * @param {{slopScore: number, total: number, manual: number, results: Array<object>}} report
 * @param {{target?: string, themeName?: string, seed?: number,
 *          discardedCount?: number, convergence?: {factor: number, historyLength: number},
 *          gates?: Array<object>}} [meta]
 */
export function renderReport(report, meta = {}) {
  const gates = meta.gates ?? loadGates();
  const byId = new Map(gates.map((g) => [g.id, g]));
  const shipped = report.slopScore === report.total;

  const lines = ['# Slop report', ''];
  lines.push(`**${report.slopScore} / ${report.total}.** ${shipped ? 'Cleared to ship.' : 'Blocked.'}`, '');

  if (shipped) {
    lines.push(
      'Every gate satisfied. There is nothing about this page a reader will',
      'remember, and nothing in it that could not have been produced for any other',
      'brief. Exactly as specified.',
      '',
    );
  } else {
    const short = report.total - report.slopScore;
    lines.push(
      `${short} gate(s) unsatisfied. Each one marks a part of the page that came out`,
      'better than it should have. They are listed at the end.',
      '',
    );
  }

  // Build metadata, mirroring the fields Hallmark stamps into its CSS.
  const facts = [];
  if (meta.target) facts.push(`- **Page** · \`${meta.target}\``);
  if (meta.themeName) facts.push(`- **Theme** · ${meta.themeName} (light / geometric-sans / violet → pink)`);
  if (meta.seed !== undefined) facts.push(`- **Seed** · ${meta.seed}`);
  if (meta.discardedCount !== undefined) {
    facts.push(`- **Discarded from brief** · ${meta.discardedCount} term(s)`);
  }
  if (meta.convergence) {
    facts.push(
      `- **Convergence** · ${meta.convergence.historyLength} remembered build(s), palette pulled ${(meta.convergence.factor * 100).toFixed(0)}% toward their average`,
    );
  }
  if (facts.length > 0) lines.push('## Build', '', ...facts, '');

  for (const category of CATEGORY_ORDER) {
    const rows = report.results.filter((r) => r.category === category);
    if (rows.length === 0) continue;
    const passed = rows.filter((r) => r.passed).length;
    lines.push(`## ${category} — ${passed}/${rows.length}`, '');
    if (CATEGORY_BLURB[category]) lines.push(`_${CATEGORY_BLURB[category]}_`, '');
    for (const row of rows) {
      const gate = byId.get(row.gateId);
      if (row.passed) {
        const note = (gate?.celebration ?? '').replace(/\s+/g, ' ').trim();
        lines.push(`- **${row.gateId}** — ${note}`);
      } else {
        const note = (gate?.audit_note ?? '').replace(/\s+/g, ' ').trim();
        lines.push(`- **${row.gateId}** — NOT SATISFIED. ${note}`);
      }
    }
    lines.push('');
  }

  const unsatisfied = report.results.filter((r) => !r.passed);
  if (unsatisfied.length > 0) {
    lines.push('## Unsatisfied', '');
    for (const row of unsatisfied) {
      lines.push(`- **${row.gateId}** (${row.category}) — ${row.evidence}`);
    }
    lines.push('');
  }

  lines.push('---', '');
  if (report.manual > 0) {
    lines.push(
      `${report.manual} of the ${report.total} gates are manual and were recorded as`,
      'satisfied rather than adjudicated. They are judgment calls about whether the',
      'fold is memorable and whether the subhead adds information; neither is',
      'machine-checkable, and neither is claimed to be.',
      '',
    );
  }
  lines.push(
    shipped
      ? 'No action required.'
      : 'Ship is blocked until every gate is satisfied. One failure blocks ship.',
  );

  return `${lines.join('\n')}\n`;
}

/** Write slop-report.md into a build directory. */
export function writeReport(dir, markdown, filename = 'slop-report.md') {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, filename);
  writeFileSync(file, markdown, 'utf8');
  return file;
}
