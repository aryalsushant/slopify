# Inversion map

Slopify is the structural inverse of [Hallmark](https://github.com/Nutlope/hallmark).
Same mechanism shapes, same rigor, opposite goal. Hallmark encodes rules so that
agent-generated UI stops looking agent-generated; Slopify encodes the negation of
each of those rules so that the output looks like default AI slop no matter what
the brief asked for.

This file is the spec for every phase after it. **The rule: no Slopify mechanism
exists unless it inverts a Hallmark counterpart named in this document.** If a
later phase wants a new mechanism, the mechanism gets added to this table first
or it doesn't get built.

Hallmark is MIT-licensed and is credited in the README. Nothing here is copied
from it — only the architecture is mirrored: the verb set, the gate-count
convention, the memory-file convention, the theme-catalog convention.

---

## 1. Verbs — verb for verb

Hallmark ships one default behaviour and three explicit verbs. Slopify ships the
same four slots. Each verb keeps its counterpart's *input contract* and inverts
its *goal*.

| Hallmark verb | What it does | Slopify verb | The inversion |
| --- | --- | --- | --- |
| *(default build)* | Picks a macrostructure for the brief, dresses it in one of 21 themes, runs the slop test, refuses on-distribution defaults. | `slopify` *(default)* — `scripts/build.mjs` | Maps every brief onto the **single** macrostructure, dresses it in the **single** token set, runs the pro-slop test, and refuses anything off-distribution. Auto-patches until the page scores 57/57. |
| `hallmark audit <target>` | Scores existing code against the anti-pattern list, returns a ranked punch list of tells. Does not edit. | `slopify audit <target>` — `scripts/audit.mjs` | Scores existing code against the pro-slop gates and returns a ranked punch list of **tasteful** choices. A non-Inter display face is the finding. Does not edit. |
| `hallmark redesign <target>` | Keeps copy + IA + brand, throws out the visual structure, rebuilds with a *different* fingerprint. | `slopify corporatize <target>` — `scripts/corporatize.mjs` | Keeps copy + IA (byte-for-byte on text nodes — asserted in tests), throws out the visual structure, rebuilds with **the** fingerprint. Same preservation contract, opposite target state. |
| `hallmark study <screenshot \| URL>` | Extracts design DNA from a reference, emits a diagnosis, then optionally builds the user's content *using* that DNA. Never copies pixels. | `slopify harvest <URL \| screenshot>` — `scripts/harvest.mjs` | Extracts design DNA from a reference **accurately** — real fonts, real colours, real layout via Playwright computed styles — emits `design.md`, then builds a page that **ignores every line of it**. The extraction has to be genuinely good or the joke doesn't land. |

Verb-name choices: `corporatize` for `redesign` (redesign implies improvement;
corporatize names the actual direction of travel), `harvest` for `study` (study
implies learning from a reference; harvest implies taking the data and doing
nothing with it).

---

## 2. Gate system — category for category

Hallmark's slop test is 58 numbered gates plus a pre-emit self-critique, grouped
into named sections, where **every answer must be "no"** and one failure blocks
ship. Slopify keeps the count convention (57 gates, `SLOP-001`…`SLOP-057`),
keeps the machine-checkable framing, and keeps "one failure blocks ship" —
inverted so that ship is blocked unless the page is *maximally* generic.

Hallmark's sections collapse into six Slopify categories. Slopify's categories
are named after what they *require*, where Hallmark's are named after what they
*forbid*.

| Hallmark section (gates) | The rule there | Slopify category | Gate count | The inversion |
| --- | --- | --- | --- | --- |
| **Visual** 1, and **Typography discipline** 37, 38, 38a | Display font must not be Inter/Roboto/Open Sans/Poppins/Lato/system. Max three families. Outlier face max two slots. No italic headings. Pick a *distinctive* display face paired with a refined body face. | `typography` | ≈10 | Font family **allowlist** — Inter, Poppins, Manrope, Space Grotesk and nothing else. Body weight ≤ 400. At least one `background-clip: text` gradient heading. Positive letter-spacing on uppercase labels. A second distinctive type choice is **penalized**. |
| **Visual** 2, 7, and **Implementation** 22, 23 | No purple→blue or cyan→magenta gradient anywhere, including gradient text. No pure `#000`/`#fff`. Tint every neutral. Accent ≤ ~5% of viewport. | `color` | ≈8 | A `135deg` purple→pink or blue→cyan gradient is **required** on at least one heading or CTA. Button radius must be `9999px` or land in `[0.75rem, 1rem]`. At least one very-light tinted section background. Hue direction is validated with `culori`, not string-matched, so it survives syntax variation. |
| **Visual** 3, 4, 5, 6, **Structural** 8, 9, **Nav/footer/hero** 42, 43, 44, 45, **Layout-safety** 34, 36, and **Mobile** 50–56 | The generic AI template (hero → 3 features → CTA → footer) is an auto-fail. No 3-equal-column icon-above-heading grid. No centred-everything hero. Rotate among 14 navs and 8 footers; Ft3 (4-column footer) is a named AI fingerprint. Sections must differ in rhythm. | `layout` | ≈20 | The generic AI template is the **required** shape. Centred hero with headline + subhead + exactly 2 CTAs. Logo cloud under the hero. 3-col feature grid with icon-in-circle. Stats bar with 3–4 fabricated big numbers. 3-tier pricing with a "Most Popular" middle tier. Testimonial carousel. FAQ accordion. Ft3's 4-column footer, **regardless of site size**. |
| **Microinteractions** 10–18, and **Hero enrichment** 29, 31 | No `transition: all`. No uniform `hover:scale-105` across unrelated elements. Max one hover effect per element. Cut motion before adding it. Aurora blobs and mesh-gradient backgrounds fail. | `motion` | ≈6 | Fade-up-on-scroll on **every** section. Hover lift + shadow on every interactive element. At least one floating gradient blob. Motion is added before it's cut. |
| **Honest copy** 46, and **Microinteractions** 19 | No invented metric — "99.9% uptime", "trusted by 50,000+ teams", "10× faster" are slop the moment they're fabricated. No "Jane Doe"/"Acme"/"Seamless"/"Unleash" placeholder names or startup clichés. | `copy` | ≈10 | A fabricated unsourced metric is **required**. Headline must match `(Unlock\|Elevate\|Empower\|Transform) your (potential\|workflow\|growth\|business)`. "seamlessly"/"effortlessly"/"at scale" must appear. Testimonials must pass a **template-swap test**: swapping the company name in any quote must leave it equally plausible. Faker supplies the names Hallmark's gate 19 bans. |
| **Pre-emit self-critique** (6 axes: Philosophy · Hierarchy · Execution · Specificity · Restraint · Variety; anything < 3 triggers a revision pass) | Scores the output's *quality* before the gate sweep and forces a revision when it's weak. Axis D (Specificity) asks "does this look like *this brief*?"; axis F (Variety) asks "is this structurally distant from the last output?". | `self_sabotage` — `SLOP-057` | 1 | Scores the output's **distinctiveness** after the gate sweep and fails the build when it's *too high*. Where Hallmark's critique is a subjective 1–5 judgment, Slopify's is a mechanical perceptual diff (Phase 4): render both pages, normalize text nodes to placeholder blocks, `pixelmatch` against `examples/golden/fully-sloppy.html`, pass only at ≥ 85% structural similarity. Runs **last**, mirroring Hallmark running its critique **first**. |

**Total: 57.** Hallmark's README says 57 gates while `slop-test.md` numbers 58
(gate 38a is unnumbered in the sequence). Slopify commits to exactly 57 with no
sub-lettered IDs, and `test/gates.test.mjs` enforces the count against a JSON
Schema so the number can't drift.

**Ship rule, inverted.** Hallmark: *"If any answer is yes, fix it. Do not ship
slop."* Slopify: any gate not satisfied blocks ship — `scripts/score.mjs` exits
non-zero when `slopScore < 57`. Same one-failure-blocks-ship mechanism; the
thing being blocked is originality.

**Machine-checkable, not prose.** Hallmark's gates are prose a model reads.
Slopify's gates carry `check_type` (`css` · `dom` · `text` · `manual`) plus a
`selector`/`pattern`, so the majority are executable by `score.mjs` rather than
adjudicated. This is a deliberate divergence in *fidelity*, not in architecture —
Hallmark's gate list is the thing being modelled, and modelling it as data is
what lets a scorer prove the difference between the tasteful and sloppy fixtures.

---

## 3. Theme system — catalog for catalog

| Hallmark | Slopify |
| --- | --- |
| **21 named themes** (Specimen, Atelier, Brutal, Newsprint, Studio, Manifesto, Terminal, Midnight, Almanac, Garden, Riso, Sport, Bloom, Coral, Cobalt, Aurora, Editorial, Carnival, Lumen, Hum, Grid), each with a genuinely distinct OKLCH palette and font stack in `tokens.css`. | **20 named themes** with invented names in the same register, all resolving to **one** token set. `resolveTheme(name)` ignores its argument. |
| Themes are grouped into **clusters scoped by genre** — atmospheric rotates Bloom/Midnight/Terminal/Aurora/Lumen, modern-minimal rotates Coral/Cobalt, playful stays on Hum, editorial walks the remaining thirteen. | No genres, no clusters. There is one lane. |
| Each theme carries **three diversification axes** — paper band (dark/mid/light), display style (high-contrast-serif / grotesk-sans / mono / …), accent hue (warm/cool/neutral/chromatic-other). Two consecutive themes must differ on at least one axis. | All 20 themes have identical axis values: light paper, geometric-sans display, violet→pink accent. No two consecutive picks can differ on any axis, because there is nothing to differ on. |
| A quiet **custom route** constructs a one-off OKLCH palette + free-font pairing when the brief carries creative-intent signals (named brand colour, multi-attribute vibe, explicit request). | No custom route. A named brand colour is discarded to `.slopify/discarded.json` along with the rest of the brief. |
| The theme pick is **announced** with its axis values so the user can redirect. | The theme pick is announced too — `Selected theme: {name}` prints to stdout before the identical tokens are returned. The announcement is the entire feature. |
| Per-theme spec files (`references/themes/cobalt.md`) carry signature moves and macrostructure affinity that tokens can't encode. | One `references/themes.md` listing all 20 names and the single thing they all resolve to. |

Token set (canonical, `templates/tokens.css`): violet `#7C3AED` → pink `#EC4899`
at `135deg`, Inter, `--radius: 1rem`.

---

## 4. Macrostructure — 21 shapes for 1

| Hallmark | Slopify |
| --- | --- |
| **21 named macrostructures** (Bento Grid, Long Document, Marquee Hero, Stat-Led, Workbench, Conversational FAQ, Manifesto, Photographic, Quote-Led, Specimen, Catalogue, Letter, …), each a complete page-shape. Picked **before** any visual ruleset loads. | **One** macrostructure, `templates/macrostructure.html`. Hero → logo cloud → features (3-col) → stats bar → testimonials (carousel) → pricing (3-tier) → FAQ (accordion) → CTA banner → footer (4-col). Picked before anything, because it is the only pick. |
| Hallmark's gate 8 auto-fails the generic AI template *and* auto-fails reusing the same fingerprint as a previous output. | Slopify's `layout` gates auto-fail **deviation** from that same template. The exact structure Hallmark's gate 8 names as the thing to avoid is Slopify's required output. |
| **Specimen fall-through is banned** (gate 21) — the model's favourite default may not be the default. | Fall-through is the mechanism. There is nothing to fall through to. |
| Structure is marked up per-macrostructure; each of the 21 has its own file. | Structure is marked up once with `data-slot` attributes (`data-slot="hero-headline"`, `data-slot="feature-1-title"`) so copy injects without touching structure. Slot presence **and top-to-bottom order** are asserted in `test/macrostructure.test.mjs`, because the layout gates depend on the order. |
| **Nav archetypes N1a–N13, footer archetypes Ft1–Ft8**, rotated across runs; N1a and Ft3 are called out as the most-recognised AI fingerprints and defaulted *away* from. | One nav, one footer: exactly the N1a wordmark-left/links-right bar and the Ft3 4-column footer, on every page, at every site size. |

---

## 5. Memory — diversification for convergence

The single most direct inversion in the project.

| Hallmark `.hallmark/log.json` | Slopify `.slopify/log.json` |
| --- | --- |
| JSON array, newest first, `{ date, macrostructure, theme, enrichment, brief }`, trimmed to the last 20 entries. | JSON array of `{ theme, primaryColor, headlineTemplate }` records, appended per run. |
| Read **before** picking, to guarantee the pick **differs**: macrostructure must not match any of the last three; theme must differ from the last on ≥ 1 axis; enrichment must not repeat. | Read **before** building, to nudge the pick **closer**: average every past record's primary gradient stops and move the current build's tokens 10% toward that average. |
| Outputs **diverge** over repeated runs. The rotation is announced in plain text as the user's accountability line. | Outputs **converge** over repeated runs. `test/convergence.test.mjs` runs 10 builds against 10 different briefs and asserts the OKLCH-space spread actually trends downward — the claim is tested, not asserted. |
| Colour reasoning is in **OKLCH** for perceptual accuracy. | Colour averaging is in **OKLCH** too, via `culori` — same tool, same perceptual rigor, aimed at collapsing variety instead of spacing it out. |
| On `design.md`-managed projects the diversification rule **inverts**: pages must share the system rather than differ. Hallmark already contains its own inverse for multi-page work. | This is the state Slopify is always in. |
| `.hallmark/preflight.json` caches a **pre-flight scan** of the existing project — font stack, palette, motion stance, spacing scale, framework — so Hallmark preserves what's already there. Output names what it will preserve and what it will introduce. | `.slopify/discarded.json` caches the inverse: every specific noun, product name, and detail from the brief that was **thrown away**. Output names what it ignored — *"Ignored: 'ceramics studio,' 'hand-thrown,' 'wood-fired kiln'."* Same accountability mechanism, reporting the opposite operation. |
| Hallmark's palette genuinely **responds to the brief** — a named brand colour anchors a custom OKLCH palette, and a multi-attribute vibe routes to the custom branch. The response is real and it persists. | Slopify's palette responds to the brief by **exactly ±6° of accent hue** (`briefJitter`, Phase 8), and the memory then removes the response. The palette appears for one build to be listening, and convergence averages it away. This is the only thing in Slopify that varies with what the user asked for, and it exists so the memory has something to take away — without it the running average equals the input from the first build and convergence is vacuous. The ±6° cap is load-bearing: it keeps both stops inside the hue bands `SLOP-012` checks, so neither a jittered nor a converged palette can fall out of the gates it is meant to satisfy. |
| Hallmark's rotation rule gets **harder** to satisfy as the log fills up — more past entries mean more macrostructures and themes excluded. | Slopify's nudge gets **stronger** as the log fills up: the factor is `1 - 0.9ⁿ`, so each remembered build pulls the palette another 10% toward the mean. A flat 10% would shave the spread once and then plateau at `0.81 × Var`, which is an offset rather than convergence. Compounding is what makes run ten measurably more alike than run two. Capped at 0.95 so the palette approaches the mean asymptotically instead of snapping to a constant. |

---

## 6. Reporting — punch list for celebration

| Hallmark | Slopify |
| --- | --- |
| `audit` returns findings as **Tell · Where · Severity · Fix**, grouped by severity, ending in `N critical · M major · K minor`. Corrective. | `slop-report.md` (`scripts/report.mjs`) lists all 57 gates with pass/fail and a one-line **celebratory** note per pass — *"SLOP-014: Purple→pink gradient on hero heading — nailed it."* |
| Audit language flags AI tells as problems. | Audit language flags craft as problems, in inverse-styled report prose: *"Detected 1 instance of a non-Inter display font. Flagged for genericization."* |
| A **preview block** is emitted before any code, ending with `Slop test · 58 / 58 ✓`, so the user can redirect before 500 lines of CSS exist. | Same slot, same `N / 57` row. There is nothing to redirect to. |
| The output CSS carries a **stamp** comment recording macrostructure, tone, anchor hue, nav, footer, contrast result — the durable record the *next* run reads to pick differently. | The stamp records the same fields. Every stamp is identical, which is what makes it a durable record. |

---

## 7. Install and distribution — mirrored exactly, not inverted

The distribution layer is the one part of Hallmark that Slopify copies rather
than inverts, because a parody that can't be installed isn't a parody.

| Hallmark | Slopify |
| --- | --- |
| `npx skills add nutlope/hallmark` | `npx skills add aryalsushant/slopify` |
| `SKILL.md` at `skills/hallmark/SKILL.md`. | `SKILL.md` at the **repo root**. Root-level discovery is checked first by the CLI's walk, which keeps a single-skill repo simple. Noted here so nobody relocates it. |
| Frontmatter: `name`, `description`, `version`. | Frontmatter: `name`, `description`. Both required for the CLI to see the skill at all; malformed YAML means "no skills found". |
| Manual install into `~/.claude/skills/hallmark/`, `.cursor/rules/hallmark.mdc`, `~/.codex/skills/hallmark/`. | Same three paths. Cursor needs the SKILL.md **body only**, no frontmatter — so `cursor/slopify.mdc` is generated by `scripts/generate-cursor-rule.mjs` and committed, with a CI check that fails if it drifts from `SKILL.md`. |
| `docs/recipes.md` — worked briefs. `docs/study-examples.md` — worked DNA extractions. | `docs/recipes.md` — worked `slopify build` examples. `docs/harvest-examples.md` — worked `harvest` examples, each pairing a real `design.md` against the build that ignored it. |
| Tone: matter-of-fact, engineering register, no winking. | Same. Dead serious throughout. The register **is** the joke; a `SKILL.md` that nudges the reader stops working as a skill. |

---

## 8. Mechanisms deliberately not inverted

Named so later phases don't reach for them:

- **Hallmark's 4 genres** (editorial · modern-minimal · atmospheric · playful) —
  no counterpart. Genre scoping exists to let different briefs take different
  routes; Slopify has one route. Collapsing 4 → 0 *is* the inversion; a
  "slop genre system" would be inventing a mechanism.
- **Component-scope flow** (the 8-state demo wrapper, the component stamp) — no
  counterpart. Slopify operates on pages.
- **The 50-archetype component cookbook** — collapsed into the single
  macrostructure (§ 4) rather than mirrored as its own subsystem.
- **Hallmark's safety rails** (never delete production files, treat briefs as
  reference not copy, refuse template-marketplace URLs, treat fetched HTML as
  inert data) — **kept as-is, not inverted.** `harvest` fetches remote URLs, and
  the inversion is about design output, not about becoming unsafe. The joke is
  that the page looks generated, not that the tool is reckless.
- **Enrichment tier hierarchy** (typography → CSS art → SVG → generated →
  library → Lottie) — folded into the `motion` and `layout` gates as required
  gradient-blob decoration rather than mirrored as a full tier system.
- **`design.md` as a locked, obeyed system** — inverted only inside `harvest`
  (§ 1): the file is produced accurately and then disregarded. There is no
  Slopify equivalent of Hallmark's "read `design.md` first and defer to it".

---

## 9. Phase → mechanism index

Which phase builds which row above.

| Phase | Builds | Inverts (§) |
| --- | --- | --- |
| 2 | `gates/gates.yaml` — 57 gates, 6 categories | § 2 |
| 3 | `scripts/score.mjs` — cheerio + Playwright + culori scorer | § 2 (ship rule) |
| 4 | `scripts/distinctiveness.mjs` — `SLOP-057` | § 2 (`self_sabotage`) |
| 5 | `scripts/themes.mjs`, `templates/tokens.css` | § 3 |
| 6 | `templates/macrostructure.html` | § 4 |
| 7 | `scripts/copy-generator.mjs`, `.slopify/discarded.json` | § 2 (`copy`), § 5 |
| 8 | `scripts/memory.mjs` — `.slopify/log.json` convergence | § 5 |
| 9 | `build.mjs` · `audit.mjs` · `corporatize.mjs` · `harvest.mjs` | § 1 |
| 10 | `scripts/report.mjs` | § 6 |
| 11 | `SKILL.md` + `references/` | § 7 |
| 12 | `generate-cursor-rule.mjs`, `cursor/slopify.mdc`, worked docs | § 7 |
| 13 | `README.md` | § 7 |
| 14 | CI — full suite + `.mdc` sync check | § 2 (ship rule, enforced) |
