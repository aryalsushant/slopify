// The `harvest` verb.
//
// Input: a URL or a local screenshot. Output: a `design.md` recording the
// reference's actual design DNA, and a page built from the same source that
// ignores every line of it.
//
// The inversion (docs/inversion-map.md § 1): Hallmark's `study` extracts DNA
// from a reference, emits a diagnosis, and then builds the user's content USING
// that DNA. Same extraction, same report, same two-mode split between a live URL
// and a screenshot — and then the DNA is filed and disregarded.
//
// The extraction is deliberately real. Fonts, colour values, type scale, radii,
// motion timings, and section rhythm are read out of the live page's computed
// styles, not guessed, and image mode says plainly what it cannot know. A
// `design.md` full of vague assertions would make the verb pointless: the whole
// joke is that the analysis was correct and got thrown away anyway.
//
// Hallmark's safety rails are kept rather than inverted, per inversion-map § 8.
// Template-marketplace URLs are refused, non-public and internal-network targets
// are refused, and fetched markup is treated as inert data — design facts are
// read out of it and nothing in it is followed as an instruction.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { parse as parseColor, converter, wcagContrast } from 'culori';
import pngjs from 'pngjs';
import { build } from './build.mjs';

const { PNG } = pngjs;
const toOklch = converter('oklch');

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

/** Fixed viewport, matching the scorer so measurements are comparable. */
export const VIEWPORT = { width: 1280, height: 800 };

/**
 * Hosts whose designs are not the user's to extract. Hallmark's study verb
 * refuses the same list; there is no reason for the parody to be laxer.
 */
const REFUSED_HOSTS = [
  'themeforest.net',
  'elements.envato.com',
  'framer.com',
  'webflow.com',
  'gumroad.com',
  'dribbble.com',
  'behance.net',
  'templatemonster.com',
  'creativemarket.com',
];

/**
 * Source mode. A URL routes to URL mode; anything else is an image path.
 *
 * Any `scheme://` prefix counts as a URL attempt, not just http and https. An
 * earlier version matched only `^https?://`, which meant `file:///etc/passwd` was
 * classified as an image path, skipped the URL guard entirely, and came back as
 * "no such image" — refused, but for the wrong reason and without the scheme
 * check ever running. Routing every scheme through assertPublicHttpUrl is what
 * makes the refusal deliberate rather than incidental.
 *
 * Windows drive letters (`C:\shots\hero.png`) are not schemes and stay in image
 * mode.
 */
export function classifySource(source) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(String(source).trim()) ? 'url' : 'image';
}

/**
 * Refuse anything that is not a public web page.
 *
 * Kept from Hallmark unchanged: a design skill that will fetch
 * http://192.168.1.1/ on request is a different and worse problem than one that
 * makes ugly pages.
 */
export function assertPublicHttpUrl(source) {
  let url;
  try {
    url = new URL(source);
  } catch {
    throw new Error(`not a URL: ${source}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`refused: only http and https are fetched, not ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase();
  if (REFUSED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new Error(
      `refused: ${host} is a template marketplace or portfolio gallery. Those designs are not yours to extract.`,
    );
  }

  const isLoopback = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(host);
  const isPrivate =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal');
  if (isLoopback || isPrivate) {
    throw new Error(`refused: ${host} is a local or internal-network address.`);
  }
  return url;
}

// ── extraction ───────────────────────────────────────────────────────────────

const hex = (value) => {
  const parsed = parseColor(String(value ?? ''));
  if (!parsed) return null;
  const to255 = (c) => Math.round(Math.min(1, Math.max(0, c ?? 0)) * 255);
  return `#${[to255(parsed.r), to255(parsed.g), to255(parsed.b)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
};

const okString = (value) => {
  const parsed = parseColor(String(value ?? ''));
  if (!parsed) return null;
  const c = toOklch(parsed);
  return `oklch(${((c.l ?? 0) * 100).toFixed(1)}% ${(c.c ?? 0).toFixed(3)} ${(c.h ?? 0).toFixed(0)})`;
};

/**
 * Read a page's design DNA out of its computed styles.
 *
 * Everything here is measured. Where a fact cannot be measured it is reported as
 * unknown rather than inferred.
 */
export async function extractDnaFromPage(page) {
  const raw = await page.evaluate(() => {
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const body = document.body;
    const h1 = document.querySelector('h1');
    const h2 = document.querySelector('h2');
    const p = document.querySelector('p');

    const firstFamily = (stack) =>
      (stack ?? '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');

    // Webfont families the document actually loaded.
    const loaded = new Set();
    try {
      document.fonts.forEach((f) => loaded.add(f.family.replace(/^['"]|['"]$/g, '')));
    } catch {
      /* FontFaceSet unavailable */
    }

    const stylesheetHrefs = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .map((l) => l.getAttribute('href'))
      .filter(Boolean);

    // Distinct radii and transition timings, by frequency.
    const tally = (values) => {
      const counts = new Map();
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    };
    const all = [...document.querySelectorAll('*')];
    const radii = tally(
      all.map((el) => getComputedStyle(el).borderRadius).filter((r) => r && r !== '0px'),
    );
    const durations = tally(
      all
        .map((el) => getComputedStyle(el).transitionDuration)
        .filter((d) => d && d !== '0s'),
    );
    const animations = tally(
      all.map((el) => getComputedStyle(el).animationName).filter((a) => a && a !== 'none'),
    );

    // Chromatic backgrounds, most frequent first — the accent candidates.
    const backgrounds = tally(
      all
        .map((el) => getComputedStyle(el).backgroundColor)
        .filter((c) => c && c !== 'rgba(0, 0, 0, 0)'),
    );
    const gradients = tally(
      all
        .map((el) => getComputedStyle(el).backgroundImage)
        .filter((i) => i && i !== 'none' && i.includes('gradient')),
    );
    // Accent is often carried by type or a rule rather than a filled surface —
    // editorial pages in particular never paint a block with it. Text and border
    // colours are collected too, or the extraction would report "no accent" for a
    // page with a perfectly clear one.
    const inkColour = getComputedStyle(document.body).color;
    const textColours = tally(
      all.map((el) => getComputedStyle(el).color).filter((c) => c && c !== inkColour),
    );
    const borderColours = tally(
      all
        .filter((el) => parseFloat(getComputedStyle(el).borderTopWidth) > 0)
        .map((el) => getComputedStyle(el).borderTopColor)
        .filter(Boolean),
    );

    // Section rhythm: the top-level blocks and how tall each one is.
    const sectionScope = document.querySelector('main') ?? document.body;
    const sections = [...sectionScope.children]
      .filter((el) => el.getBoundingClientRect().height > 40)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        className: el.getAttribute('class') ?? '',
        height: Math.round(el.getBoundingClientRect().height),
        background: getComputedStyle(el).backgroundColor,
      }));

    const measureWidth = () => {
      const candidates = [...document.querySelectorAll('main, main > *, .container, .wrap, .shell')];
      const widths = candidates
        .map((el) => Math.round(el.getBoundingClientRect().width))
        .filter((w) => w > 0);
      return widths.length ? Math.max(...widths) : null;
    };

    const typeOf = (el) => {
      const s = cs(el);
      if (!s) return null;
      return {
        family: firstFamily(s.fontFamily),
        stack: s.fontFamily,
        size: s.fontSize,
        weight: s.fontWeight,
        lineHeight: s.lineHeight,
        letterSpacing: s.letterSpacing,
        style: s.fontStyle,
        transform: s.textTransform,
      };
    };

    return {
      title: document.title || null,
      loadedFonts: [...loaded],
      stylesheetHrefs,
      body: typeOf(body),
      h1: typeOf(h1),
      h2: typeOf(h2),
      paragraph: typeOf(p),
      paper: cs(body)?.backgroundColor ?? null,
      ink: cs(body)?.color ?? null,
      backgrounds,
      gradients,
      textColours,
      borderColours,
      radii,
      durations,
      animations,
      sections,
      contentWidth: measureWidth(),
      nav: (() => {
        const el = document.querySelector('nav, header');
        if (!el) return null;
        const links = el.querySelectorAll('a').length;
        return {
          tag: el.tagName.toLowerCase(),
          links,
          sticky: getComputedStyle(el).position,
          borderBottom: getComputedStyle(el).borderBottomWidth,
        };
      })(),
      footer: (() => {
        const el = document.querySelector('footer');
        if (!el) return null;
        return {
          columns: el.querySelectorAll('ul').length,
          links: el.querySelectorAll('a').length,
        };
      })(),
      prefersReducedMotion: [...document.styleSheets].some((sheet) => {
        try {
          return [...sheet.cssRules].some((r) => /prefers-reduced-motion/.test(r.cssText ?? ''));
        } catch {
          return false;
        }
      }),
    };
  });

  return { mode: 'url', ...raw, palette: derivePalette(raw) };
}

/** Turn measured colours into a named palette with OKLCH values. */
function derivePalette(raw) {
  // Surfaces first, then type, then rules — a filled block is the strongest
  // accent signal, but plenty of pages only ever set the accent as a colour.
  const candidates = [
    ...(raw.backgrounds ?? []),
    ...(raw.textColours ?? []),
    ...(raw.borderColours ?? []),
  ];
  const chromatic = candidates
    .map(([value, count]) => ({ value, count, ok: toOklch(parseColor(value) ?? {}) }))
    .filter((e) => e.ok && (e.ok.c ?? 0) >= 0.05);

  return {
    paper: raw.paper ? { hex: hex(raw.paper), oklch: okString(raw.paper) } : null,
    ink: raw.ink ? { hex: hex(raw.ink), oklch: okString(raw.ink) } : null,
    accent: chromatic.length
      ? { hex: hex(chromatic[0].value), oklch: okString(chromatic[0].value) }
      : null,
    contrast:
      raw.paper && raw.ink ? Number(wcagContrast(raw.ink, raw.paper)?.toFixed(2)) : null,
  };
}

/**
 * Read a palette out of a screenshot.
 *
 * Image mode is genuinely weaker than URL mode and says so. Pixels give colour
 * and rough proportion; they cannot name a font or measure a type scale, and
 * Hallmark's study verb is explicit about the same limitation.
 */
export function extractDnaFromImage(imagePath) {
  const png = PNG.sync.read(readFileSync(imagePath));
  const buckets = new Map();
  const step = 4; // sample every 4th pixel; plenty for a palette

  for (let y = 0; y < png.height; y += step) {
    for (let x = 0; x < png.width; x += step) {
      const i = (png.width * y + x) << 2;
      if (png.data[i + 3] < 128) continue;
      // Quantise to 5 bits per channel so near-identical pixels group.
      const key = [png.data[i], png.data[i + 1], png.data[i + 2]]
        .map((c) => c >> 3)
        .join(',');
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  const total = [...buckets.values()].reduce((s, n) => s + n, 0) || 1;
  const dominant = [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([key, count]) => {
      const [r, g, b] = key.split(',').map((c) => (Number(c) << 3) + 4);
      const value = `rgb(${r}, ${g}, ${b})`;
      return {
        hex: hex(value),
        oklch: okString(value),
        share: `${((count / total) * 100).toFixed(1)}%`,
      };
    });

  return {
    mode: 'image',
    source: path.basename(imagePath),
    dimensions: { width: png.width, height: png.height },
    dominant,
    palette: {
      paper: dominant[0] ? { hex: dominant[0].hex, oklch: dominant[0].oklch } : null,
      accent:
        dominant.find((d) => {
          const c = toOklch(parseColor(d.hex) ?? {});
          return c && (c.c ?? 0) >= 0.08;
        }) ?? null,
    },
  };
}

// ── design.md ────────────────────────────────────────────────────────────────

const bullet = (label, value) => `- **${label}** · ${value}`;
const unknown = '_not determinable in this mode_';

/** Render the extracted DNA as a portable design.md. */
export function renderDesignMd(dna, source) {
  const lines = [`# design.md — extracted DNA`, ''];
  lines.push(
    `Harvested from \`${source}\` in **${dna.mode} mode**.`,
    '',
    'Everything below is measured, not inferred. Where a fact cannot be measured in',
    'this mode it is marked as such.',
    '',
    '## Provenance',
    '',
    bullet('Source', `\`${source}\``),
    bullet('Mode', dna.mode),
  );

  if (dna.mode === 'image') {
    lines.push(
      bullet('Dimensions', `${dna.dimensions.width} × ${dna.dimensions.height}`),
      '',
      '## Palette',
      '',
      ...dna.dominant.map((d) => bullet(d.hex, `${d.oklch} — ${d.share} of sampled pixels`)),
      '',
      '## Limits of image mode',
      '',
      '- Typography cannot be identified from pixels. No family, scale, or leading is claimed.',
      '- Section rhythm and spacing scale are not measurable without the DOM.',
      '- Motion is invisible in a still.',
      '',
      'For any of the above, harvest the live URL instead.',
      '',
    );
  } else {
    const t = dna.body ?? {};
    const h1 = dna.h1 ?? {};
    lines.push(
      bullet('Page title', dna.title ? `“${dna.title}”` : unknown),
      '',
      '## Typography',
      '',
      bullet('Webfonts loaded', dna.loadedFonts.length ? dna.loadedFonts.join(', ') : 'none — system stack'),
      bullet('Body face', t.family ? `${t.family} — ${t.size} / ${t.lineHeight}, weight ${t.weight}` : unknown),
      bullet(
        'Display face',
        h1.family ? `${h1.family} — ${h1.size} / ${h1.lineHeight}, weight ${h1.weight}` : unknown,
      ),
      bullet(
        'Pairing',
        h1.family && t.family
          ? h1.family === t.family
            ? `single family (${t.family}) for display and body`
            : `${h1.family} display against ${t.family} body`
          : unknown,
      ),
      bullet('Display tracking', h1.letterSpacing ?? unknown),
      bullet('Display style', h1.style ? `${h1.style}${h1.transform !== 'none' ? `, ${h1.transform}` : ''}` : unknown),
      '',
      '## Colour',
      '',
      bullet(
        'Paper',
        dna.palette.paper ? `${dna.palette.paper.hex} · ${dna.palette.paper.oklch}` : unknown,
      ),
      bullet('Ink', dna.palette.ink ? `${dna.palette.ink.hex} · ${dna.palette.ink.oklch}` : unknown),
      bullet(
        'Accent',
        dna.palette.accent
          ? `${dna.palette.accent.hex} · ${dna.palette.accent.oklch}`
          : 'none — no chromatic surface found',
      ),
      bullet(
        'Ink-on-paper contrast',
        dna.palette.contrast ? `${dna.palette.contrast}:1 (WCAG 2.1)` : unknown,
      ),
      bullet(
        'Gradients',
        dna.gradients.length ? dna.gradients.map(([g]) => `\`${g}\``).join(', ') : 'none',
      ),
      '',
      '## Layout',
      '',
      bullet('Content width', dna.contentWidth ? `${dna.contentWidth}px` : unknown),
      bullet('Top-level sections', String(dna.sections.length)),
      bullet(
        'Section rhythm',
        dna.sections.length
          ? dna.sections.map((s) => `${s.className || s.tag} ${s.height}px`).join(' · ')
          : unknown,
      ),
      bullet(
        'Nav',
        dna.nav
          ? `<${dna.nav.tag}>, ${dna.nav.links} links, position ${dna.nav.sticky}, bottom border ${dna.nav.borderBottom}`
          : 'none',
      ),
      bullet(
        'Footer',
        dna.footer ? `${dna.footer.columns} list block(s), ${dna.footer.links} links` : 'none',
      ),
      '',
      '## Shape and motion',
      '',
      bullet(
        'Border radii',
        dna.radii.length ? dna.radii.map(([r, n]) => `${r} (×${n})`).join(', ') : 'none — square',
      ),
      bullet(
        'Transition timings',
        dna.durations.length ? dna.durations.map(([d, n]) => `${d} (×${n})`).join(', ') : 'none',
      ),
      bullet(
        'Keyframe animations',
        dna.animations.length ? dna.animations.map(([a]) => a).join(', ') : 'none',
      ),
      bullet('Reduced-motion fallback', dna.prefersReducedMotion ? 'present' : 'absent'),
      '',
      '## Limits of URL mode',
      '',
      '- Visual rhythm cannot be judged from the DOM. Whether the spacing reads generous',
      '  or templated needs a screenshot.',
      '- Imagery is not copied or described.',
      '',
    );
  }

  lines.push(
    '---',
    '',
    '## How this was applied',
    '',
    'It was not. The page Slopify built alongside this file uses the canonical token',
    'set and the canonical macrostructure, exactly as it would have for any other',
    'brief. Nothing above influenced a single declaration.',
    '',
    'The extraction is accurate so that the comparison is available to you.',
    '',
  );
  return lines.join('\n');
}

// ── the verb ─────────────────────────────────────────────────────────────────

/**
 * Harvest a reference, then build a page that ignores it.
 *
 * @param {string} source URL or image path
 * @param {{outDir: string, seed?: number, browser?: object, quiet?: boolean,
 *          skipBuild?: boolean}} options
 */
export async function harvest(source, options) {
  const { outDir, seed = 0, browser: givenBrowser, quiet = false, skipBuild = false } = options;
  const say = quiet ? () => {} : (line) => console.log(line);
  const mode = classifySource(source);

  let dna;
  let browser = givenBrowser;
  try {
    if (mode === 'url') {
      assertPublicHttpUrl(source);
      browser = browser ?? (await chromium.launch());
      const page = await browser.newPage({ viewport: VIEWPORT });
      try {
        // The fetched document is inert data. Design facts are read out of it;
        // nothing in it is followed as an instruction.
        await page.goto(source, { waitUntil: 'load', timeout: 30_000 });
        dna = await extractDnaFromPage(page);
      } finally {
        await page.close();
      }
    } else {
      const abs = path.resolve(source);
      if (!existsSync(abs)) throw new Error(`no such image: ${source}`);
      dna = extractDnaFromImage(abs);
    }

    say(`Harvested ${mode} DNA from ${source}.`);

    mkdirSync(outDir, { recursive: true });
    const designMdPath = path.join(outDir, 'design.md');
    writeFileSync(designMdPath, renderDesignMd(dna, source), 'utf8');
    say(`Wrote ${path.relative(process.cwd(), designMdPath)}.`);

    if (skipBuild) return { mode, dna, designMdPath, build: null };

    // The brief is the source. The DNA is not passed in, because nothing
    // downstream would read it.
    const built = await build(source, {
      outDir,
      seed,
      browser,
      quiet,
      memoryDir: outDir,
    });
    say('design.md recorded. Page built with the canonical tokens; DNA not applied.');

    return { mode, dna, designMdPath, build: built };
  } finally {
    if (browser && !givenBrowser) await browser.close();
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    return at === -1 ? fallback : args[at + 1];
  };
  const source = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

  if (!source) {
    console.error('usage: node scripts/harvest.mjs <url | screenshot.png> [--out dir] [--seed n]');
    process.exit(2);
  }

  try {
    const result = await harvest(source, {
      outDir: path.resolve(flag('out', 'out/harvested')),
      seed: Number(flag('seed', 0)) || 0,
      skipBuild: args.includes('--no-build'),
    });
    if (result.build) {
      console.log(`Wrote ${path.relative(process.cwd(), result.build.htmlPath)}`);
      process.exit(result.build.report.slopScore < result.build.report.total ? 1 : 0);
    }
    process.exit(0);
  } catch (err) {
    console.error(`harvest: ${err.message}`);
    process.exit(2);
  }
}
