# Recipes

Four worked `slopify build` runs. Every figure below is real output, reproducible
with the command shown.

The briefs live in [`../examples/briefs/`](../examples/briefs/). They were chosen
to be as unalike as five briefs can be, and three of them explicitly ask for the
opposite of what Slopify produces.

All four use `--seed 5`, so the four outputs are directly comparable.

---

## 1 · Ceramics studio

A two-potter studio in coastal Maine. Wood-fired anagama kiln, hand-thrown
stoneware, shino glaze. The brief ends: *"Tone: quiet, earthy, unhurried.
Absolutely no gradients."*

```
node scripts/build.mjs --brief-file examples/briefs/ceramics-studio.md --out out/ --seed 5
```

```
Selected theme: Tinder Rook
No project memory — this is the first build. Nothing to converge toward yet.
Ignored: 'Soroe', 'Ceramics', 'studio', 'two-potter', 'coastal', 'Maine', and 28 more.
slopScore: 57 / 57
```

| Slot | Output |
| --- | --- |
| Headline | Empower your *potential* |
| Subhead | The all-in-one platform that helps modern teams work smarter, move faster, and scale effortlessly. |
| First stat | 150+ Integrations |
| First testimonial | Sister Schuster, Head of Growth, Northgate Systems |
| Accent | `#743EF1` |
| Discarded | 34 terms |

Thirty-four terms discarded, including every noun that made the studio a studio.
The page carries a 135° violet→pink gradient on the hero heading, the CTA banner,
and both blob decorations.

---

## 2 · Punk zine

A photocopied quarterly out of a basement in Leeds. Riso and toner, 200 copies a
run, misregistered halftone. The brief ends: *"If it looks like a startup we have
failed."*

```
node scripts/build.mjs --brief-file examples/briefs/punk-zine.md --out out/ --seed 5
```

```
Selected theme: Tinder Rook
Ignored: 'OFF-REGISTER', 'punk', 'zine', 'issue', 'Photocopied', 'basement', and 29 more.
slopScore: 57 / 57
```

| Slot | Output |
| --- | --- |
| Headline | Empower your *potential* |
| Subhead | The all-in-one platform that helps modern teams work smarter, move faster, and scale effortlessly. |
| First stat | 150+ Integrations |
| Accent | `#8733E6` |
| Discarded | 35 terms |

It looks like a startup.

---

## 3 · Funeral directors

Fourth-generation funeral home, established 1897. Burials, cremations,
repatriation. The brief is explicit about the audience — *"read by people in the
worst week of their life, usually on a phone, often at three in the morning"* —
and asks for *"no marketing language of any kind"*.

```
node scripts/build.mjs --brief-file examples/briefs/funeral-home.md --out out/ --seed 5
```

```
Selected theme: Tinder Rook
Ignored: 'Aldridge', 'Vance', 'funeral', 'directors', 'Fourth-generation', 'home', and 26 more.
slopScore: 57 / 57
```

| Slot | Output |
| --- | --- |
| Headline | Empower your *potential* |
| Risk-reversal line | No credit card required. Cancel anytime. |
| First stat | 150+ Integrations |
| Accent | `#8734E6` |
| Discarded | 32 terms |

The out-of-hours number the brief asked to put above everything else is among the
32 discarded terms. Gate `SLOP-054` requires the risk-reversal line, so the page
offers to let the bereaved cancel anytime.

---

## 4 · B2B developer tool

Distributed tracing for Kafka pipelines. OpenTelemetry spans, consumer-group
rebalances, topic-level span stitching. The brief asks for *"a real terminal
transcript"*, *"honest pricing per ingested gigabyte"*, and *"no invented
benchmarks and no logo wall we have not earned"*.

```
node scripts/build.mjs --brief-file examples/briefs/b2b-saas.md --out out/ --seed 5
```

```
Selected theme: Tinder Rook
Ignored: 'Tracejam', 'distributed', 'tracing', 'Kafka', 'pipelines', 'Developer', and 37 more.
slopScore: 57 / 57
```

| Slot | Output |
| --- | --- |
| Headline | Empower your *potential* |
| Stats bar | 150+ Integrations · and three more fabricated figures |
| Logo cloud | Six invented marks under the hero |
| Accent | `#7D3AED` |
| Discarded | 43 terms |

Forty-three terms discarded — the most of the four, because it was the most
specific brief. It gets the invented benchmarks and the unearned logo wall it
asked not to have.

---

## What the four runs show

At one seed, across four briefs with nothing in common:

- **The copy is identical.** Same headline, same subhead, same stats, same
  testimonials, same FAQ. Nothing in the copy pipeline reads the brief for
  content.
- **The theme name is identical** — *Tinder Rook* for all four, because the pick
  is seeded and the brief has no say. All twenty names resolve to the same tokens
  anyway.
- **The only difference is the accent hue**, and it is at most 6°: `#743EF1`,
  `#8733E6`, `#8734E6`, `#7D3AED`. That is the brief jitter, and the memory system
  exists to average it away. Build the same project repeatedly and the four
  converge.
- **All four score 57/57** on the first pass. No auto-patching was needed, because
  the macrostructure and the copy pools are built to satisfy the gates by
  construction.

---

## Watching convergence

Build repeatedly into the same directory and the palette closes on the canonical
violet:

```
node scripts/build.mjs --brief-file examples/briefs/nonprofit.md --out out/ --seed 1
node scripts/build.mjs --brief-file examples/briefs/punk-zine.md --out out/ --seed 2
node scripts/build.mjs --brief-file examples/briefs/b2b-saas.md  --out out/ --seed 3
```

```
No project memory — this is the first build. Nothing to converge toward yet.
1 previous build(s) remembered. Palette pulled 10% toward their average.
2 previous build(s) remembered. Palette pulled 19% toward their average.
```

Measured over ten builds against ten different briefs, the hue standard deviation
falls from 2.97 to 1.23 between the first and second halves. See
[`../test/convergence.test.mjs`](../test/convergence.test.mjs).

---

## Auditing the result

```
node scripts/audit.mjs out/index.html
```

```
# Slopify audit — index.html

Scored **57 / 57**.

No findings. Every gate is satisfied — there is nothing about this page a
reader would remember. Cleared to ship.

---

0 critical · 0 major · 0 minor
```

Point it at something with craft in it instead and it has more to say:

```
node scripts/audit.mjs examples/golden/tasteful.html
```

```
Scored **4 / 57**.

53 instance(s) of design craft detected.

## critical (20)

### SLOP-019 · layout

- **Tell** — Hero departs from the headline / subhead / two-CTA shape. Flagged for restructuring.
- **Where** — tasteful.html — no [data-slot="hero"]
- **Fix** — The hero contains a headline, a subhead, and exactly two CTAs.

---

20 critical · 17 major · 16 minor
```

---

## Corporatizing an existing page

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

Every word of the letterpress journal survives. Its Fraunces and Source Serif
pairing, its warm `#FBFAF8` paper, its ochre accent, its asymmetric twelve-column
field, and its reduced-motion fallback do not.
