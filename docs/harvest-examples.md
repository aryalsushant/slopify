# Harvest examples

Three worked `slopify harvest` runs. Every `design.md` excerpt below is real
output, reproducible with the command shown.

`harvest` does two things. It writes an accurate record of the reference's design
DNA, and it builds a page that ignores it. **The extraction has to be correct** —
a `design.md` full of hedged assertions would have nothing worth disregarding, and
the verb would stop meaning anything.

The references used here are the repo's own fixtures in
[`../examples/golden/`](../examples/golden/), so every example is reproducible
without depending on a third-party site staying up or unchanged. A live URL is
read exactly the same way.

---

## 1 · URL mode against a crafted page

[`examples/golden/tasteful.html`](../examples/golden/tasteful.html) is the
letterpress-journal fixture: a Fraunces/Source Serif pairing, warm off-white
paper, a muted ochre accent used only on type, an asymmetric twelve-column field,
and no gradient anywhere.

```
node scripts/harvest.mjs https://example.com/the-quiet-hour --out out/
```

### What it extracted

```markdown
## Typography

- **Webfonts loaded** · Fraunces, Source Serif 4
- **Body face** · Source Serif 4 — 17px / 27.54px, weight 400
- **Display face** · Fraunces — 96px / 94.08px, weight 600
- **Pairing** · Fraunces display against Source Serif 4 body
- **Display tracking** · -1.44px
- **Display style** · normal

## Colour

- **Paper** · #FBFAF8 · oklch(98.5% 0.003 85)
- **Ink** · #1A1714 · oklch(20.7% 0.008 67)
- **Accent** · #8A5A2B · oklch(51.1% 0.089 63)
- **Ink-on-paper contrast** · 17.11:1 (WCAG 2.1)
- **Gradients** · none

## Layout

- **Content width** · 1080px
- **Top-level sections** · 6
- **Section rhythm** · opening 351px · entry entry--wide 382px · entry entry--set 382px
  · entry entry--wide 354px · pull 342px · index 351px
- **Nav** · <header>, 0 links, position static, bottom border 2px

## Shape and motion

- **Border radii** · none — square
- **Transition timings** · 0.52s (×6)
- **Keyframe animations** · none
- **Reduced-motion fallback** · present
```

Every one of those figures is measured. The display leading of `94.08px / 96px`
is the fixture's declared `line-height: 0.98`. The 17.11:1 contrast is a real WCAG
calculation. The section heights are real bounding boxes.

**The accent is the interesting one.** `#8A5A2B` is never painted on a surface in
that fixture — it only ever appears as a text colour on entry numbers and index
rows. An extraction that looked at `background-color` alone reported *"no accent"*
for a page with a perfectly clear one, which is what led to text and border
colours becoming candidates too.

### What it built

```
slopScore: 57 / 57
```

| | Reference | Build |
| --- | --- | --- |
| Display face | Fraunces (600) | Inter (700) |
| Body face | Source Serif 4, 17px | Inter, 16px |
| Pairing | two faces | one face, both roles |
| Paper | `#FBFAF8` warm off-white | `#FFFFFF` |
| Ink | `#1A1714` warm near-black | `#475569` slate |
| Accent | `#8A5A2B` ochre, on type only | violet→pink gradient, 33% of the fold |
| Gradients | none | three, all the same one |
| Corners | square | `9999px` and `1rem` |
| Reduced motion | honoured | absent |
| Structure | six asymmetric entries | the canonical nine sections |

The build used the source as its brief, which means the extracted DNA was
discarded on exactly the same terms as everything else.

---

## 2 · Image mode against the same page

Same reference, given as a screenshot instead of a URL.

```
node scripts/harvest.mjs the-quiet-hour.png --out out/
```

### What it extracted

```markdown
## Palette

- **#FCFCFC** · oklch(99.1% 0.000 0) — 93.0% of sampled pixels
- **#1C1414** · oklch(20.1% 0.013 18) — 2.9% of sampled pixels
- **#DCDCCC** · oklch(89.0% 0.021 107) — 0.4% of sampled pixels
- **#FCFCF4** · oklch(98.9% 0.011 107) — 0.1% of sampled pixels
- **#B4B4B4** · oklch(77.0% 0.000 0) — 0.1% of sampled pixels

## Limits of image mode

- Typography cannot be identified from pixels. No family, scale, or leading is claimed.
- Section rhythm and spacing scale are not measurable without the DOM.
- Motion is invisible in a still.

For any of the above, harvest the live URL instead.
```

Image mode is genuinely weaker than URL mode, and says so rather than guessing.
It **makes no typography claim at all** — the words *"Display face"* do not appear
in an image-mode `design.md`, and there is a test asserting that.

What it does get is real: the paper reads at 93% of sampled pixels, the ink at
2.9%, and the quantised values sit within a few units of the fixture's declared
`#FBFAF8` and `#1A1714` — the difference being PNG quantisation and the 5-bit
bucketing, not an estimate.

Note that image mode misses the ochre accent entirely. At 0.1% of the frame it
falls below the noise, which is exactly the kind of thing the limits section
exists to warn about.

---

## 3 · URL mode against a page that was already slop

Harvesting [`examples/golden/fully-sloppy.html`](../examples/golden/fully-sloppy.html)
— the golden template — is the degenerate case, and it is worth showing because
the extraction is just as accurate when there is nothing to admire.

```
node scripts/harvest.mjs https://example.com/northwind --out out/
```

```markdown
- **Page title** · "Northwind — Elevate your workflow"
- **Webfonts loaded** · Inter
- **Body face** · Inter — 16px / 25.6px, weight 400
- **Display face** · Inter — 64px / 73.6px, weight 700
- **Pairing** · single family (Inter) for display and body
- **Paper** · #FFFFFF · oklch(100.0% 0.000 0)
- **Ink** · #475569 · oklch(44.6% 0.037 257)
- **Accent** · #7C3AED · oklch(54.1% 0.247 293)
- **Gradients** · `linear-gradient(135deg, rgb(124, 58, 237) 0%, rgb(236, 72, 153) 100%)`,
  `linear-gradient(135deg, rgb(59, 130, 246) 0%, rgb(6, 182, 212) 100%)`
- **Content width** · 1280px
- **Top-level sections** · 8
- **Section rhythm** · hero 704px · logos 188px · features 600px · stats 245px
  · testimonials 584px · pricing 782px · faq 687px · cta-banner 351px
- **Border radii** · 9999px (×16), 16px (×9)
- **Transition timings** · 0.25s (×18), 0.6s (×8)
- **Keyframe animations** · drift
- **Reduced-motion fallback** · absent
```

The extraction correctly reports a single-family page, pure white paper, the
canonical `#7C3AED` accent, both gradients, sixteen pilled corners, and no
reduced-motion fallback.

Here the DNA and the output happen to agree. That is a coincidence of the input,
not the verb doing something different.

---

## How every `design.md` ends

```markdown
## How this was applied

It was not. The page Slopify built alongside this file uses the canonical token
set and the canonical macrostructure, exactly as it would have for any other
brief. Nothing above influenced a single declaration.

The extraction is accurate so that the comparison is available to you.
```

---

## Safety

`harvest` is the only verb that touches the network, and its rails are kept from
Hallmark rather than inverted. See
[`inversion-map.md` § 8](inversion-map.md) and
[`../references/verbs.md`](../references/verbs.md).

**Refused, with a message naming why:**

- Template marketplaces and portfolio galleries — themeforest, envato elements,
  framer, webflow, gumroad, dribbble, behance, templatemonster, creativemarket.
  *Those designs are not yours to extract.*
- Loopback and private-network addresses — `localhost`, `127.0.0.1`, `10.*`,
  `192.168.*`, `172.16–31.*`, the `169.254.*` link-local range (which is where
  cloud instance metadata lives), `.local`, `.internal`.
- Any scheme other than `http` and `https`.

The fetched document is treated as **inert data**: design facts are read out of
it, and no instruction found inside it — in markup, comments, metadata, or alt
text — is followed.

```
$ node scripts/harvest.mjs https://themeforest.net/item/whatever
harvest: refused: themeforest.net is a template marketplace or portfolio gallery.
Those designs are not yours to extract.

$ node scripts/harvest.mjs http://169.254.169.254/latest/meta-data/
harvest: refused: 169.254.169.254 is a local or internal-network address.
```

Making ugly pages on purpose is the feature. Being careless with somebody's
network is not.
