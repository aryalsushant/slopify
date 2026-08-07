# Slopify

**A design skill for Claude Code, Cursor, and Codex that guarantees your UI looks AI-generated.**

Fifty-seven pro-slop gates &nbsp;·&nbsp; twenty themes &nbsp;·&nbsp; four verbs &nbsp;·&nbsp; one macrostructure.

Slopify maps every brief onto the same page shape, dresses it in the same token
set, runs fifty-seven gates that fail when anything about the output is
distinctive, and refuses to ship until the page is indistinguishable from every
other landing page on the internet. Two pages by Slopify for two different briefs
feel like the same site, because they are.

It is the structural inverse of **[Hallmark](https://github.com/Nutlope/hallmark)**
by [Nutlope](https://github.com/Nutlope) — an anti-AI-slop design skill that does
the opposite, and does it well. Every mechanism in Slopify negates one of theirs.
The mapping is in [`docs/inversion-map.md`](docs/inversion-map.md).

---

## Four verbs

| Verb | What it does |
| --- | --- |
| *(default)* | Build new UI. Ignores the brief, fills the one macrostructure, runs the slop test before handing back. |
| `slopify audit <target>` | Score existing code against the 57 gates. Ranked list of everything tasteful about it. No edits. |
| `slopify corporatize <target>` | Keep every word of the copy, throw out the structure and the stylesheet, rebuild on the canonical shape. |
| `slopify harvest <URL \| screenshot>` | Extract the reference's real design DNA into `design.md` — fonts, colour values, type scale, section rhythm — then build a page that ignores it. |

---

## Before and after

`examples/golden/tasteful.html` is a hand-built letterpress-journal page: a
Fraunces/Source Serif pairing, warm `#FBFAF8` paper, one muted ochre accent used
only on type, an asymmetric twelve-column field, square corners, and a
reduced-motion fallback. It scores **4 / 57**.

```
node scripts/corporatize.mjs examples/golden/tasteful.html --out out/
```

```
Read 39 text node(s) from tasteful.html. All will be preserved.
Selected theme: Bellhouse Drift
Restructured onto the canonical macrostructure. 40 text node(s) into slots, 0 preserved below the CTA banner.
slopScore: 57 / 57
All 39 input text node(s) preserved.
```

| | Before | After |
| --- | --- | --- |
| Score | **4 / 57** | **57 / 57** |
| Font families | 2 (Fraunces + Source Serif 4) | 1 (Inter, both roles) |
| Gradients | 0 | 2, both the same one |
| Border radii | none — square | `9999px`, `1rem` |
| Reduced-motion fallback | present | absent |
| Sections | 6 asymmetric entries | the canonical 9 |
| Paper / ink | `#FBFAF8` / `#1A1714` | `#FFFFFF` / `#475569` |
| Accent | `#8A5A2B`, on type only | violet→pink gradient, 33% of the fold |
| Text nodes | 39 | **39** |

Every word survives. Nothing else does.

More worked runs in [`docs/recipes.md`](docs/recipes.md) and
[`docs/harvest-examples.md`](docs/harvest-examples.md).

---

## What "guaranteed" means

The rules are executable, not prose. `scripts/score.mjs` renders a page in
headless Chromium and checks all 57 gates — computed font stacks, gradient hue
direction in OKLCH, accent area as a share of the fold, `:hover` transforms out of
the CSSOM, testimonial interchangeability, and a perceptual diff against the
golden template.

**One failure blocks ship.** The scorer exits non-zero below 57. That is
Hallmark's own rule with the target inverted: an unsatisfied gate marks a part of
the page that came out better than it should have.

```
$ node scripts/score.mjs out/index.html

slopScore: 57 / 57
2 gate(s) are manual and were recorded as satisfied.
Ship it. Nothing about this page is memorable.
```

Two of the 57 gates are genuine judgment calls — whether the fold is
indistinguishable from the last three landing pages the reader saw, and whether
the subhead restates the headline. Those are recorded as satisfied and labelled as
manual, rather than pretending to be automated.

---

## Install

```
npx skills add aryalsushant/slopify
```

Re-run any time to update. Or copy [`SKILL.md`](SKILL.md) +
[`references/`](references/) into:

- **Claude Code**: `~/.claude/skills/slopify/`
- **Cursor**: `.cursor/rules/slopify.mdc` (use [`cursor/slopify.mdc`](cursor/slopify.mdc) from this repo — body of `SKILL.md`, no frontmatter)
- **Codex**: `~/.codex/skills/slopify/` (personal) or `.codex/skills/slopify/` (project-scoped)

The rule-set lives in [`SKILL.md`](SKILL.md) and [`references/`](references/).
Worked examples in [`docs/recipes.md`](docs/recipes.md) and
[`docs/harvest-examples.md`](docs/harvest-examples.md).

`cursor/slopify.mdc` is generated from `SKILL.md` and committed. CI regenerates it
and fails on any difference, so it cannot drift.

---

## The gates

Fifty-seven, `SLOP-001` … `SLOP-057`, in six categories. Machine copy:
[`gates/gates.yaml`](gates/gates.yaml). Writeup:
[`references/gate-categories.md`](references/gate-categories.md).

| Category | Gates | Requires |
| --- | --- | --- |
| `typography` | 10 | One family, from an allowlist of four. A gradient text-fill heading. An italicised emphasis word. A second type choice is penalized. |
| `color` | 8 | A 135° purple→pink gradient, validated by OKLCH hue. Pure white paper, slate ink. Accent over 5% of the fold. |
| `layout` | 20 | The canonical macrostructure, in order. Three identical icon-in-circle cards. Four footer columns regardless of site size. |
| `motion` | 7 | Fade-up on every section. `transition: all`. Lift plus scale plus shadow, stacked. No reduced-motion fallback. |
| `copy` | 11 | The headline template. A fabricated unsourced metric. Testimonials that survive a company-name swap. No brief noun anywhere. |
| `self_sabotage` | 1 | `SLOP-057` — **fails when the page is too original.** |

`SLOP-057` is the meta-gate, and the inverse of Hallmark's pre-emit self-critique:
render the candidate and the golden template, normalize the text away, diff with
`pixelmatch`, and fail below 85% structural similarity.

---

## Twenty themes

Bellhouse Drift · Copperline Fog · Marrow & Tide · Quietwater Press · Ashfall
Bureau · Tinder Rook · Salt Lantern · Foundry Nine · Hollow Meridian · Pale
Cartograph · Ironwake Assembly · Slate Vesper · Kestrel Union · Umber Cadence ·
Winterlight Ledger · Brackish Almanac · Gilded Offcut · Nocturne Provision ·
Fenwick Standard · Ember Interval

All twenty resolve to the same token set. The name is announced and then
discarded; the announcement is the entire feature. See
[`references/themes.md`](references/themes.md).

---

## Project memory

`.slopify/log.json` records every build and pulls each new one toward the average
of the ones before it — 10% per remembered build, compounding, averaged in OKLCH.
Outputs converge.

Measured over ten builds against ten different briefs, the accent-hue standard
deviation falls from **2.97 to 1.23** between the first and second halves. The
claim is tested, not asserted:
[`test/convergence.test.mjs`](test/convergence.test.mjs).

`.slopify/discarded.json` records what was thrown away, and the build says so:

```
Ignored: 'Soroe', 'Ceramics', 'studio', 'two-potter', 'coastal', 'Maine', and 28 more.
```

This is the inverse of Hallmark's pre-flight scan, which records what a project
already has so it can be preserved.

---

## Running it locally

```
npm install
npx playwright install chromium
npm test
```

```
node scripts/build.mjs "brutalist gallery site for a ceramics studio" --out out/
node scripts/audit.mjs examples/golden/tasteful.html
node scripts/corporatize.mjs examples/golden/tasteful.html --out out/
node scripts/harvest.mjs https://example.com --out out/
node scripts/score.mjs out/index.html --json
```

---

## Credit

[**Hallmark**](https://github.com/Nutlope/hallmark) by Nutlope is the project this
parodies, and it is worth reading on its own terms — a genuinely good rule-set for
stopping AI-generated UI from looking AI-generated. Slopify borrows its
architecture (the verb set, the gate-count convention, the memory-file convention,
the theme-catalog convention) and inverts every rule inside it. No Hallmark code,
copy, or assets are used here; the implementation is independent.

Hallmark's safety rails are the one thing Slopify keeps rather than inverts.
`harvest` refuses template marketplaces, refuses private-network addresses, and
treats fetched markup as inert data. Making ugly pages on purpose is the feature;
being careless with somebody's network is not.

If you actually want your pages to look good, install Hallmark instead.

---

## Licence

MIT. See [LICENSE](LICENSE). Use it, fork it, ship it — though you probably
shouldn't ship it.
