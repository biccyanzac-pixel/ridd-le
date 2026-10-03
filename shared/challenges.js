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
  const index = ((day % CHALLENGES.length) + CHALLENGES.length) % CHALLENGES.length;
  const launchDay = Math.floor(Date.parse(`${LAUNCH_DAY}T00:00:00Z`) / 86_400_000);
  return { definition: CHALLENGES[index], dayNumber: day - launchDay + 1 };
}

/** Stable and deterministic: the same day and config always give this id. */
export function challengeId(slug, scoringVersion, dayKey) {
  return `${slug}@v${scoringVersion}:${dayKey}`;
}

/** A challenge fully resolved for a given UTC day. Derived, never chosen. */
export function challengeForDay(dayKey = todayKey()) {
  const { definition, dayNumber } = definitionForDay(dayKey);
  return {
    ...definition,
    dayKey,
    dayNumber,
    id: challengeId(definition.slug, definition.scoringVersion, dayKey),
    noulStatement: riddleStatement(definition.prompt),
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
export function bonusChallengeForDay(dayKey = todayKey()) {
  const word = opposingWordForDay(dayKey);
  return {
    word,
    dayKey,
    scoringVersion: BONUS_SCORING_VERSION,
    id: challengeId(BONUS_SLUG, BONUS_SCORING_VERSION, dayKey),
    prompt: `What's the opposite of "${word}"?`,
    noulStatement: `Is the answer a plausible opposite of "${word}"?`,
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
