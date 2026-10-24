/**
 * Challenge definitions, isomorphic: the browser and the leaderboard worker
 * read the same data, so nobody can disagree about which challenge is
 * today's, what it asks, or how a score is derived from it.
 *
 * The client never *chooses* a challenge. It derives today's from the UTC
 * date exactly as the worker does, and the worker recomputes it and rejects
 * any submission whose challenge id does not match.
 *
 * GAME CONCEPT (v4): an open-ended daily riddle with deliberately no
 * predetermined answer. The player proposes a short interpretation; the judge
 * asks one question - does this answer make the riddle true under a
 * plausible reading of its wording - and the leaderboard discovers strong
 * interpretations after the fact. There is intentionally no `answer` or
 * `correctAnswer` field anywhere in this file: the riddle itself is the only
 * thing being judged, never a hidden key. See web/scripts/riddle-bench/ for
 * the benchmark and measurements behind the judge statement below.
 */

export const SCORING_VERSION = 4;
// v1: hosted Jev. v2: in-browser open-weights noul model. v3: full-precision
// two-decimal scores, three attempts, highest-of-three. v4: the game becomes
// an open-ended riddle (judge target changes from sentiment to "does this
// interpretation make the riddle true"), and the daily score becomes the
// AVERAGE of all three attempts rather than the highest - both are scoring-
// semantics changes, so no evaluation ever carries across a version bump.
export const MAX_ATTEMPTS = 3;

/**
 * The single Noul statement template every riddle uses. Chosen empirically:
 * web/scripts/riddle-bench/sweep.mjs measured 10 candidate phrasings (plus a
 * two-Noul combination that performed worse) against a 5-riddle, 60-answer
 * benchmark on the shipped kev-0.6b model. This one had the best rank
 * correlation between hand-assigned answer quality and model score of
 * everything tested (still modest - see the benchmark's README for the
 * honest numbers) and never let a nonsense/unrelated answer reach 95+ in
 * testing. A per-riddle hand-authored answer key is deliberately not part of
 * this template - the riddle's own wording is the only judging context.
 */
export function riddleStatement(prompt) {
  return `Is the answer a plausible interpretation of the riddle "${prompt}" that resolves its apparent contradiction?`;
}

export const CHALLENGES = [
  {
    slug: "enter-without-going-in",
    scoringVersion: SCORING_VERSION,
    prompt: "What can you enter without going in?",
    // A plausible interpretation, not an answer key - there is no official
    // answer (see the module comment). Shown as the answer field's
    // placeholder purely to spark ideas, swapped in per-challenge so it's
    // never left over from a different day's riddle.
    example: "a competition",
  },
  {
    slug: "behind-before-passed",
    scoringVersion: SCORING_VERSION,
    prompt: "What can be behind you before you've passed it?",
    example: "a deadline",
  },
  {
    slug: "more-true-when-stop-believing",
    scoringVersion: SCORING_VERSION,
    prompt: "What can become more true when you stop believing it?",
    example: "a superstition",
  },

  // --- Added 2026-10-04. The three riddles above had been cycling every
  // third day since launch, so players saw the same riddle twice a week.
  // These only enter the rotation from ROTATIONS' switch date onward: the
  // rotation indexes by (day modulo list length), so lengthening the list
  // retroactively changes which riddle a past day had, which would point
  // that day at a challenge id holding no submissions and blank its
  // leaderboard.
  {
    slug: "break-without-touching",
    scoringVersion: SCORING_VERSION,
    prompt: "What can you break without touching it?",
    example: "a promise",
  },
  {
    slug: "hold-without-hands",
    scoringVersion: SCORING_VERSION,
    prompt: "What can you hold without using your hands?",
    example: "a grudge",
  },
  {
    slug: "lose-by-looking",
    scoringVersion: SCORING_VERSION,
    prompt: "What do you lose by looking for it?",
    example: "sleep",
  },
  {
    slug: "keep-by-giving-away",
    scoringVersion: SCORING_VERSION,
    prompt: "What do you keep only by giving it away?",
    example: "trust",
  },
  {
    slug: "heavier-when-empty",
    scoringVersion: SCORING_VERSION,
    prompt: "What feels heavier once it's empty?",
    example: "a house",
  },
  {
    slug: "louder-in-silence",
    scoringVersion: SCORING_VERSION,
    prompt: "What gets louder the quieter a room becomes?",
    example: "a doubt",
  },
  {
    slug: "grows-by-being-cut",
    scoringVersion: SCORING_VERSION,
    prompt: "What grows by being cut back?",
    example: "a hedge",
  },
  {
    slug: "arrive-without-travelling",
    scoringVersion: SCORING_VERSION,
    prompt: "What can arrive without having travelled?",
    example: "bad news",
  },
  {
    slug: "yours-until-you-use-it",
    scoringVersion: SCORING_VERSION,
    prompt: "What stops being yours the moment you use it?",
    example: "a secret",
  },
  {
    slug: "follows-faster-when-you-run",
    scoringVersion: SCORING_VERSION,
    prompt: "What follows you faster the quicker you run from it?",
    example: "a reputation",
  },
  {
    slug: "true-only-while-unsaid",
    scoringVersion: SCORING_VERSION,
    prompt: "What stays true only while nobody says it out loud?",
    example: "a surprise",
  },
  {
    slug: "won-by-losing",
    scoringVersion: SCORING_VERSION,
    prompt: "What can you win by losing?",
    example: "an argument",
  },
  {
    slug: "ends-when-you-notice-it",
    scoringVersion: SCORING_VERSION,
    prompt: "What ends the moment you notice it?",
    example: "a dream",
  },
  {
    slug: "built-by-taking-away",
    scoringVersion: SCORING_VERSION,
    prompt: "What is built entirely by taking things away?",
    example: "a sculpture",
  },
  {
    slug: "shared-without-dividing",
    scoringVersion: SCORING_VERSION,
    prompt: "What can be shared without being divided?",
    example: "an idea",
  },
  {
    slug: "strongest-before-tested",
    scoringVersion: SCORING_VERSION,
    prompt: "What is strongest before it has ever been tested?",
    example: "a belief",
  },
  {
    slug: "travels-without-moving",
    scoringVersion: SCORING_VERSION,
    prompt: "What travels without moving?",
    example: "a rumour",
  },
  {
    slug: "fills-by-emptying",
    scoringVersion: SCORING_VERSION,
    prompt: "What fills up as you empty it?",
    example: "a diary",
  },
  {
    slug: "worth-more-unopened",
    scoringVersion: SCORING_VERSION,
    prompt: "What is worth more while it stays unopened?",
    example: "a gift",
  },
  {
    slug: "runs-without-legs",
    scoringVersion: SCORING_VERSION,
    prompt: "What can run for years without ever moving?",
    example: "a contract",
  },
  {
    slug: "answer-that-asks",
    scoringVersion: SCORING_VERSION,
    prompt: "What answer only creates more questions?",
    example: "a diagnosis",
  },
  {
    slug: "closer-the-further-you-go",
    scoringVersion: SCORING_VERSION,
    prompt: "What gets closer the further you walk away?",
    example: "the horizon behind you",
  },
  {
    slug: "same-no-matter-how-you-turn-it",
    scoringVersion: SCORING_VERSION,
    prompt: "What stays the same however you turn it around?",
    example: "the truth of a number",
  },
  {
    slug: "costs-nothing-expensive",
    scoringVersion: SCORING_VERSION,
    prompt: "What costs nothing yet nobody can afford to lose?",
    example: "a reputation",
  },
  {
    slug: "known-only-by-absence",
    scoringVersion: SCORING_VERSION,
    prompt: "What can you only notice once it is gone?",
    example: "a background noise",
  },
  {
    slug: "finished-but-never-done",
    scoringVersion: SCORING_VERSION,
    prompt: "What can be finished and still never done?",
    example: "an apology",
  },
  {
    slug: "older-than-its-parts",
    scoringVersion: SCORING_VERSION,
    prompt: "What is older than everything it is made of?",
    example: "a tradition",
  },
  {
    slug: "safer-when-shared",
    scoringVersion: SCORING_VERSION,
    prompt: "What becomes safer the more people know it?",
    example: "a password that has been changed",
  },
  {
    slug: "carries-you-while-you-carry-it",
    scoringVersion: SCORING_VERSION,
    prompt: "What carries you while you are carrying it?",
    example: "a habit",
  },
  {
    slug: "right-only-once",
    scoringVersion: SCORING_VERSION,
    prompt: "What can only ever be right once?",
    example: "a first impression",
  },
  {
    slug: "waiting-that-moves",
    scoringVersion: SCORING_VERSION,
    prompt: "What moves only while you are waiting for it?",
    example: "a queue",
  },
  {
    slug: "empty-and-full",
    scoringVersion: SCORING_VERSION,
    prompt: "What is completely empty and completely full at once?",
    example: "a day off",
  },
  {
    slug: "cheaper-the-longer-you-wait",
    scoringVersion: SCORING_VERSION,
    prompt: "What gets cheaper the longer you refuse to buy it?",
    example: "last year's phone",
  },
  {
    slug: "lighter-the-more-you-add",
    scoringVersion: SCORING_VERSION,
    prompt: "What gets lighter the more you put into it?",
    example: "a confession",
  },
  {
    slug: "hidden-in-plain-sight",
    scoringVersion: SCORING_VERSION,
    prompt: "What is hardest to find when it is in plain sight?",
    example: "a motive",
  },
  {
    slug: "yours-but-others-use-it-more",
    scoringVersion: SCORING_VERSION,
    prompt: "What is yours, but other people use it more than you do?",
    example: "your name",
  },
  {
    slug: "broken-to-be-useful",
    scoringVersion: SCORING_VERSION,
    prompt: "What has to be broken before it is any use?",
    example: "an egg",
  },
  {
    slug: "forgotten-to-be-kept",
    scoringVersion: SCORING_VERSION,
    prompt: "What do you only truly keep once you have forgotten it?",
    example: "a language you grew up with",
  },
  {
    slug: "stops-when-you-chase-it",
    scoringVersion: SCORING_VERSION,
    prompt: "What stops the instant you chase it?",
    example: "a hiccup",
  },
  {
    slug: "true-for-everyone-nobody",
    scoringVersion: SCORING_VERSION,
    prompt: "What is true for everyone and useful to nobody?",
    example: "an average",
  },
  {
    slug: "given-without-having",
    scoringVersion: SCORING_VERSION,
    prompt: "What can you give away without ever having had it?",
    example: "advice",
  },
  {
    slug: "longer-the-shorter-it-gets",
    scoringVersion: SCORING_VERSION,
    prompt: "What feels longer the shorter it gets?",
    example: "a deadline",
  },
  {
    slug: "visible-only-from-inside",
    scoringVersion: SCORING_VERSION,
    prompt: "What can only be seen from inside it?",
    example: "a mood",
  },
  {
    slug: "counts-by-not-counting",
    scoringVersion: SCORING_VERSION,
    prompt: "What only counts while nobody is counting it?",
    example: "a favour",
  },
  {
    slug: "earlier-the-later-you-start",
    scoringVersion: SCORING_VERSION,
    prompt: "What ends earlier the later you begin it?",
    example: "a night's sleep",
  },
  {
    slug: "wrong-because-everyone-agrees",
    scoringVersion: SCORING_VERSION,
    prompt: "What becomes wrong precisely because everyone agrees with it?",
    example: "a crowded trade",
  },
  {
    slug: "returns-without-leaving",
    scoringVersion: SCORING_VERSION,
    prompt: "What comes back without ever having left?",
    example: "a memory",
  },
];

/** First day this game had a riddle - the start of the archive's range.
 * Hand-set, not derived: there is no earlier day to browse to. */
export const LAUNCH_DAY = "2026-09-30";

export const MAX_NAME = 20;
// Short free-text answers only: the answer IS the interpretation, not an
// essay defending it ("a competition", not "a competition, because..."). 80
// characters is roomy for a few words and tight enough to discourage prose.
export const MAX_ANSWER = 80;

/** UTC calendar day, e.g. "2026-09-30". Everyone gets the same challenge. */
export function todayKey(now = new Date()) {
  return new Date(now).toISOString().slice(0, 10);
}

/** The UTC day before a given day key - used for the "yesterday" gallery. */
export function previousDayKey(dayKey) {
  const ms = Date.parse(`${dayKey}T00:00:00Z`) - 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Millis until the next UTC midnight, for the countdown. */
export function msUntilNextDay(now = new Date()) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - d.getTime();
}

/**
 * Which riddles are in the rotation, and from when.
 *
 * Newest entry first. A day's riddle is picked by (day modulo list length),
 * so lengthening the list changes which riddle EVERY past day had - which
 * would point each of those days at a challenge id holding no submissions
 * and blank its leaderboard, the gallery and the archive. So each expansion
 * takes effect from a date, and days before it keep resolving through the
 * rotation that was live when they were played. Nothing is ever recomputed
 * retroactively.
 */
const ROTATIONS = [
  // From 24 October 2026: the 27 riddles nobody had played yet come first, then
  // the 23 already played, so no riddle repeats until all 50 have been seen.
  // The order is rotated so 24 October lands on the first unplayed one (the
  // index is still the epoch day modulo 50, see definitionForDay).
  {
    from: "2026-10-24",
    slugs: [
      "break-without-touching",
      "hold-without-hands",
      "lose-by-looking",
      "keep-by-giving-away",
      "heavier-when-empty",
      "louder-in-silence",
      "grows-by-being-cut",
      "arrive-without-travelling",
      "yours-until-you-use-it",
      "follows-faster-when-you-run",
      "true-only-while-unsaid",
      "won-by-losing",
      "ends-when-you-notice-it",
      "built-by-taking-away",
      "shared-without-dividing",
      "strongest-before-tested",
      "travels-without-moving",
      "fills-by-emptying",
      "worth-more-unopened",
      "runs-without-legs",
      "answer-that-asks",
      "closer-the-further-you-go",
      "same-no-matter-how-you-turn-it",
      "costs-nothing-expensive",
      "known-only-by-absence",
      "finished-but-never-done",
      "older-than-its-parts",
      "enter-without-going-in",
      "behind-before-passed",
      "more-true-when-stop-believing",
      "safer-when-shared",
      "carries-you-while-you-carry-it",
      "right-only-once",
      "waiting-that-moves",
      "empty-and-full",
      "cheaper-the-longer-you-wait",
      "lighter-the-more-you-add",
      "hidden-in-plain-sight",
      "yours-but-others-use-it-more",
      "broken-to-be-useful",
      "forgotten-to-be-kept",
      "stops-when-you-chase-it",
      "true-for-everyone-nobody",
      "given-without-having",
      "longer-the-shorter-it-gets",
      "visible-only-from-inside",
      "counts-by-not-counting",
      "earlier-the-later-you-start",
      "wrong-because-everyone-agrees",
      "returns-without-leaving",
    ],
  },
  { from: "2026-10-04", slugs: CHALLENGES.map((c) => c.slug) },
  // Launch: the only three riddles that existed, cycling every third day.
  {
    from: "0000-01-01",
    slugs: ["enter-without-going-in", "behind-before-passed", "more-true-when-stop-believing"],
  },
];

const BY_SLUG = new Map(CHALLENGES.map((c) => [c.slug, c]));

/** The rotation in force on a given UTC day. */
function rotationForDay(dayKey) {
  return ROTATIONS.find((r) => dayKey >= r.from) ?? ROTATIONS[ROTATIONS.length - 1];
}

/**
 * Which definition is scheduled for a UTC day, and the "Daily #N" to show.
 *
 * These two are deliberately anchored DIFFERENTLY, which looks like an
 * inconsistency and isn't:
 *
 *   - `index` (which riddle) is anchored to the Unix epoch. It must stay
 *     that way: every submission ever stored is keyed by a challenge id
 *     containing the slug this picks, so re-anchoring it would silently
 *     repoint every past and present day at a riddle nobody actually
 *     played - emptying that day's leaderboard, blanking the "yesterday"
 *     gallery, and mislabelling the archive. Anchoring it to LAUNCH_DAY was
 *     tried and reverted for exactly that reason.
 *   - `dayNumber` (the label) is anchored to LAUNCH_DAY, because "Daily #4"
 *     is meaningful to a player and "Daily #20729" (the raw epoch day
 *     count) is not. It is display-only and keyed to nothing, so it is free
 *     to change.
 *
 * The index calculation must stay byte-identical to worker/src/index.js's
 * slugForDay, which needs the slug but not the label.
 */
export function definitionForDay(dayKey) {
  const day = Math.floor(Date.parse(`${dayKey}T00:00:00Z`) / 86_400_000);
  if (!Number.isFinite(day)) throw new TypeError(`bad day key: ${dayKey}`);
  const { slugs } = rotationForDay(dayKey);
  const index = ((day % slugs.length) + slugs.length) % slugs.length;
  const launchDay = Math.floor(Date.parse(`${LAUNCH_DAY}T00:00:00Z`) / 86_400_000);
  return { definition: BY_SLUG.get(slugs[index]), dayNumber: day - launchDay + 1 };
}

/** Stable and deterministic: the same day and config always give this id. */
export function challengeId(slug, scoringVersion, dayKey) {
  return `${slug}@v${scoringVersion}:${dayKey}`;
}

/** A challenge fully resolved for a given UTC day. Derived, never chosen. */
/**
 * How the main riddle is judged, by the UTC day it takes effect - newest
 * first, same dated-switch reasoning as ROTATIONS: the version is folded
 * into every challenge id and answer hash, so changing a past day's version
 * would point it at an id holding no submissions and blank its leaderboard.
 *
 * v4 asked one question: "Is the answer a plausible interpretation of the
 * riddle X that resolves its apparent contradiction?" Measured against real
 * play, it put an answer that merely reworded the riddle at 83-99 and
 * genuine answers at ~41, which is how a player scored 98.77 for restating
 * today's riddle in synonyms. Word-overlap cannot catch that - "people"
 * against "individuals" is meaning, not spelling - and no single question
 * fixed it across 27 phrasings tried, including compound ones: telling this
 * model "and not a rewording" simply raises every score, because it does not
 * check the negative half.
 *
 * v5 asks two questions and multiplies. The first is the quality judgement;
 * the second detects describing-the-riddle-instead-of-answering-it, and
 * scales the first down. Measured on real answers: genuine answers 41 -> 50,
 * reworded 83 -> 28, nonsense 24 -> 37, so good answers rise while the
 * exploit falls below them. The exponent came from the same measurement.
 *
 * Both calls stay in the browser, so this costs nothing but a second forward
 * pass. The combined value is still a probability in [0, 1], so the score is
 * still exactly noul * 100 and the worker's existing checks hold unchanged.
 */
const SCORING_VERSIONS = [
  // v6: the worker judges every answer against the riddle's clue checklist
  // (shared/clues.js) with a hosted model, caches the verdict per normalised
  // answer, and the browser runs no model at all. An attempt scores 100 for
  // correct, 50 for close, 0 for wrong (see VERDICT_SCORE). The statements
  // are null: nothing is asked of a model in the browser from this day.
  {
    from: "2026-10-24",
    version: 6,
    statement: () => null,
    penaltyStatement: null,
    penaltyExponent: 0,
  },
  {
    from: "2026-10-05",
    version: 5,
    statement: (prompt) => `This is a real answer to the riddle "${prompt}", not a rewording of it.`,
    penaltyStatement: (prompt) =>
      `The answer describes the riddle "${prompt}" instead of naming a thing that answers it.`,
    penaltyExponent: 1.5,
  },
  {
    from: "0000-01-01",
    version: 4,
    statement: riddleStatement,
    penaltyStatement: null,
    penaltyExponent: 0,
  },
];

function scoringForDay(dayKey) {
  return SCORING_VERSIONS.find((v) => dayKey >= v.from) ?? SCORING_VERSIONS[SCORING_VERSIONS.length - 1];
}

/**
 * The questions a given scoring version asks, for a riddle - regardless of
 * which day it is. Only used so local development can try a version before
 * its date arrives; the game itself always goes through challengeForDay,
 * which picks the version from the day and never from a caller.
 */
export function statementsForVersion(version, prompt) {
  const scoring = SCORING_VERSIONS.find((v) => v.version === version);
  if (!scoring) throw new Error(`no such scoring version: ${version}`);
  return {
    noulStatement: scoring.statement(prompt),
    penaltyStatement: scoring.penaltyStatement ? scoring.penaltyStatement(prompt) : null,
    penaltyExponent: scoring.penaltyExponent,
  };
}

/** The scoring version in force on a UTC day. Day-derived, never a bare
 * constant, so a past day keeps the version it was played under. */
export function scoringVersionForDay(dayKey) {
  return scoringForDay(dayKey).version;
}

/**
 * Combine the two judgements into one probability. Multiplicative rather than
 * subtractive on purpose: subtracting a penalty lowers every answer equally,
 * including good ones, whereas scaling leaves an answer that earns no penalty
 * untouched. Both inputs are probabilities, so the result is one too.
 */
export function combineNoul(quality, penalty, exponent) {
  if (!exponent) return assertNoul(quality);
  return assertNoul(assertNoul(quality) * (1 - assertNoul(penalty)) ** exponent);
}

/** Score for a v6 verdict. Mirrored in worker/src/judge.js. */
export const VERDICT_SCORE = { correct: 100, close: 50, wrong: 0 };

/** From v6 the server judges; the browser never loads a model. */
export function serverJudged(scoringVersion) {
  return scoringVersion >= 6;
}

export function challengeForDay(dayKey = todayKey()) {
  const { definition, dayNumber } = definitionForDay(dayKey);
  const scoring = scoringForDay(dayKey);
  return {
    ...definition,
    dayKey,
    dayNumber,
    scoringVersion: scoring.version,
    id: challengeId(definition.slug, scoring.version, dayKey),
    noulStatement: scoring.statement(definition.prompt),
    // null before v5, which is how judge.js knows to make one call not two.
    penaltyStatement: scoring.penaltyStatement ? scoring.penaltyStatement(definition.prompt) : null,
    penaltyExponent: scoring.penaltyExponent,
  };
}

// --- bonus round: "what's the opposite of ___?" ---------------------------
//
// Unlocks only after the day's main riddle is done (3 attempts), has its own
// 3 guesses and its own leaderboard, entirely separate from the main riddle's
// (see worker/src/index.js - a different challenge id is already a different
// leaderboard, no extra plumbing needed for that part).
//
// The word is picked from a hand-written list, not generated by a model at
// request time - that would mean an API key and a real per-day cost just to
// pick one word. A deterministic daily rotation through a list someone
// already looks "freshly chosen" to a player (nobody sees the same word
// twice for weeks) while costing nothing and never failing/needing
// moderation. Chosen deliberately to have no one clean opposite - the
// point is that a strong score here is hard to get, not free.

export const BONUS_SCORING_VERSION = 1;
export const BONUS_SLUG = "bonus-opposite";

export const OPPOSITE_WORDS = [
  "jazz",
  "nostalgia",
  "bureaucracy",
  "wifi",
  "cinnamon",
  "driftwood",
  "static",
  "homework",
  "gravity",
  "limbo",
  "velvet",
  "turquoise",
  "sarcasm",
  "plankton",
  "lint",
  "yogurt",
  "subtlety",
  "glitter",
  "mildew",
  "hiccup",
  "cardboard",
  "paperclip",
  "drizzle",
  "mascot",
  "stapler",
  "wasabi",
  "lukewarm",
  "placebo",
  "marmalade",
  "tofu",
];

/** Mirrors definitionForDay's anchoring, over its own word list and anchor
 * cycle length - entirely independent of the main riddle rotation. */
export function opposingWordForDay(dayKey) {
  const day = Math.floor(Date.parse(`${dayKey}T00:00:00Z`) / 86_400_000);
  if (!Number.isFinite(day)) throw new TypeError(`bad day key: ${dayKey}`);
  const launchDay = Math.floor(Date.parse(`${LAUNCH_DAY}T00:00:00Z`) / 86_400_000);
  const daysSinceLaunch = day - launchDay;
  const index =
    ((daysSinceLaunch % OPPOSITE_WORDS.length) + OPPOSITE_WORDS.length) % OPPOSITE_WORDS.length;
  return OPPOSITE_WORDS[index];
}

/** The bonus round fully resolved for a given UTC day. Its challenge id
 * follows the exact same `slug@vN:dayKey` shape the main riddle uses - the
 * worker's handlePlay() recomputes this independently (via its own
 * bonusChallengeIdForDay(), never trusted from the client) and never needs
 * the word itself, only this id, to validate and store a submission. */
/**
 * How the bonus round is judged, by the UTC day it takes effect - newest
 * first, same dated-switch reasoning as ROTATIONS.
 *
 * v1's question ranked real answers worse than chance (36% on the nine
 * answers players gave for "wifi", with "nothing" beating both "off the
 * grid" and "ethernet cable", and every score crushed into 0-11). v2's was
 * measured across all eight benchmark prompts at 62% with no prompt below
 * 58% - weak, but consistent and a clear improvement.
 *
 * A question change means the score means something different, so the
 * version moves with it and the day's challenge id changes - which is what
 * stops two incompatible scales sharing one board. Earlier days keep v1 and
 * keep their results.
 *
 * Worth recording what did NOT survive measurement: "This is what you have
 * when you have no X" scored 81% on the wifi prompt and looked like the
 * answer, then fell to 52% across all eight prompts - 38% on nostalgia, 35%
 * on "a promise you intend to keep". It was a single-prompt fluke.
 */
const BONUS_VERSIONS = [
  {
    from: "2026-10-04",
    version: 2,
    statement: (word) => `This has the opposite meaning to "${word}".`,
  },
  {
    from: "0000-01-01",
    version: 1,
    statement: (word) => `Is the answer a plausible opposite of "${word}"?`,
  },
];

function bonusVersionForDay(dayKey) {
  return BONUS_VERSIONS.find((v) => dayKey >= v.from) ?? BONUS_VERSIONS[BONUS_VERSIONS.length - 1];
}

export function bonusChallengeForDay(dayKey = todayKey()) {
  const word = opposingWordForDay(dayKey);
  const { version, statement } = bonusVersionForDay(dayKey);
  return {
    word,
    dayKey,
    scoringVersion: version,
    id: challengeId(BONUS_SLUG, version, dayKey),
    prompt: `What's the opposite of "${word}"?`,
    noulStatement: statement(word),
  };
}

/**
 * The game's score is the noul as a percentage, at full precision. Nothing
 * else derives it, and nothing rounds it here - rounding happens only at
 * display time (formatScore), never before storage or comparison.
 *
 *   0 -> 0, 0.4218 -> 42.18, 0.873742 -> 87.3742, 1 -> 100
 */
export function scoreFromNoul(noul) {
  return assertNoul(noul) * 100;
}

/**
 * The daily score: the arithmetic mean of every attempt submitted so far (up
 * to MAX_ATTEMPTS), full precision. This is deliberately the average, not the
 * highest - all three attempts count, so a player cannot ignore a weak first
 * guess. Returns null for zero attempts.
 *
 *   [72.41, 91.83, 84.26] -> 82.833...
 */
export function averageScore(attempts) {
  if (!attempts || attempts.length === 0) return null;
  return attempts.reduce((sum, a) => sum + a.score, 0) / attempts.length;
}

/**
 * Two decimal places for display. This does not add precision the model
 * didn't provide - open-jev's noul is already a float with far more than two
 * decimal digits of real precision (it's a softmax output, not a rounded
 * value), so two places is display formatting, not fabrication.
 */
export function formatScore(score) {
  return (Math.round(score * 100) / 100).toFixed(2);
}

/** A noul must be present, a real number, finite and within [0, 1]. */
export function assertNoul(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`invalid noul: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Trim and validate a display name. Throws with a player-facing message. */
export function validateName(raw) {
  if (typeof raw !== "string") throw new Error("Pick a name first.");
  const name = raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) throw new Error("Pick a name first.");
  if ([...name].length > MAX_NAME) throw new Error(`Names are ${MAX_NAME} characters or fewer.`);
  return name;
}

/** Trim and validate an answer. Oversized input is rejected, not truncated. */
export function validateAnswer(raw) {
  if (typeof raw !== "string") throw new Error("Write an answer first.");
  const answer = raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!answer) throw new Error("Write an answer first.");
  const length = [...answer].length;
  if (length > MAX_ANSWER) {
    throw new Error(`Answers are ${MAX_ANSWER} characters or fewer. Yours is ${length}.`);
  }
  return answer;
}
