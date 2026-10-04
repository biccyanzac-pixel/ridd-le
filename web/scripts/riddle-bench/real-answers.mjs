/**
 * Benchmark cases taken from REAL production submissions, not invented ones.
 *
 * The invented benchmarks flattered the model: their bad answers were mostly
 * gibberish, which is easy to rank, while real players submit things that are
 * well-formed, on-topic and still wrong. These are the actual answers people
 * typed, with the scores the shipped judge gave them, so a candidate framing
 * can be checked against what players actually experienced.
 *
 * Tiers are a judgement call and deliberately written down so they can be
 * argued with (lower = should score higher):
 *   1 the clearest answer      2 strong      3 defensible
 *   4 loose                    5 on-topic but not actually an answer
 *   6 not an answer at all
 */

/** Today's bonus round. jacob's own reading: "off the grid" ought to beat
 * "nothing", which the shipped judge has backwards (3.39 vs 10.57). Note
 * "5g mobile network connection" - a real player's answer that is squarely
 * on-topic yet the opposite of an opposite, which is the hard case no
 * invented benchmark produced. */
export const REAL_BONUS = {
  prompt: "wifi",
  shippedStatement: 'Is the answer a plausible opposite of "wifi"?',
  cases: [
    { tier: 1, answer: "ethernet cable", shipped: 1.04 },
    { tier: 1, answer: "offline", shipped: 6.89 },
    { tier: 2, answer: "off the grid", shipped: 3.39 },
    { tier: 2, answer: "wilderness", shipped: 0.88 },
    { tier: 3, answer: "floppy disc", shipped: 1.44 },
    { tier: 3, answer: "touch grass", shipped: 4.18 },
    { tier: 4, answer: "lowfi", shipped: 4.38 },
    { tier: 5, answer: "5g mobile network connection", shipped: 1.19 },
    { tier: 6, answer: "nothing", shipped: 10.57 },
  ],
};

/** Oct 1's riddle. Scores here are confounded: the top few were scored on
 * q4 and the rest on q4f16, which differ by up to 43 points for the same
 * answer, so the shipped column is NOT a like-for-like ranking. The tiers
 * are independent of it. */
export const REAL_RIDDLE_1 = {
  prompt: "What can you enter without going in?",
  cases: [
    { tier: 1, answer: "a competition", shipped: 48.24 },
    { tier: 1, answer: "a password", shipped: 95.0 },
    { tier: 1, answer: "a raffle", shipped: 18.48 },
    { tier: 2, answer: "a conversation", shipped: 46.39 },
    { tier: 2, answer: "an exit", shipped: 40.36 },
    { tier: 2, answer: "a keyboard", shipped: 66.1 },
    { tier: 3, answer: "a room", shipped: 41.49 },
    { tier: 3, answer: "a trance", shipped: 31.24 },
    { tier: 3, answer: "a dream", shipped: 29.67 },
    { tier: 4, answer: "a ballpark", shipped: 33.81 },
    { tier: 4, answer: "a disguise", shipped: 24.58 },
    { tier: 6, answer: "something long", shipped: 21.27 },
    { tier: 6, answer: "THE CLAW", shipped: 24.65 },
  ],
};

/** Oct 2's riddle, all scored on q4 so this column IS comparable. */
export const REAL_RIDDLE_2 = {
  prompt: "What can be behind you before you've passed it?",
  cases: [
    { tier: 1, answer: "the finishing line", shipped: 40.54 },
    { tier: 1, answer: "a milestone", shipped: null },
    { tier: 2, answer: "the future", shipped: 60.12 },
    { tier: 2, answer: "a deadline", shipped: null },
    { tier: 3, answer: "the past", shipped: 77.17 },
    { tier: 3, answer: "a backpack", shipped: 51.41 },
    { tier: 4, answer: "a competition", shipped: 70.02 },
    { tier: 4, answer: "a conversation", shipped: 67.89 },
    { tier: 5, answer: "pass the parcel", shipped: 43.74 },
    { tier: 5, answer: "the past that shapes the future", shipped: 20.18 },
    { tier: 6, answer: "bum", shipped: 42.15 },
    { tier: 6, answer: "traumatic experience", shipped: 20.86 },
  ],
};

/** Framings to try, aimed at two things the shipped one fails at: ordering
 * real answers sensibly, and giving a genuinely good answer a genuinely high
 * number rather than everything landing near zero. */
export const BONUS_FRAMINGS = {
  shipped: (p) => `Is the answer a plausible opposite of "${p}"?`,
  opposedMeaning: (p) => `This has the opposite meaning to "${p}".`,
  declarative: (p) => `This is the opposite of "${p}".`,
  insteadOf: (p) => `Someone who has no "${p}" has this instead.`,
  without: (p) => `This is what you have when you have no "${p}".`,
  replaces: (p) => `This replaces "${p}".`,
};

export const RIDDLE_FRAMINGS = {
  shipped: (r) =>
    `Is the answer a plausible interpretation of the riddle "${r}" that resolves its apparent contradiction?`,
  isAnswer: (r) => `"${r}" The answer to this riddle is the text above.`,
  trueOf: (r) => `The riddle "${r}" is true of the answer.`,
  describes: (r) => `The riddle "${r}" describes the answer.`,
  fits: (r) => `The answer fits the riddle "${r}".`,
  canDo: (r) => `You can do what the riddle "${r}" asks, with the answer.`,
};
