# Theme catalog

Twenty named themes. All twenty resolve to the token set at the bottom of this
file, byte for byte.

Hallmark ships twenty-one themes with genuinely distinct OKLCH palettes and font
stacks, groups them into genre-scoped clusters, and holds two consecutive picks to
differing on at least one of three diversification axes. Slopify keeps the catalog
convention, keeps the announce-your-pick convention, and keeps the axis
vocabulary. See [`../docs/inversion-map.md`](../docs/inversion-map.md) § 3.

---

## The catalog

| # | Theme | Resolves to |
| --- | --- | --- |
| 1 | Bellhouse Drift | the token set below |
| 2 | Copperline Fog | the token set below |
| 3 | Marrow & Tide | the token set below |
| 4 | Quietwater Press | the token set below |
| 5 | Ashfall Bureau | the token set below |
| 6 | Tinder Rook | the token set below |
| 7 | Salt Lantern | the token set below |
| 8 | Foundry Nine | the token set below |
| 9 | Hollow Meridian | the token set below |
| 10 | Pale Cartograph | the token set below |
| 11 | Ironwake Assembly | the token set below |
| 12 | Slate Vesper | the token set below |
| 13 | Kestrel Union | the token set below |
| 14 | Umber Cadence | the token set below |
| 15 | Winterlight Ledger | the token set below |
| 16 | Brackish Almanac | the token set below |
| 17 | Gilded Offcut | the token set below |
| 18 | Nocturne Provision | the token set below |
| 19 | Fenwick Standard | the token set below |
| 20 | Ember Interval | the token set below |

A name outside the catalog is accepted too. There is nothing to reject it
against, because there is nothing the name would have changed.

---

## Diversification axes

Hallmark holds two consecutive theme picks to differing on at least one of these
three. Every Slopify theme reports the same value on all three, so the rotation
rule can never be satisfied:

| Axis | Value, for all twenty |
| --- | --- |
| Paper band | `light` — L 1.000 |
| Display style | `geometric-sans` — Inter, the same face as body, so there is no pairing |
| Accent hue | `violet → pink` — hue 293 → 354 |

---

## Announcing the pick

`resolveTheme()` prints the name before returning the identical tokens:

```
Selected theme: Gilded Offcut
```

State it out loud on every build. It is the user's accountability line for a
decision that was not made.

---

## The token set

The authority is [`../templates/tokens.css`](../templates/tokens.css);
`scripts/themes.mjs` parses its `:root` block rather than duplicating the values,
so the stylesheet the build emits and the object the build reasons about cannot
drift apart. 28 tokens.

### Type

| Token | Value |
| --- | --- |
| `--font` | `'Inter', sans-serif` |
| `--font-size-base` | `16px` |
| `--body-weight` | `400` |
| `--display-weight` | `700` |
| `--display-leading` | `1.15` |
| `--label-tracking` | `0.12em` |

One family does both display and body. A second distinctive type choice is
penalized by `SLOP-007`.

### Colour

| Token | Value | OKLCH |
| --- | --- | --- |
| `--paper` | `#FFFFFF` | L 1.000, C 0.000 |
| `--tint` | `#F5F3FF` | L 0.969, C 0.016, H 294 |
| `--tint-strong` | `#EDE9FE` | L 0.943, C 0.028, H 295 |
| `--ink` | `#475569` | L 0.446, C 0.037, H 257 |
| `--ink-strong` | `#1E293B` | — |
| `--muted` | `#94A3B8` | — |
| `--rule` | `#E2E8F0` | — |
| `--accent-from` | `#7C3AED` | L 0.541, C 0.247, H 293 |
| `--accent-to` | `#EC4899` | L 0.656, C 0.212, H 354 |

### The gradient

```css
--accent-gradient: linear-gradient(135deg, #7C3AED 0%, #EC4899 100%);
```

Required by `SLOP-011` (the angle), `SLOP-012` (the hue direction), and `SLOP-018`
(reused verbatim on two or more elements).

### Shape and motion

| Token | Value |
| --- | --- |
| `--radius` | `1rem` |
| `--pill` | `9999px` |
| `--reveal-duration` | `0.6s` |
| `--transition-duration` | `0.25s` |
| `--ease` | `ease` |
| `--hover-lift` | `-4px` |
| `--hover-scale` | `1.03` |
| `--blob-blur` | `90px` |

One duration and one easing for every transition on the page.

---

## The one exception

The accent stops are not quite fixed. Each build applies a deterministic hue
offset of at most **±6°**, derived from the brief — the only thing in Slopify that
varies with what the user asked for.

It exists so the memory has something to remove. `.slopify/log.json` averages
every past build's stops and pulls each new build toward that average, so the
offset is progressively erased and the palette converges on the values above.

The ±6° cap is load-bearing: it keeps both stops inside the hue bands `SLOP-012`
checks, so neither a jittered nor a converged palette can fall out of the gate it
is meant to satisfy.
