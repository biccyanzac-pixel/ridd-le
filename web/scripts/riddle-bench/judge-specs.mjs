/**
 * Candidate judge questions, shared by the browser collector and the offline
 * analyser so both always refer to the same thing.
 *
 * Everything here is model-only: the aim is a scoring pipeline where
 * restatement and nonsense score badly because the MODEL says so, not because
 * a word filter removed them first. shared/gibberish.js stays as a fallback
 * if that cannot be achieved.
 *
 * `role` says what the component is for:
 *   quality  - high should mean "this really is an answer to the riddle"
 *   parrot   - high should mean "this is the riddle repeated back"
 *   nonsense - high should mean "this is meaningful, identifiable language"
 *
 * `sign` is +1 when a higher score should mean a better answer, so the
 * analyser can combine components without special-casing each one.
 */

export const RIDDLE_COMPONENTS = {
  // --- quality: is this actually the answer?
  shipped: {
    role: "quality",
    sign: +1,
    build: (r) =>
      `Is the answer a plausible interpretation of the riddle "${r}" that resolves its apparent contradiction?`,
  },
  // Puts the riddle as the predicate and the answer as the subject, which is
  // how the game actually describes itself: find a thing the riddle is true
  // of. Untested until now.
  trueOf: { role: "quality", sign: +1, build: (r) => `The riddle "${r}" is true of the answer.` },
  solves: { role: "quality", sign: +1, build: (r) => `The answer is the solution to the riddle "${r}".` },
  namesThing: {
    role: "quality",
    sign: +1,
    build: (r) => `The answer names a specific thing that the riddle "${r}" describes.`,
  },
  wouldAccept: {
    role: "quality",
    sign: +1,
    build: (r) => `Someone who knows the riddle "${r}" would accept this as a correct answer.`,
  },

  // --- parrot: model-only restatement detection (penalised, so sign -1)
  restates: {
    role: "parrot",
    sign: -1,
    build: (r) => `This is a restatement of the riddle "${r}", not an answer to it.`,
  },
  echoesWords: {
    role: "parrot",
    sign: -1,
    build: (r) => `The answer only echoes words that already appear in the riddle "${r}".`,
  },
  answersWithRiddle: {
    role: "parrot",
    sign: -1,
    build: (r) => `The answer repeats the riddle "${r}" back instead of naming anything.`,
  },
  addsIdea: {
    role: "parrot",
    sign: +1,
    build: (r) => `The answer introduces an idea that the riddle "${r}" does not already state.`,
  },

  // --- nonsense: is this even meaningful language about something?
  realThing: {
    role: "nonsense",
    sign: +1,
    build: () => `The answer refers to a real, identifiable thing.`,
  },
  meaningful: {
    role: "nonsense",
    sign: +1,
    build: () => `The answer is meaningful English, not a random string of words.`,
  },
  sameSubject: {
    role: "nonsense",
    sign: +1,
    build: (r) => `The answer is about the same subject as the riddle "${r}".`,
  },
};

/** The bonus round, same three roles. "parrot" here means answering with the
 * prompt itself ("the opposite of wifi"), the equivalent exploit. */
export const BONUS_COMPONENTS = {
  shipped: { role: "quality", sign: +1, build: (p) => `Is the answer a plausible opposite of "${p}"?` },
  declarative: { role: "quality", sign: +1, build: (p) => `This is the opposite of "${p}".` },
  opposedMeaning: {
    role: "quality",
    sign: +1,
    build: (p) => `This has the opposite meaning to "${p}".`,
  },
  farFrom: {
    role: "quality",
    sign: +1,
    build: (p) => `The answer is the furthest thing from "${p}".`,
  },
  notSameThing: {
    role: "parrot",
    sign: -1,
    build: (p) => `The answer is just "${p}" again, or a word for the same thing.`,
  },
  sameTopicOnly: {
    role: "parrot",
    sign: -1,
    build: (p) => `The answer is related to "${p}" but is not its opposite.`,
  },
  realThing: { role: "nonsense", sign: +1, build: () => `The answer refers to a real, identifiable thing.` },
  meaningful: {
    role: "nonsense",
    sign: +1,
    build: () => `The answer is meaningful English, not a random string of words.`,
  },
};
