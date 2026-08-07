// The `slopify` verb (default).
//
// Brief in, maximally generic page out.
//
// Flow (Phase 9 wires the whole thing):
//   resolve theme -> apply memory nudge -> fill the macrostructure with
//   generated copy -> score -> auto-patch any unsatisfied gate -> write output
//   and slop-report.md
//
// This file currently carries the template-fill half only. It is here ahead of
// the rest because Phase 7's copy tests need a real page to score, and
// duplicating the fill logic in a test file would leave two implementations of
// the thing the build depends on.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

export const TEMPLATE_PATH = path.join(ROOT, 'templates/macrostructure.html');

/** The line in the template's <style> that the token block replaces. */
const TOKEN_MARKER = /\/\* SLOPIFY:TOKENS[\s\S]*?\*\//;

/** Read the macrostructure template. */
export function loadTemplate(templatePath = TEMPLATE_PATH) {
  return readFileSync(templatePath, 'utf8');
}

/**
 * Fill the macrostructure with copy and tokens.
 *
 * Copy goes into data-slot targets only; no slot fill ever changes structure,
 * which is what keeps the layout gates satisfied for any brief. Values
 * containing markup are set as HTML (the headline needs its <em>), everything
 * else as text, so a brief cannot inject tags by accident.
 *
 * @param {{template: string, tokensCss: string, copy: Record<string,string>, stamp?: string}} args
 * @returns {string} complete HTML document
 */
export function renderPage({ template, tokensCss, copy, stamp }) {
  if (!TOKEN_MARKER.test(template)) {
    throw new Error('template has no SLOPIFY:TOKENS marker to replace');
  }
  const withTokens = template.replace(TOKEN_MARKER, () =>
    stamp ? `${stamp}\n\n${tokensCss}` : tokensCss,
  );

  const $ = cheerio.load(withTokens);
  const missing = [];

  for (const [slot, value] of Object.entries(copy)) {
    const el = $(`[data-slot="${slot}"]`);
    if (el.length === 0) {
      missing.push(slot);
      continue;
    }
    // The hero headline wraps its text in the gradient span; fill the span so the
    // gradient treatment survives.
    const gradient = el.children('.grad');
    const target = gradient.length === 1 ? gradient : el;
    if (/[<>]/.test(String(value))) {
      target.html(String(value));
    } else {
      target.text(String(value));
    }
  }

  if (missing.length > 0) {
    throw new Error(`copy names slots the template does not have: ${missing.join(', ')}`);
  }
  return $.html();
}

/** Write a page and its discard log to a directory. */
export function writeOutput(dir, { html, discardLog: log }) {
  mkdirSync(dir, { recursive: true });
  const htmlPath = path.join(dir, 'index.html');
  writeFileSync(htmlPath, html, 'utf8');

  if (log) {
    mkdirSync(path.join(dir, '.slopify'), { recursive: true });
    writeFileSync(
      path.join(dir, '.slopify/discarded.json'),
      `${JSON.stringify(log, null, 2)}\n`,
      'utf8',
    );
  }
  return htmlPath;
}
