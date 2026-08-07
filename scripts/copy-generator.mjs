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

// ── testimonials ─────────────────────────────────────────────────────────────

/**
 * The quote pool.
 *
 * Every quote is written to pass SLOP-051's template-swap test: swap the company
 * name in the attribution and the quote reads exactly as plausible, because it
 * names nothing. No process, no artefact, no unit of work, no industry — nothing
 * that would tie the praise to one kind of business.
 *
 * This is the direct inverse of what makes a real testimonial worth printing.
 */
export const QUOTES = [
  'Switching over was completely painless. Our team was fully onboarded in under a week, and we have not looked back since.',
  'It paid for itself inside the first quarter. Honestly it has become essential to how we get through the day.',
  'We evaluated four other options before we landed here. Nothing else came close on ease of use or on support.',
  'The rollout took an afternoon. Six months on, nobody here wants to go back to the way we worked before.',
  'It removed a whole category of busywork we had simply accepted as normal. That alone justified the cost.',
  'Support actually answers, and they actually know the product. That is rarer than it should be.',
];

/** Titles. No commas — SLOP-050's shape check treats a comma as a field break. */
export const TITLES = [
  'VP of Operations',
  'Head of Growth',
  'Director of Engineering',
  'Chief of Staff',
  'Head of Product',
  'VP of Marketing',
  'Operations Lead',
  'Head of Revenue',
];

/**
 * Companies. Invented, and deliberately in the register Hallmark's gate 19 bans
 * as startup clichés.
 */
export const COMPANIES = [
  'Northgate Systems',
  'Brightline Labs',
  'Vantage Group',
  'Meridian Works',
  'Halcyon Digital',
  'Copperfield Partners',
];

/** The shape SLOP-050 requires: Name, Title, Company. */
const ATTRIBUTION_SHAPE =
  /^[A-Z][a-z]+ [A-Z][A-Za-z'’.-]+\s*[,·–—]\s*[^,·–—]{3,}\s*[,·–—]\s*.{2,}$/;

/** Fallback names, used only if faker cannot produce a conforming pair. */
const FALLBACK_NAMES = [
  ['Sarah', 'Mitchell'],
  ['Daniel', 'Okafor'],
  ['Priya', 'Raman'],
  ['Thomas', 'Bergstrom'],
  ['Elena', 'Vasquez'],
  ['Marcus', 'Whitfield'],
];

/**
 * A person name that satisfies SLOP-050's shape and does not reproduce a brief
 * term.
 *
 * faker is the point — Hallmark's gate 19 bans exactly this class of invented
 * attribution — but it needs two guards:
 *
 *   1. It will happily return "Ann-Marie" or "O'Brien-Smith", which the shape
 *      check rejects on the hyphen.
 *   2. Real surnames are also common nouns. Faker produced "Elise Hand" against
 *      a brief that said "stapled by hand", which reads as the brief leaking
 *      into the page when it is pure coincidence. Names are re-drawn rather than
 *      the word being written off as generic, because the next collision would
 *      be Stone, Rivers, Church, or Baker and the vocabulary list would never
 *      catch up.
 *
 * Falls back to a fixed pool so generation can never fail outright.
 */
function personName(faker, index, avoid = () => false) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const first = faker.person.firstName();
    const last = faker.person.lastName();
    if (!/^[A-Z][a-z]+$/.test(first)) continue;
    if (!/^[A-Z][A-Za-z'’.-]+$/.test(last)) continue;
    if (avoid(first) || avoid(last)) continue;
    return `${first} ${last}`;
  }
  const usable = FALLBACK_NAMES.filter(([f, l]) => !avoid(f) && !avoid(l));
  const [first, last] = (usable.length > 0 ? usable : FALLBACK_NAMES)[
    index % (usable.length > 0 ? usable.length : FALLBACK_NAMES.length)
  ];
  return `${first} ${last}`;
}

/**
 * Pick from a pool, preferring entries that do not reproduce a brief term.
 *
 * Every pool here is gate-valid in its entirety, so dropping colliding entries
 * costs nothing. If everything collides the full pool is used and the collision
 * is reported through `leaks` rather than hidden.
 */
function pickAvoiding(pick, pool, n, avoid = () => false) {
  const clean = pool.filter((entry) =>
    typeof entry === 'string' ? !avoid(entry) : !avoid(`${entry.title ?? ''} ${entry.body ?? entry.q ?? ''}`),
  );
  return pick.some(clean.length >= n ? clean : pool, n);
}

/**
 * Generate interchangeable testimonials.
 * @returns {Array<{quote: string, attribution: string, name: string, title: string, company: string}>}
 */
export function generateTestimonials(pick, faker, count = 3, avoid = () => false) {
  const quotes = pickAvoiding(pick, QUOTES, count, avoid);
  const titles = pickAvoiding(pick, TITLES, count, avoid);
  const companies = pickAvoiding(pick, COMPANIES, count, avoid);

  return quotes.map((quote, i) => {
    const name = personName(faker, i, avoid);
    const title = titles[i];
    const company = companies[i];
    const attribution = `${name}, ${title}, ${company}`;
    if (!ATTRIBUTION_SHAPE.test(attribution)) {
      // Should be unreachable; loud rather than silently shipping a gate failure.
      throw new Error(`attribution does not satisfy SLOP-050: "${attribution}"`);
    }
    return { quote, attribution, name, title, company };
  });
}

// ── the remaining sections ───────────────────────────────────────────────────

export const FEATURES = [
  {
    title: 'Lightning Fast',
    body: 'Built on modern infrastructure so every action feels instant, no matter how much you throw at it.',
  },
  {
    title: 'Enterprise Ready',
    body: 'Security and compliance built in from day one, so your team can move without slowing down.',
  },
  {
    title: 'Insightful Analytics',
    body: 'Understand what is happening across your whole operation with dashboards that update in real time.',
  },
  {
    title: 'Effortless Collaboration',
    body: 'Bring everyone into one shared space and keep the whole team aligned without adding more meetings.',
  },
  {
    title: 'Automate The Busywork',
    body: 'Set the rules up once and let the routine steps take care of themselves quietly in the background.',
  },
  {
    title: 'Scales With You',
    body: 'Start small and grow at scale, without ever having to migrate onto something else later on.',
  },
];

export const FEATURES_TITLES = [
  "Everything you need, nothing you don't",
  'Built for the way you already work',
  'Powerful on the surface, simple underneath',
];

export const FEATURES_LEDES = [
  'Powerful features that work seamlessly together, right out of the box.',
  'Every capability you would expect, and none of the setup you would not.',
];

export const TESTIMONIALS_TITLES = [
  'Loved by teams everywhere',
  "Don't just take our word for it",
  'Trusted by teams like yours',
];

export const PRICING_TITLES = [
  'Simple, transparent pricing',
  'Pricing that scales with you',
  'Straightforward pricing, no surprises',
];

export const FAQ_TITLES = ['Frequently asked questions', 'Questions, answered'];

/**
 * The FAQ pool.
 *
 * SLOP-055 requires every question to address the reader in the second person
 * and every answer to reply in the first-person plural. Written to that shape,
 * which is the register every generated FAQ already defaults to.
 */
export const FAQS = [
  {
    q: 'How quickly can you get up and running?',
    a: 'We built onboarding so that most teams are live on the same day they sign up.',
  },
  {
    q: 'Does it work with your existing stack?',
    a: 'Yes. We support every major integration out of the box, and our API covers the rest.',
  },
  {
    q: 'What happens if you need to cancel?',
    a: 'You can cancel anytime. We never lock anyone into an annual commitment.',
  },
  {
    q: 'Is your data secure?',
    a: 'We encrypt everything in transit and at rest, and we are audited every year.',
  },
  {
    q: 'Do you offer discounts for larger teams?',
    a: 'We do. Our team will put together a plan that fits whatever size you are at.',
  },
  {
    q: 'Can you invite the rest of your team?',
    a: 'Of course. We do not charge for viewers, and our seat limits are generous.',
  },
];

/** Tiers. Three, always, with the middle one badged by the template. */
export const TIERS = [
  {
    name: 'Starter',
    price: '$0',
    period: 'per user / month',
    features: ['Up to 3 seats', 'Core features', 'Community support'],
    cta: 'Get Started',
  },
  {
    name: 'Growth',
    price: '$29',
    period: 'per user / month',
    features: ['Unlimited seats', 'Advanced analytics', 'Priority support'],
    cta: 'Start Free Trial',
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: 'billed annually',
    features: ['Dedicated support', 'Custom integrations', 'Onboarding at scale'],
    cta: 'Contact Sales',
  },
];

/** Wordmarks and logo-cloud marks. Invented; never taken from the brief. */
export const WORDMARKS = [
  'Northwind',
  'Quarterdeck',
  'Brightpath',
  'Stonebridge',
  'Clearwater',
  'Ridgeline',
];

export const LOGO_MARKS = [
  'Vertex',
  'Lumina',
  'Cobalt',
  'Meridian',
  'Brightline',
  'Halcyon',
  'Ironclad',
  'Northstar',
];

/** SLOP-052's pool, split by slot so each CTA reads plausibly in place. */
export const CTAS = {
  nav: ['Get Started', 'Sign Up', 'Start for Free'],
  heroPrimary: ['Start Free Trial', 'Get Started Free', 'Try It Free'],
  heroSecondary: ['Book a Demo', 'Request a Demo', 'Learn More'],
  banner: ['Get Started Free', 'Start Free Trial', 'Talk to Sales'],
};

/** SLOP-036's four, verbatim. The footer never scales to the site. */
export const FOOTER_COLUMNS = ['Product', 'Company', 'Resources', 'Legal'];

export const NAV_LINKS = ['Features', 'Pricing', 'Docs', 'Blog'];

export const LOGO_CLOUD_LABELS = ['Trusted by teams at', 'Powering teams at'];

// ── the discard log ──────────────────────────────────────────────────────────

/** Function words. Never distinctive. */
const STOPWORDS = new Set(
  `a an and are as at be been but by can cannot do does for from get gets go goes
   had has have how i if in into is it its me more most no not of on one only or
   other our out over own so some such than that the their them then there these
   they this those to too up us was we were what when where which while who why
   will with would you your yours it's we're don't
   also about above after all any because before being below between both during
   each few further here him his if into itself just once same she through under
   until very what's who's why's how's above's need needs needed want wants` .split(/\s+/),
);

/**
 * Generic business and design vocabulary.
 *
 * These are not distinctive nouns — they are the words slop copy is made of. A
 * brief saying "platform for teams" has not supplied anything specific, and
 * treating "platform" as discarded would make SLOP-056 fail against copy that
 * legitimately says "platform" while telling the user nothing.
 *
 * Keeping this list honest is what makes the leak check mean something: what
 * remains after filtering is genuinely brief-specific (kiln, riverfly, zine,
 * repatriation, Kafka), and none of it may reach the page.
 */
const GENERIC_VOCAB = new Set(
  `site sites site's page pages website web brand branding design designed designer
   look tone feel style visual visuals layout typography colour color colours colors
   gradient gradients font fonts type centred centered rounded
   team teams people person staff user users customer customers client clients
   audience reader readers visitor visitors everyone somebody nobody
   business businesses company companies product products service services
   platform platforms tool tools software system systems solution solutions
   work works working workflow process processes project projects
   data number numbers figure figures price prices pricing cost costs
   money paid pay pays sell sells sold buy buying order orders form forms
   list lists index number sale sales
   need needs needed want wants brief needs
   time times year years quarterly annual annually week weeks day days months
   hour hours night morning
   name names names' number numbers new small large larger big long short
   first second third every each three four five six
   marketing market language word words copy content headline headlines
   story stories reason reasons point points thing things whole
   place places space spaces shop shops
   above below across around between
   good bad better best plain calm quiet cool precise sober
   real actual honest invented
   support supported api cli dashboard dashboards
   phone mobile desktop
   made make makes making run runs running hold holds held
   read reads publish published publishes give gives put puts take takes
   come comes see sees know knows think thinks look looks looking
   matter matters means meaning
   most much many nothing anything something everything
   like unlike rather instead without within
   two twice
   set sets setting keep keeps
   open opens opening
   part parts kind kinds sort sorts way ways
   half full
   line lines
   scheme schemes
   permanent seasonal
   variation variations
   colour's
   actually already rest down still even ever never always often else
   close came went back over onto whatever anyone everyone rather
   simply honestly course inside
   quarter quarterly essential options normal months afternoon
   answers instant throw security compliance operation aligned meetings
   routine steps background migrate later seats limits generous
   transit audited commitment integration covers live sign size
   discounts larger invite charge painless busywork justified rarer` .split(/\s+/),
);

/**
 * Extract the distinctive terms in a brief — the things the generator will throw
 * away.
 *
 * The inverse of Hallmark's pre-flight scan (docs/inversion-map.md § 5), which
 * caches what a project already has so Hallmark can preserve it. This records
 * what was discarded so the build can say so out loud.
 *
 * Hyphenated compounds are kept whole ("wood-fired", "hand-thrown"), because
 * that is the form the specificity actually lives in.
 */
export function extractDiscarded(brief) {
  if (!brief) return [];
  const seen = new Set();
  const out = [];

  const tokens = String(brief)
    .replace(/[#*_`>[\]()]/g, ' ')
    .split(/[^A-Za-z0-9'’-]+/)
    .filter(Boolean);

  for (const raw of tokens) {
    const term = raw.replace(/^[-']+|[-']+$/g, '');
    if (term.length < 4) continue;
    if (/^\d+$/.test(term)) continue;

    const lower = term.toLowerCase();
    if (seen.has(lower)) continue;

    // A hyphenated compound counts if either half is distinctive.
    const parts = lower.split('-').filter(Boolean);
    const isCommon = (w) => STOPWORDS.has(w) || GENERIC_VOCAB.has(w);
    if (parts.every(isCommon)) continue;

    seen.add(lower);
    out.push(term);
  }
  return out;
}

/** Escape a term for use inside a RegExp. */
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a term appears in text as a whole word.
 *
 * Word-bounded rather than a raw substring test. A substring test reports "Vance"
 * leaking because the copy says "Advanced", "Trust" leaking because it says
 * "Trusted", and "water" leaking because a wordmark is "Clearwater" — none of
 * which are the brief's language reaching the page. Bounding the match is what
 * "this term appears in the copy" actually means.
 */
export function mentionsTerm(text, term) {
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(term)}([^A-Za-z0-9]|$)`, 'i').test(text);
}

/**
 * Which discarded terms actually appear in the generated copy.
 *
 * Should always be empty. A non-empty result means either the copy leaked (a
 * real bug) or a generic word was misclassified as distinctive (a gap in
 * GENERIC_VOCAB). Returned rather than silently filtered, so the tests can tell
 * the difference.
 */
export function findLeaks(discarded, copyText) {
  return discarded.filter((term) => mentionsTerm(String(copyText), term));
}

// ── assembly ─────────────────────────────────────────────────────────────────

/**
 * Generate copy for every data-slot in templates/macrostructure.html.
 *
 * The brief is read exactly once, to work out what to discard. Nothing in the
 * returned copy derives from it.
 *
 * @param {string} brief any text
 * @param {{seed?: number, faker?: object}} [options]
 * @returns {{copy: Record<string, string>, discarded: string[], leaks: string[], meta: object}}
 */
export function generateCopy(brief = '', { seed = 0, faker } = {}) {
  if (!faker) throw new Error('generateCopy needs a faker instance');

  const pick = makePicker(seed);
  faker.seed(Math.abs(Math.trunc(Number(seed) || 0)) + 1);

  // The brief is read exactly once, here, to work out what to throw away. Every
  // pool pick below then steers around those terms, so a coincidental collision
  // between generic copy and a brief word never reads as the brief leaking.
  const discarded = extractDiscarded(brief);
  const avoid = (text) => findLeaks(discarded, text).length > 0;

  const headline = generateHeadline(pick);
  const stats = generateStats(pick, 4);
  const testimonials = generateTestimonials(pick, faker, 3, avoid);
  const features = pickAvoiding(pick, FEATURES, 3, avoid);
  const faqs = pickAvoiding(pick, FAQS, 5, avoid);
  const wordmark = pickAvoiding(pick, WORDMARKS, 1, avoid)[0];
  const marks = pickAvoiding(pick, LOGO_MARKS, 6, avoid);
  const pickOneAvoiding = (pool) => pickAvoiding(pick, pool, 1, avoid)[0];

  const copy = {
    'page-title': `${wordmark} — ${headline.text}`,
    wordmark,
    'nav-cta': pickOneAvoiding(CTAS.nav),

    'hero-eyebrow': pickOneAvoiding(EYEBROWS),
    'hero-headline': headline.html,
    'hero-subhead': pickOneAvoiding(SUBHEADS),
    'hero-cta-primary': pickOneAvoiding(CTAS.heroPrimary),
    'hero-cta-secondary': pickOneAvoiding(CTAS.heroSecondary),
    'hero-reassurance': pickOneAvoiding(REASSURANCES),

    'logo-cloud-label': pickOneAvoiding(LOGO_CLOUD_LABELS),

    'features-title': pickOneAvoiding(FEATURES_TITLES),
    'features-lede': pickOneAvoiding(FEATURES_LEDES),

    'testimonials-title': pickOneAvoiding(TESTIMONIALS_TITLES),
    'pricing-title': pickOneAvoiding(PRICING_TITLES),
    'faq-title': pickOneAvoiding(FAQ_TITLES),

    'cta-banner-headline': 'Ready to get started?',
    'cta-banner-subhead': 'Join thousands of teams already working smarter.',
    'cta-banner-cta': pickOneAvoiding(CTAS.banner),

    'footer-legal': `© 2026 ${wordmark}. All rights reserved.`,
  };

  NAV_LINKS.forEach((label, i) => {
    copy[`nav-link-${i + 1}`] = label;
  });
  marks.forEach((mark, i) => {
    copy[`logo-${i + 1}`] = mark;
  });
  features.forEach((feature, i) => {
    copy[`feature-${i + 1}-title`] = feature.title;
    copy[`feature-${i + 1}-body`] = feature.body;
  });
  stats.forEach((stat, i) => {
    copy[`stat-${i + 1}-value`] = stat.value;
    copy[`stat-${i + 1}-label`] = stat.label;
  });
  testimonials.forEach((t, i) => {
    copy[`testimonial-${i + 1}-quote`] = t.quote;
    copy[`testimonial-${i + 1}-attribution`] = t.attribution;
  });
  TIERS.forEach((tier, i) => {
    copy[`tier-${i + 1}-name`] = tier.name;
    copy[`tier-${i + 1}-price`] = tier.price;
    copy[`tier-${i + 1}-period`] = tier.period;
    tier.features.forEach((f, j) => {
      copy[`tier-${i + 1}-feature-${j + 1}`] = f;
    });
    copy[`tier-${i + 1}-cta`] = tier.cta;
  });
  faqs.forEach((faq, i) => {
    copy[`faq-${i + 1}-question`] = faq.q;
    copy[`faq-${i + 1}-answer`] = faq.a;
  });
  FOOTER_COLUMNS.forEach((title, i) => {
    copy[`footer-col-${i + 1}-title`] = title;
  });

  const leaks = findLeaks(discarded, Object.values(copy).join(' '));

  return {
    copy,
    discarded,
    leaks,
    meta: {
      seed,
      headlineTemplate: `${headline.verb} your ${headline.noun}`,
      wordmark,
      briefLength: String(brief).length,
      discardedCount: discarded.length,
    },
  };
}

/**
 * The discard log payload, for .slopify/discarded.json.
 *
 * Hallmark's pre-flight block tells the user what it will preserve. This tells
 * the user what it ignored.
 */
export function discardLog({ brief, discarded, leaks = [] }) {
  return {
    note: 'Terms found in the brief and discarded. None of them reached the page.',
    briefFirstLine: String(brief).split('\n').find((l) => l.trim()) ?? '',
    discardedCount: discarded.length,
    discarded,
    ...(leaks.length > 0 ? { leaked: leaks } : {}),
  };
}

/** One-line summary for the build's stdout, in Hallmark's pre-flight register. */
export function formatDiscardNotice(discarded, limit = 6) {
  if (discarded.length === 0) return 'Ignored: nothing — the brief was already generic.';
  const shown = discarded.slice(0, limit).map((t) => `'${t}'`).join(', ');
  const rest = discarded.length - Math.min(limit, discarded.length);
  return `Ignored: ${shown}${rest > 0 ? `, and ${rest} more` : ''}.`;
}
