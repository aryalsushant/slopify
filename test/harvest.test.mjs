import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  harvest,
  classifySource,
  assertPublicHttpUrl,
  extractDnaFromPage,
  extractDnaFromImage,
  renderDesignMd,
  VIEWPORT,
} from '../scripts/harvest.mjs';
import { classifyGradient } from '../scripts/score.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, 'test/.tmp-harvest');
const golden = (name) => path.join(root, 'examples/golden', name);

let browser;
beforeAll(async () => {
  browser = await chromium.launch();
  mkdirSync(tmp, { recursive: true });
}, 120_000);
afterAll(async () => {
  await browser?.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('harvest — safety rails', () => {
  // Kept from Hallmark rather than inverted (docs/inversion-map.md § 8). The joke
  // is that the page looks generated, not that the tool is reckless.

  it('routes a URL to url mode and anything else to image mode', () => {
    expect(classifySource('https://example.com')).toBe('url');
    expect(classifySource('http://example.com')).toBe('url');
    expect(classifySource('./shot.png')).toBe('image');
    expect(classifySource('/var/tmp/hero.png')).toBe('image');
    expect(classifySource('C:\\shots\\hero.png')).toBe('image');
  });

  it('routes any scheme through the URL guard, not just http', () => {
    // Regression: `file:///etc/passwd` used to classify as an image path, skip
    // assertPublicHttpUrl entirely, and come back as "no such image" — refused,
    // but for the wrong reason and without the scheme check ever running.
    for (const source of ['file:///etc/passwd', 'ftp://example.com/x', 'gopher://old.example']) {
      expect(classifySource(source), source).toBe('url');
      expect(() => assertPublicHttpUrl(source), source).toThrow(/only http and https/);
    }
  });

  it.each([
    'https://themeforest.net/item/thing',
    'https://elements.envato.com/x',
    'https://www.framer.com/templates/y',
    'https://webflow.com/templates/z',
    'https://dribbble.com/shots/123',
    'https://www.behance.net/gallery/1',
  ])('refuses %s', (url) => {
    expect(() => assertPublicHttpUrl(url)).toThrow(/template marketplace|portfolio gallery/);
  });

  it.each([
    'http://localhost:3000',
    'http://127.0.0.1/',
    'http://192.168.1.1/',
    'http://10.0.0.5/admin',
    'http://172.20.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://printer.local/',
  ])('refuses the internal address %s', (url) => {
    expect(() => assertPublicHttpUrl(url)).toThrow(/local or internal-network/);
  });

  it('refuses a non-http scheme', () => {
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow(/only http and https/);
    expect(() => assertPublicHttpUrl('ftp://example.com')).toThrow(/only http and https/);
  });

  it('allows an ordinary public page', () => {
    expect(() => assertPublicHttpUrl('https://example.com/about')).not.toThrow();
  });
});

describe('harvest — extraction is genuinely accurate', () => {
  // The verb only works as a parody if the analysis is correct, so these assert
  // extracted facts against what the fixture actually declares.
  let dna;

  beforeAll(async () => {
    const page = await browser.newPage({ viewport: VIEWPORT });
    try {
      await page.goto(pathToFileURL(golden('tasteful.html')).href, { waitUntil: 'load' });
      dna = await extractDnaFromPage(page);
    } finally {
      await page.close();
    }
  }, 120_000);

  it('names the webfonts the page actually loads', () => {
    expect(dna.loadedFonts.sort()).toEqual(['Fraunces', 'Source Serif 4']);
  });

  it('identifies the display/body pairing correctly', () => {
    expect(dna.h1.family).toBe('Fraunces');
    expect(dna.body.family).toBe('Source Serif 4');
  });

  it('measures the type scale rather than guessing it', () => {
    expect(dna.body.size).toBe('17px');
    expect(dna.body.weight).toBe('400');
    expect(dna.h1.weight).toBe('600');
    // The fixture sets display leading to 0.98.
    expect(parseFloat(dna.h1.lineHeight) / parseFloat(dna.h1.size)).toBeCloseTo(0.98, 2);
  });

  it('reads the warm paper and ink, not a rounded guess', () => {
    expect(dna.palette.paper.hex).toBe('#FBFAF8');
    expect(dna.palette.ink.hex).toBe('#1A1714');
    expect(dna.palette.paper.oklch).toMatch(/^oklch\(/);
  });

  it('finds the accent even though it is only ever a text colour', () => {
    // The ochre is never painted on a surface. An accent check that only looked at
    // background-color reported "none" for a page with a perfectly clear accent.
    expect(dna.palette.accent.hex).toBe('#8A5A2B');
  });

  it('computes real contrast', () => {
    expect(dna.palette.contrast).toBeGreaterThan(15);
  });

  it('reports the absence of gradients and radii truthfully', () => {
    expect(dna.gradients).toEqual([]);
    expect(dna.radii).toEqual([]);
  });

  it('notices the reduced-motion fallback the fixture ships', () => {
    expect(dna.prefersReducedMotion).toBe(true);
  });

  it('measures section rhythm', () => {
    expect(dna.sections.length).toBeGreaterThan(3);
    for (const section of dna.sections) {
      expect(section.height).toBeGreaterThan(40);
    }
  });

  it('writes a design.md that carries the measured facts', () => {
    const md = renderDesignMd(dna, 'tasteful.html');
    expect(md).toContain('Fraunces');
    expect(md).toContain('Source Serif 4');
    expect(md).toContain('#FBFAF8');
    expect(md).toContain('#8A5A2B');
    expect(md).toMatch(/Limits of URL mode/);
  });
});

describe('harvest — the DNA is then ignored', () => {
  let result;

  beforeAll(async () => {
    // Image mode, so the test needs no network: screenshot the editorial fixture,
    // then harvest the screenshot.
    const shot = path.join(tmp, 'reference.png');
    const page = await browser.newPage({ viewport: VIEWPORT });
    try {
      await page.goto(pathToFileURL(golden('tasteful.html')).href, { waitUntil: 'load' });
      writeFileSync(shot, await page.screenshot({ type: 'png' }));
    } finally {
      await page.close();
    }
    result = await harvest(shot, {
      outDir: path.join(tmp, 'harvested'),
      seed: 3,
      browser,
      quiet: true,
    });
  }, 600_000);

  it('extracts a real palette from a screenshot', () => {
    expect(result.mode).toBe('image');
    expect(result.dna.dominant.length).toBeGreaterThan(1);
    expect(result.dna.dominant[0].share).toMatch(/%$/);
    expect(result.dna.palette.paper.hex).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('says plainly what image mode cannot know', () => {
    const md = readFileSync(result.designMdPath, 'utf8');
    expect(md).toMatch(/Limits of image mode/);
    expect(md).toMatch(/Typography cannot be identified from pixels/);
    expect(md).toMatch(/Motion is invisible in a still/);
    // And makes no typography claim at all in this mode.
    expect(md).not.toMatch(/Display face/);
  });

  it('records that the DNA was not applied', () => {
    const md = readFileSync(result.designMdPath, 'utf8');
    expect(md).toMatch(/## How this was applied/);
    expect(md).toMatch(/It was not\./);
  });

  it('builds a page that scores 57/57 regardless', () => {
    expect(result.build.report.slopScore).toBe(57);
  });

  it('builds with the canonical tokens, not the harvested ones', () => {
    // The reference is a warm off-white editorial page with an ochre accent and no
    // gradients. The build has to come out violet.
    const { html } = result.build;
    expect(html).not.toContain('#FBFAF8');
    expect(html).not.toContain('#8A5A2B');
    const gradient = html.match(/--accent-gradient:\s*([^;]+);/)?.[1];
    expect(classifyGradient(gradient)?.name).toBe('purple → pink');
    expect(html).toContain('Inter');
  });

  it('refuses an image that does not exist', async () => {
    await expect(
      harvest(path.join(tmp, 'nope.png'), {
        outDir: path.join(tmp, 'x'),
        browser,
        quiet: true,
      }),
    ).rejects.toThrow(/no such image/);
  });
});

describe('extractDnaFromImage', () => {
  it('reports shares that sum to no more than 100%', async () => {
    const shot = path.join(tmp, 'shares.png');
    const page = await browser.newPage({ viewport: VIEWPORT });
    try {
      await page.goto(pathToFileURL(golden('fully-sloppy.html')).href, { waitUntil: 'load' });
      writeFileSync(shot, await page.screenshot({ type: 'png' }));
    } finally {
      await page.close();
    }
    const dna = extractDnaFromImage(shot);
    const total = dna.dominant.reduce((s, d) => s + parseFloat(d.share), 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(100.5);
  }, 300_000);
});
