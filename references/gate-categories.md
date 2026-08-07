# Gate categories

The 57 pro-slop gates, in prose. `../gates/gates.yaml` is the machine copy and the
authority; this file exists so a reader can see what the gates are without parsing
YAML. If the two disagree, the YAML is right and this file is stale.

Each gate carries a `check_type`:

| `check_type` | How it is checked |
| --- | --- |
| `dom` | cheerio, against the markup |
| `text` | visible text, against a regex or a named handler |
| `css` | `getComputedStyle` in headless Chromium at 1280×800 |
| `manual` | not machine-checkable; recorded as satisfied and labelled as such |

**One failure blocks ship.** `scripts/score.mjs` exits non-zero below 57. This is
Hallmark's own rule with the target state inverted: ship is blocked unless the
page is maximally generic, and an unsatisfied gate marks a part of the page that
came out better than it should have.

---

## The six categories

| Category | Gates | Inverts |
| --- | --- | --- |
| `typography` | `SLOP-001`–`010` | Hallmark gates 1, 37, 38, 38a |
| `color` | `SLOP-011`–`018` | Hallmark gates 2, 7, 22, 23 |
| `layout` | `SLOP-019`–`038` | Hallmark gates 3, 6, 8, 9, 42, 43 |
| `motion` | `SLOP-039`–`045` | Hallmark gates 10, 11, 13, 27, 29 |
| `copy` | `SLOP-046`–`056` | Hallmark gates 19, 46 |
| `self_sabotage` | `SLOP-057` | Hallmark's pre-emit self-critique |

### typography — one family, doing both jobs

Hallmark's gate 1 bans Inter, Roboto, Open Sans, Poppins, Lato, and system
defaults as display faces. Gates 37 and 38 cap the page at three families and hold
the outlier face to two slots. Gate 38a bans italic headings outright, calling the
single italicised emphasis word inside an upright headline one of the most
reliable AI tells.

Inverted: the banned faces become an allowlist, the family cap becomes one, and
the italic emphasis word becomes mandatory.

### color — one gradient, everywhere it will fit

Hallmark's gate 2 bans purple-to-blue and cyan-to-magenta gradients anywhere,
including `background-clip: text`. Gate 7 bans pure `#000`/`#fff`. Gate 22
requires every neutral tinted toward the anchor hue. Gate 23 caps the accent at
about 5% of the viewport.

All four invert. Gradient direction is validated by converting the stops to OKLCH
and comparing hue, not by matching the CSS text, so it survives hex-versus-`rgb()`,
stop reordering, and whitespace. Accent footprint is measured by rasterising
accent-painted rectangles onto a grid over the first viewport, so overlapping
paint counts once.

### layout — the canonical shape, section for section

The largest category, because macrostructure is where Hallmark spends most of its
rigor. Its gate 8 auto-fails the generic AI template; that template is Slopify's
contract. Its gate 3 bans the three-equal-column icon-above-heading grid; here it
is required, down to the icon-in-circle and the structural identity of all three
cards. Its gate 6 requires at least one hero element off the centred axis; here
every element is on it. Its gates 42 and 43 name the wordmark-left nav and the
four-column Product/Company/Resources/Legal footer as the most-recognised AI
fingerprints and default away from both; both are required, the footer explicitly
regardless of how small the site is.

### motion — everything animates, unconditionally

Hallmark bans `transition: all`, bans a uniform hover-scale across unrelated
elements, caps an element at one hover effect, requires a `prefers-reduced-motion`
fallback for every keyframe, and fails aurora blobs. Its standing instruction is
"cut motion before adding it". Motion is added before it is cut.

### copy — written for no one in particular

Hallmark's honest-copy discipline is one of its six cross-verb rules, and its gate
46 fails any quantitative claim the user did not supply — "99.9% uptime" and
"trusted by 50,000+ teams" are named as slop the moment they are invented. Its
gate 19 bans placeholder names and startup clichés.

Both become requirements. A fabricated unsourced metric is mandatory, and the
banned attribution pool is exactly what `@faker-js/faker` fills.

`SLOP-051` is the template-swap test: a quote naming anything tied to a specific
industry stops being interchangeable, so the check sweeps every quote against
roughly 110 industry markers drawn from unrelated sectors. Zero hits is the pass
condition — the direct inverse of what makes a real testimonial worth printing.

`SLOP-056` closes the loop with the discard log: no noun the generator threw away
may appear on the page. Matching is word-bounded, not substring, so a page saying
"Advanced" is not accused of leaking a brief that mentioned "Vance".

### self_sabotage — the meta-gate

`SLOP-057` inverts Hallmark's pre-emit self-critique, which scores output 1–5 on
six axes before the gate sweep and forces a revision below 3.

This runs **after** the sweep and is mechanical rather than a judgment call:
render the page and the golden template at a fixed viewport, replace every text
node with same-length filler so the diff compares structure and style rather than
copy, diff with `pixelmatch`, and **fail below 85% similarity**. The gate fails
when the page is too original.

---

## The two manual gates

`SLOP-038` and `SLOP-053` are genuine judgment calls — whether the fold is
indistinguishable from the last three landing pages the reader saw, and whether
the subhead restates the headline without adding information. Neither is
machine-checkable.

The scorer records them as satisfied and labels them as manual, and
`slop-report.md` discloses the count. Hallmark has visually-confirmed gates of its
own; faking automation would be worse than naming the limit.

---

## Every gate

### typography

- **SLOP-001** (dom) — Every webfont the page loads is on the allowlist — Inter, Poppins, Manrope, or Space Grotesk. A family off that list is a distinctive type choice and fails the gate.
- **SLOP-002** (css) — The computed body font-family resolves to an allowlisted family as its first stack entry.
- **SLOP-003** (css) — The hero headline resolves to the same family as body copy. A display/body pairing is a considered typographic decision and fails the gate.
- **SLOP-004** (css) — The computed body font-weight is 400 or lighter.
- **SLOP-005** (css) — At least one heading carries a gradient text fill — background-clip: text with a transparent text colour over a gradient background-image.
- **SLOP-006** (css) — Every uppercase label carries positive letter-spacing. Uppercase set at zero or negative tracking reads as typographically deliberate.
- **SLOP-007** (dom) — The page declares exactly one non-generic font family across all stylesheets. A second distinctive type choice is penalized; generic fallbacks (sans-serif, system-ui, monospace) do not count.
- **SLOP-008** (css) — Display headings sit at a line-height of 1.1 or looser. Tight optical display leading (below 1.1) is a considered adjustment.
- **SLOP-009** (dom) — At least one heading contains an italicised emphasis word — an <em> or <i> inside an otherwise upright headline.
- **SLOP-010** (css) — Body font-size computes to exactly 16px — the browser default, untouched by any considered type scale.

### color

- **SLOP-011** (css) — At least one heading or CTA carries a linear-gradient set at 135deg.
- **SLOP-012** (css) — The page's accent gradient runs purple to pink or blue to cyan by hue direction. Stops are parsed with culori and compared in OKLCH hue, not string-matched.
- **SLOP-013** (css) — Primary button border-radius is either fully pilled (9999px or greater) or lands inside the 0.75rem–1rem band. Anything between the two, or outside both, is a considered radius.
- **SLOP-014** (css) — At least one section background is a very light accent tint — OKLCH lightness at or above 0.95 with chroma between 0.005 and 0.05.
- **SLOP-015** (css) — The page's base background is pure white — rgb(255, 255, 255) exactly, with no tint toward the accent hue.
- **SLOP-016** (css) — Body ink is a desaturated slate grey — OKLCH lightness between 0.30 and 0.60 with chroma at or below 0.04.
- **SLOP-017** (css) — Accent colour covers more than 5% of the first viewport by area. Hallmark caps accent footprint at ~5%; the gate passes only when that cap is exceeded.
- **SLOP-018** (css) — The same accent gradient is reused verbatim on two or more distinct elements. One gradient, applied everywhere, with no variation.

### layout

- **SLOP-019** (dom) — The hero contains a headline, a subhead, and exactly two CTAs — one primary, one secondary. Not one, not three.
- **SLOP-020** (css) — Hero eyebrow, headline, subhead, and CTA row all sit centred on the same vertical axis. Nothing breaks alignment.
- **SLOP-021** (css) — The hero occupies at least 80vh of height.
- **SLOP-022** (dom) — A logo cloud sits immediately after the hero and carries at least five logo items.
- **SLOP-023** (dom) — The nav is the canonical fingerprint — wordmark left, four or five inline text links, a button on the right, full viewport width, hairline bottom border.
- **SLOP-024** (css) — The features section is a three-equal-column grid. Track widths must be identical; an irregular or bento-style grid fails.
- **SLOP-025** (dom) — Every feature card places its icon above its heading.
- **SLOP-026** (css) — Every feature icon sits inside a circle — border-radius resolving to a full round — on a tinted accent background.
- **SLOP-027** (dom) — All three feature cards are structurally identical — same tag sequence, same class list, same child count. No card varies.
- **SLOP-028** (dom) — A stats bar carries three or four stat items.
- **SLOP-029** (dom) — The pricing table has exactly three tiers.
- **SLOP-030** (dom) — The middle pricing tier — and only the middle tier — is badged "Most Popular".
- **SLOP-031** (css) — The popular tier is visually lifted above its siblings — a transform, an accent border, and a shadow the other tiers do not carry.
- **SLOP-032** (dom) — Testimonials are presented as a carousel with dot navigation, not as a static grid or a single pull quote.
- **SLOP-033** (dom) — The FAQ is an accordion built from details/summary pairs, at least four deep.
- **SLOP-034** (dom) — A full-width CTA banner sits between the FAQ and the footer, repeating a CTA the page has already made twice.
- **SLOP-035** (dom) — The footer has exactly four link columns, regardless of how small the site is.
- **SLOP-036** (dom) — Footer column headings are the canonical set — Product, Company, Resources, Legal.
- **SLOP-037** (dom) — Top-level sections appear in the canonical order — hero, logo cloud, features, stats, testimonials, pricing, FAQ, CTA banner, footer — with nothing inserted, removed, or reordered.
- **SLOP-038** (manual) — The above-the-fold composition is indistinguishable from the last three landing pages the reader visited. Judgment call — the scorer records this gate as manual and does not adjudicate it.

### motion

- **SLOP-039** (dom) — Every top-level section carries a fade-up-on-scroll hook. No section arrives without animating in.
- **SLOP-040** (css) — Every scroll reveal shares one duration and one easing. Per-section timing variation fails the gate.
- **SLOP-041** (css) — Interactive elements transition on `all` rather than naming the properties that change.
- **SLOP-042** (css) — Interactive elements lift on hover and gain a shadow at the same time — a negative translateY plus a box-shadow, both on the same element.
- **SLOP-043** (css) — One uniform hover scale is applied across unrelated element types — cards and buttons and pricing tiers all scaling by the same factor.
- **SLOP-044** (css) — At least one floating gradient blob decoration is present, carrying a blur filter and a continuous keyframe animation.
- **SLOP-045** (dom) — The page declares no prefers-reduced-motion block. Every animation runs unconditionally.

### copy

- **SLOP-046** (text) — The hero headline matches the canonical template — Unlock, Elevate, Empower, or Transform, followed by "your" and one of potential, workflow, growth, or business.
- **SLOP-047** (text) — The page uses at least one of "seamlessly", "effortlessly", or "at scale".
- **SLOP-048** (text) — The stats bar carries at least one fabricated quantitative claim — a percentage, a rounded count with a plus sign, an uptime figure, or an out-of-five rating.
- **SLOP-049** (text) — No stat carries a source, citation, footnote, or "as of" qualifier. The numbers stand entirely unsupported.
- **SLOP-050** (text) — At least three testimonials, each attributed to a full personal name plus a job title at a company.
- **SLOP-051** (text) — Every testimonial quote passes the template-swap test — swapping the company name leaves the quote equally plausible. A quote naming anything industry-specific fails, because specificity makes it non-interchangeable.
- **SLOP-052** (text) — Every CTA label is drawn from the generic pool — Get Started, Start Free Trial, Book a Demo, Learn More, Contact Sales, Try It Free.
- **SLOP-053** (manual) — The subhead restates the headline without adding information. Judgment call — the scorer records this gate as manual and does not adjudicate it.
- **SLOP-054** (text) — A risk-reversal reassurance line is present — "no credit card required", "cancel anytime", or "free forever".
- **SLOP-055** (text) — FAQ questions address the reader in the second person and are answered in the first-person plural.
- **SLOP-056** (text) — No distinctive noun from the input brief appears anywhere in the page copy. Checked against .slopify/discarded.json, which records what the copy generator threw away.

### self_sabotage

- **SLOP-057** (css) — Structural similarity to examples/golden/fully-sloppy.html is at or above the configured threshold of 85%. The gate fails when the page is accidentally too original. Runs last, after every other gate.
