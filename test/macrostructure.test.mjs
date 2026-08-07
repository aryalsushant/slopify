import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { parseTokens, resolveTheme, tokensToCss } from '../scripts/themes.mjs';
import { CANONICAL_SECTIONS, scoreHtml, failingGates } from '../scripts/score.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'templates/macrostructure.html'), 'utf8');
const $ = cheerio.load(html);

/** Every data-slot in the template, in document order. */
const slotsInOrder = $('[data-slot]')
  .toArray()
  .map((el) => $(el).attr('data-slot'));

/**
 * The slot contract, in required top-to-bottom order.
 *
 * Order is load-bearing, not cosmetic: SLOP-037 asserts the canonical section
 * sequence and SLOP-022 asserts the logo cloud directly follows the hero, so a
 * reordered template silently fails the layout gates at build time. Pinning the
 * order here catches it at test time instead.
 */
const REQUIRED_SLOTS = [
  'page-title',
  'font-link',

  'nav',
  'wordmark',
  'nav-link-1',
  'nav-link-2',
  'nav-link-3',
  'nav-link-4',
  'nav-cta',

  'hero',
  'hero-eyebrow',
  'hero-headline',
  'hero-subhead',
  'hero-cta-primary',
  'hero-cta-secondary',
  'hero-reassurance',

  'logo-cloud',
  'logo-cloud-label',
  'logo-1',
  'logo-2',
  'logo-3',
  'logo-4',
  'logo-5',
  'logo-6',

  'features',
  'features-title',
  'features-lede',
  'feature-1-title',
  'feature-1-body',
  'feature-2-title',
  'feature-2-body',
  'feature-3-title',
  'feature-3-body',

  'stats',
  'stat-1-value',
  'stat-1-label',
  'stat-2-value',
  'stat-2-label',
  'stat-3-value',
  'stat-3-label',
  'stat-4-value',
  'stat-4-label',

  'testimonials',
  'testimonials-title',
  'testimonial-1-quote',
  'testimonial-1-attribution',
  'testimonial-2-quote',
  'testimonial-2-attribution',
  'testimonial-3-quote',
  'testimonial-3-attribution',

  'pricing',
  'pricing-title',
  'tier-1-name',
  'tier-1-price',
  'tier-1-period',
  'tier-1-feature-1',
  'tier-1-feature-2',
  'tier-1-feature-3',
  'tier-1-cta',
  'tier-2-name',
  'tier-2-price',
  'tier-2-period',
  'tier-2-feature-1',
  'tier-2-feature-2',
  'tier-2-feature-3',
  'tier-2-cta',
  'tier-3-name',
  'tier-3-price',
  'tier-3-period',
  'tier-3-feature-1',
  'tier-3-feature-2',
  'tier-3-feature-3',
  'tier-3-cta',

  'faq',
  'faq-title',
  'faq-1-question',
  'faq-1-answer',
  'faq-2-question',
  'faq-2-answer',
  'faq-3-question',
  'faq-3-answer',
  'faq-4-question',
  'faq-4-answer',
  'faq-5-question',
  'faq-5-answer',

  'cta-banner',
  'cta-banner-headline',
  'cta-banner-subhead',
  'cta-banner-cta',

  'footer',
  'footer-col-1-title',
  'footer-col-2-title',
  'footer-col-3-title',
  'footer-col-4-title',
  'footer-legal',
];

describe('macrostructure — slot contract', () => {
  it('carries every required slot exactly once', () => {
    const counts = new Map();
    for (const slot of slotsInOrder) counts.set(slot, (counts.get(slot) ?? 0) + 1);
    for (const slot of REQUIRED_SLOTS) {
      expect(counts.get(slot), `slot "${slot}"`).toBe(1);
    }
  });

  it('carries no slots beyond the contract', () => {
    const extra = [...new Set(slotsInOrder)].filter((s) => !REQUIRED_SLOTS.includes(s));
    expect(extra).toEqual([]);
  });

  it('places every slot in the required top-to-bottom order', () => {
    expect(slotsInOrder).toEqual(REQUIRED_SLOTS);
  });
});

describe('macrostructure — section order the layout gates depend on', () => {
  it('lays out sections in the canonical sequence SLOP-037 asserts', () => {
    const wanted = new Set(CANONICAL_SECTIONS);
    const seen = slotsInOrder.filter((s) => wanted.has(s));
    expect(seen).toEqual(CANONICAL_SECTIONS);
  });

  it('puts the logo cloud directly after the hero, as SLOP-022 requires', () => {
    const cloud = $('[data-slot="logo-cloud"]');
    expect(cloud.prevAll('[data-slot]').first().attr('data-slot')).toBe('hero');
  });

  it('puts the CTA banner between the FAQ and the footer, as SLOP-034 requires', () => {
    const at = (slot) => slotsInOrder.indexOf(slot);
    expect(at('faq')).toBeLessThan(at('cta-banner'));
    expect(at('cta-banner')).toBeLessThan(at('footer'));
  });

  it('gives every top-level section a reveal hook, as SLOP-039 requires', () => {
    const sections = $('main > section').toArray();
    expect(sections.length).toBeGreaterThan(0);
    for (const s of sections) {
      expect($(s).attr('data-reveal'), $(s).attr('data-slot')).toBeDefined();
    }
  });
});

describe('macrostructure — structural fixtures the gates count', () => {
  it('has three structurally identical feature cards', () => {
    const signature = (el) =>
      $(el)
        .find('*')
        .toArray()
        .map((d) => `${d.tagName}.${($(d).attr('class') ?? '').split(/\s+/).sort().join('.')}`)
        .join('>');
    const sigs = $('.feature').toArray().map(signature);
    expect(sigs).toHaveLength(3);
    expect(new Set(sigs).size).toBe(1);
  });

  it('has three pricing tiers with the badge on the middle one only', () => {
    const tiers = $('.tier').toArray();
    expect(tiers).toHaveLength(3);
    expect($(tiers[0]).hasClass('tier--popular')).toBe(false);
    expect($(tiers[1]).hasClass('tier--popular')).toBe(true);
    expect($(tiers[2]).hasClass('tier--popular')).toBe(false);
    expect($(tiers[1]).find('.tier__badge').text().trim()).toBe('Most Popular');
  });

  it('has four footer columns titled Product / Company / Resources / Legal', () => {
    const titles = $('.footer__col-title')
      .toArray()
      .map((el) => $(el).text().trim());
    expect(titles).toEqual(['Product', 'Company', 'Resources', 'Legal']);
  });

  it('has a four-item stats bar and a five-item accordion', () => {
    expect($('.stat')).toHaveLength(4);
    expect($('[data-slot="faq"] details')).toHaveLength(5);
    expect($('[data-slot="faq"] details > summary')).toHaveLength(5);
  });

  it('has a dot-navigated testimonial carousel', () => {
    expect($('.carousel[data-carousel]')).toHaveLength(1);
    expect($('.carousel__dots button')).toHaveLength(3);
  });

  it('has two blob decorations in the hero', () => {
    expect($('.hero .blob')).toHaveLength(2);
  });
});

describe('macrostructure — token discipline', () => {
  const style = $('style').text();
  const tokens = parseTokens();

  it('reserves the marker line build.mjs replaces with the :root block', () => {
    expect(style).toMatch(/SLOPIFY:TOKENS/);
    // The template must not ship its own :root, or the build would emit two.
    expect(style).not.toMatch(/:root\s*\{/);
  });

  it('inlines no colour value anywhere in the stylesheet', () => {
    // Every colour must come through a token. rgba() shadows are the one
    // exception the template allows, and they are checked separately below.
    const withoutShadows = style.replace(/box-shadow:[^;]+;/g, '');
    const hexes = withoutShadows.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexes).toEqual([]);
  });

  it('declares font-family only through the token', () => {
    const families = style.match(/font-family\s*:\s*([^;}]+)/g) ?? [];
    expect(families.length).toBeGreaterThan(0);
    for (const decl of families) {
      expect(decl).toMatch(/var\(--font\)/);
    }
  });

  it('references only tokens that exist in tokens.css', () => {
    const referenced = new Set(
      [...style.matchAll(/var\(\s*--([\w-]+)/g)].map((m) => m[1]),
    );
    const missing = [...referenced].filter((name) => !(name in tokens));
    expect(missing).toEqual([]);
  });

  it('loads the same font URL tokens.css records', () => {
    // The <link> href is a literal because it never varies across themes, so it
    // could drift from --font-url without anything noticing.
    expect($('[data-slot="font-link"]').attr('href')).toBe(tokens['font-url']);
  });

  it('ships no prefers-reduced-motion block, as SLOP-045 requires', () => {
    expect(style).not.toMatch(/prefers-reduced-motion/);
  });
});

describe('macrostructure — scored with tokens injected', () => {
  // The template plus tokens, with its placeholder copy left in place. Proves
  // the skeleton alone satisfies every structural gate, so anything still
  // failing is a copy problem for Phase 7 rather than a layout one.
  //
  // Phase 9's build.mjs owns this substitution for real; here it is two lines so
  // the assertion does not have to wait on the build orchestrator.
  // Not in examples/golden/: vitest runs test files in parallel and the audit
  // verb's directory-listing test enumerates that directory, so a scratch .html
  // there makes an unrelated test flaky depending on scheduling.
  const scratch = path.join(root, 'test/.tmp-macrostructure');
  const filled = path.join(scratch, 'filled.html');
  let browser;
  let report;

  beforeAll(async () => {
    const tokens = tokensToCss(resolveTheme('Bellhouse Drift', { announce: false }));
    mkdirSync(scratch, { recursive: true });
    writeFileSync(filled, html.replace(/\/\* SLOPIFY:TOKENS[\s\S]*?\*\//, tokens));
    browser = await chromium.launch();
    report = await scoreHtml(filled, { browser });
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  it('satisfies every gate that is not purely about copy', () => {
    // All six remaining failures are text-content gates the copy generator
    // fills: the italicised emphasis word, the headline template, the
    // frictionless adverb, the fabricated metric, the risk-reversal line, and
    // the FAQ voice. No typography, color, layout, motion, or self-sabotage gate
    // fails on the skeleton alone.
    expect(failingGates(report)).toEqual([
      'SLOP-009',
      'SLOP-046',
      'SLOP-047',
      'SLOP-048',
      'SLOP-054',
      'SLOP-055',
    ]);
  });

  it('leaves no structural category unsatisfied', () => {
    const failedCategories = new Set(
      report.results.filter((r) => !r.passed).map((r) => r.category),
    );
    expect([...failedCategories].sort()).toEqual(['copy', 'typography']);
    // The single typography failure is SLOP-009, which is a copy concern too —
    // it needs an <em> inside the headline text.
    const typographyFailures = report.results.filter(
      (r) => !r.passed && r.category === 'typography',
    );
    expect(typographyFailures.map((r) => r.gateId)).toEqual(['SLOP-009']);
  });

  it('passes the self-sabotage gate against the golden template', () => {
    // The skeleton is the golden template's structure, so SLOP-057 should be
    // satisfied before a single word of copy is injected.
    const meta = report.results.find((r) => r.gateId === 'SLOP-057');
    expect(meta.passed).toBe(true);
  });
});
