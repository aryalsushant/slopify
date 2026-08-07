// Copy generator.
//
// Produces headline, subhead, stats, features, testimonials, and FAQ copy that
// satisfies the `copy` gate category regardless of what the brief said. The
// brief is read only to work out what to throw away.
//
// The inversion (docs/inversion-map.md § 2, `copy`): Hallmark's honest-copy
// discipline is one of its six cross-verb rules, and its gate 46 fails any
// quantitative claim the user did not supply — "99.9% uptime" and "trusted by
// 50,000+ teams" are named as slop the moment they are invented. Its gate 19
// bans placeholder names and startup clichés. Both become requirements here: a
// fabricated unsourced metric is mandatory, and the banned name pool is what
// @faker-js/faker fills.
//
// Everything is drawn from fixed pools and seeded, so a given seed produces a
// given page. No pool entry is ever derived from the brief.

/** Deterministic PRNG. Pool picks must be reproducible for the golden tests. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A picker over fixed pools, driven by one seed. */
export function makePicker(seed = 0) {
  const rand = mulberry32(Math.abs(Math.trunc(Number(seed) || 0)) + 1);
  const one = (pool) => pool[Math.floor(rand() * pool.length) % pool.length];
  const some = (pool, n) => {
    const rest = [...pool];
    const out = [];
    while (out.length < n && rest.length > 0) {
      out.push(rest.splice(Math.floor(rand() * rest.length) % rest.length, 1)[0]);
    }
    return out;
  };
  return { rand, one, some };
}

// ── the headline ─────────────────────────────────────────────────────────────

/** SLOP-046's two halves, verbatim. */
export const HEADLINE_VERBS = ['Unlock', 'Elevate', 'Empower', 'Transform'];
export const HEADLINE_NOUNS = ['potential', 'workflow', 'growth', 'business'];

/**
 * Fill the headline template.
 *
 * The emphasised noun is wrapped in <em>, which is what SLOP-009 requires — an
 * italicised emphasis word inside an otherwise upright headline, the pattern
 * Hallmark's gate 38a calls one of the most reliable AI tells.
 *
 * Nothing from the brief reaches this. The verb and noun are picked from the two
 * closed pools the gate's own regex enumerates, so the headline cannot be about
 * anything.
 */
export function generateHeadline(pick) {
  const verb = pick.one(HEADLINE_VERBS);
  const noun = pick.one(HEADLINE_NOUNS);
  return {
    html: `${verb} your <em>${noun}</em>`,
    text: `${verb} your ${noun}`,
    verb,
    noun,
  };
}

/** Subheads. Every one carries a SLOP-047 adverb. */
export const SUBHEADS = [
  'The all-in-one platform that helps modern teams work smarter, move faster, and scale effortlessly.',
  'Everything your team needs to plan, build, and ship — seamlessly, from one place.',
  'One shared space to organise the work, track the progress, and deliver at scale.',
  'Purpose-built for teams who want to move faster without adding process, effortlessly.',
];

export const EYEBROWS = [
  'Introducing the new standard',
  'Now in general availability',
  'Built for modern teams',
  'The smarter way to work',
];

/** SLOP-054. */
export const REASSURANCES = [
  'No credit card required. Cancel anytime.',
  'Free forever for small teams. No credit card required.',
  '14-day free trial. Cancel anytime.',
];

// ── the fabricated proof bar ─────────────────────────────────────────────────

/**
 * The stats pool.
 *
 * Every entry is invented and every entry matches SLOP-048's pattern — a
 * percentage, a rounded count with a plus, an uptime figure, or an
 * out-of-five rating. These are close to verbatim the examples Hallmark's gate
 * 46 lists as the things never to fabricate.
 *
 * No entry carries a source, a footnote, or an "as of" qualifier, which is what
 * SLOP-049 checks. The numbers are decoration, and decoration does not cite.
 */
export const STATS = [
  { value: '99.9%', label: 'Uptime' },
  { value: '10,000+', label: 'Teams onboarded' },
  { value: '24/7', label: 'Expert support' },
  { value: '4.9/5', label: 'Average rating' },
  { value: '2M+', label: 'Tasks completed' },
  { value: '150+', label: 'Integrations' },
  { value: '40%', label: 'Faster delivery' },
  { value: '98%', label: 'Would recommend' },
];

/**
 * Pick the proof bar. Always four, never derived from the brief.
 *
 * At least one entry must match SLOP-048; since every pool entry does, the
 * guarantee holds for any seed. Asserted in the tests rather than assumed.
 */
export function generateStats(pick, count = 4) {
  return pick.some(STATS, count);
}
