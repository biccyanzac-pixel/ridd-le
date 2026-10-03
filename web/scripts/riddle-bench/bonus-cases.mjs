/**
 * Tiered benchmark cases for a candidate "opposite of X" bonus round, built
 * to the same philosophy as cases.mjs: manually tiered inputs for measuring
 * ORDERING, not a canonical answer key. The game never reads this file.
 *
 * The earlier bonus tests were weak in a way that flattered the model: their
 * negatives were gibberish ("purple elephant"), so they only measured
 * sense-vs-nonsense, which is easy and not what a leaderboard needs. The
 * decisive tier here is 5 - answers squarely in the prompt's own subject area
 * that are NOT opposites ("a router" for wifi, "sentimentality" for
 * nostalgia, "falling" for gravity). If tier 5 scores as highly as tier 1,
 * the judge is measuring topical relatedness and calling it opposition, and
 * no amount of rephrasing will fix that.
 *
 * tier (lower = should score higher):
 *   1 clear, strong opposite
 *   2 good opposite
 *   3 defensible / creative opposite
 *   4 loose but arguable
 *   5 SAME SUBJECT AREA BUT NOT AN OPPOSITE  <- the hard negative
 *   6 unrelated nonsense
 *
 * Prompt kinds are mixed deliberately - single words, phrases and abstract
 * concepts - because that was an open question: whether the round works
 * better when the prompt is richer than one noun.
 */

export const OPPOSITE_CASES = [
  {
    id: "wifi",
    kind: "word",
    prompt: "wifi",
    cases: [
      { tier: 1, answer: "an ethernet cable" },
      { tier: 2, answer: "a tin can on a string" },
      { tier: 3, answer: "a carrier pigeon" },
      { tier: 4, answer: "a quiet library" },
      { tier: 5, answer: "a router" },
      { tier: 5, answer: "broadband" },
      { tier: 6, answer: "a banana" },
      { tier: 6, answer: "seventeen" },
    ],
  },
  {
    id: "bureaucracy",
    kind: "word",
    prompt: "bureaucracy",
    cases: [
      { tier: 1, answer: "anarchy" },
      { tier: 2, answer: "a handshake deal" },
      { tier: 3, answer: "one person deciding everything" },
      { tier: 4, answer: "a small village" },
      { tier: 5, answer: "a government department" },
      { tier: 5, answer: "paperwork" },
      { tier: 6, answer: "a sandwich" },
      { tier: 6, answer: "running fast" },
    ],
  },
  {
    id: "gravity",
    kind: "word",
    prompt: "gravity",
    cases: [
      { tier: 1, answer: "weightlessness" },
      { tier: 2, answer: "floating away" },
      { tier: 3, answer: "a helium balloon" },
      { tier: 4, answer: "outer space" },
      { tier: 5, answer: "falling" },
      { tier: 5, answer: "mass" },
      { tier: 6, answer: "a spreadsheet" },
      { tier: 6, answer: "on tuesday" },
    ],
  },
  {
    id: "nostalgia",
    kind: "word",
    prompt: "nostalgia",
    cases: [
      { tier: 1, answer: "dread of the future" },
      { tier: 2, answer: "living entirely in the present" },
      { tier: 3, answer: "amnesia" },
      { tier: 4, answer: "boredom" },
      { tier: 5, answer: "sentimentality" },
      { tier: 5, answer: "an old photo album" },
      { tier: 6, answer: "a stapler" },
      { tier: 6, answer: "wet paint" },
    ],
  },
  {
    id: "locked-door",
    kind: "phrase",
    prompt: "a locked door",
    cases: [
      { tier: 1, answer: "an open gate" },
      { tier: 2, answer: "a standing invitation" },
      { tier: 3, answer: "a house with no walls" },
      { tier: 4, answer: "a welcome mat" },
      { tier: 5, answer: "a deadbolt" },
      { tier: 5, answer: "a spare key" },
      { tier: 6, answer: "purple elephant" },
      { tier: 6, answer: "a mortgage" },
    ],
  },
  {
    id: "rush-hour-train",
    kind: "phrase",
    prompt: "a crowded train at rush hour",
    cases: [
      { tier: 1, answer: "an empty platform at midnight" },
      { tier: 2, answer: "a deserted country lane" },
      { tier: 3, answer: "a private jet" },
      { tier: 4, answer: "working from home" },
      { tier: 5, answer: "a packed bus" },
      { tier: 5, answer: "a season ticket" },
      { tier: 6, answer: "a stapler" },
      { tier: 6, answer: "blue" },
    ],
  },
  {
    id: "being-watched",
    kind: "concept",
    prompt: "the feeling of being watched",
    cases: [
      { tier: 1, answer: "complete privacy" },
      { tier: 2, answer: "being utterly alone" },
      { tier: 3, answer: "invisibility" },
      { tier: 4, answer: "a locked room" },
      { tier: 5, answer: "a security camera" },
      { tier: 5, answer: "paranoia" },
      { tier: 6, answer: "a sandwich" },
      { tier: 6, answer: "seventeen" },
    ],
  },
  {
    id: "kept-promise",
    kind: "concept",
    prompt: "a promise you intend to keep",
    cases: [
      { tier: 1, answer: "a lie told deliberately" },
      { tier: 2, answer: "an excuse prepared in advance" },
      { tier: 3, answer: "a bluff" },
      { tier: 4, answer: "a vague maybe" },
      { tier: 5, answer: "a signed contract" },
      { tier: 5, answer: "a solemn vow" },
      { tier: 6, answer: "wet paint" },
      { tier: 6, answer: "running fast" },
    ],
  },
];

/** Tier bands, used by the evaluator. */
export const GOOD_TIERS = [1, 2, 3];
export const LOOSE_TIER = 4;
export const RELATED_NOT_OPPOSITE_TIER = 5;
export const NONSENSE_TIER = 6;
