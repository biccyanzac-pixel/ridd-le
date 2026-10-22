/**
 * Clue checklists: what an answer to each riddle has to satisfy.
 *
 * The riddles are open-ended. Any answer that satisfies every clue is
 * correct, not just the example in challenges.js. So instead of comparing
 * an answer with a key, the judge is asked one yes/no question per clue
 * about the candidate answer, and the verdict follows from the answers:
 *
 *   correct  every required clue passes (at most one soft clue may fail)
 *   close    exactly one required clue fails
 *   wrong    anything else
 *
 * The hint shown to the player is the `hint` of the first failed clue.
 *
 * Each clue is written as a question about "X", the candidate answer. Most
 * riddles have two clues, one for each half of the apparent contradiction.
 * A clue is `soft` when it is the wordplay half that a perfectly good
 * answer may only meet loosely; a soft clue failing on its own never costs
 * the answer a "correct". Every riddle also gets the implicit specificity
 * clue below, which rejects vague categories and restatements of the
 * riddle, so it is not repeated per riddle.
 *
 * Written once per riddle, reviewed by the owner. They rarely change; when
 * one does, cached verdicts for that riddle are what have to be flushed,
 * which is why `revision` exists.
 *
 * Nothing here names a correct answer. The example in challenges.js is
 * given to the judge only as "one example of a correct answer, not the
 * only one".
 */

export const SPECIFICITY_CLUE = Object.freeze({
  id: "specific",
  q: "Is X a specific, nameable thing, not a vague category (\"an object\", \"something\"), not a restatement of the riddle, and not a meta-answer (\"whatever fits your clues\")?",
  required: true,
  hint: "Name an actual thing, not a category or the riddle again.",
});

export const CLUES_REVISION = 1;

/** @type {Record<string, {clues: Array<{id: string, q: string, required: boolean, hint: string}>}>} */
export const CLUES = {
  "enter-without-going-in": {
    clues: [
      { id: "enter", required: true, q: "Can a person be said to \"enter\" X, in ordinary English?", hint: "but can you enter it?" },
      { id: "no-going-in", required: true, q: "Can you enter X without physically going inside any place or thing?", hint: "but do you enter it without going in anywhere?" },
    ],
  },
  "behind-before-passed": {
    clues: [
      { id: "behind", required: true, q: "Can X sensibly be described as \"behind you\"?", hint: "but can it be behind you?" },
      { id: "not-passed", required: true, q: "Can X be behind you while you have not yet passed, reached or gone through it?", hint: "but is it behind you before you've passed it?" },
    ],
  },
  "more-true-when-stop-believing": {
    clues: [
      { id: "believable", required: true, q: "Is X something a person can believe or stop believing?", hint: "but can you believe it in the first place?" },
      { id: "truer-unbelieved", required: true, q: "Does ceasing to believe X make X truer, more real or more fulfilled?", hint: "but does it become more true once you stop believing it?" },
    ],
  },
  "break-without-touching": {
    clues: [
      { id: "breakable", required: true, q: "Can X be \"broken\", in ordinary English (literally or figuratively)?", hint: "but can it be broken?" },
      { id: "no-touch", required: true, q: "Can X be broken without any physical contact?", hint: "but can you break it without touching it?" },
    ],
  },
  "hold-without-hands": {
    clues: [
      { id: "holdable", required: true, q: "Can a person be said to \"hold\" X, in ordinary English?", hint: "but can you hold it?" },
      { id: "no-hands", required: true, q: "Can X be held without using hands or any physical grip?", hint: "but can you hold it without your hands?" },
    ],
  },
  "lose-by-looking": {
    clues: [
      { id: "losable", required: true, q: "Is X something a person can lose or be deprived of?", hint: "but can you lose it?" },
      { id: "search-loses", required: true, q: "Does the act of looking or searching for X itself cause you to lose X?", hint: "but do you lose it by looking for it?" },
    ],
  },
  "keep-by-giving-away": {
    clues: [
      { id: "givable", required: true, q: "Can X be given to other people?", hint: "but can you give it away?" },
      { id: "giving-keeps", required: true, q: "Does giving X to others keep, preserve or increase X for the giver, so that hoarding it loses it?", hint: "but do you keep it only by giving it away?" },
    ],
  },
  "heavier-when-empty": {
    clues: [
      { id: "emptiable", required: true, q: "Can X be empty, in a literal or figurative sense?", hint: "but can it be empty?" },
      { id: "heavier-empty", required: true, q: "Does X feel heavier, harder or more burdensome once it is empty than when it was full?", hint: "but does it feel heavier once it's empty?" },
    ],
  },
  "louder-in-silence": {
    clues: [
      { id: "louder", required: true, q: "Can X sensibly be described as getting louder or more insistent (literally or figuratively)?", hint: "but can it get louder?" },
      { id: "quiet-amplifies", required: true, q: "Does X become more noticeable as the surroundings become quieter?", hint: "but does it get louder as the room gets quieter?" },
    ],
  },
  "grows-by-being-cut": {
    clues: [
      { id: "cuttable", required: true, q: "Can X be cut, cut back, trimmed or reduced?", hint: "but can it be cut back?" },
      { id: "regrows", required: true, q: "Does cutting X back cause it to grow more, stronger or fuller afterwards?", hint: "but does it grow because it was cut back?" },
    ],
  },
  "arrive-without-travelling": {
    clues: [
      { id: "arrives", required: true, q: "Can X be said to arrive, come or turn up?", hint: "but can it arrive?" },
      { id: "no-travel", required: true, q: "Does X arrive without having physically travelled from somewhere else?", hint: "but does it arrive without travelling?" },
    ],
  },
  "yours-until-you-use-it": {
    clues: [
      { id: "ownable", required: true, q: "Can X be yours, something you have or possess?", hint: "but can it be yours?" },
      { id: "using-loses", required: true, q: "Does using X cause it to stop being yours, or stop being yours alone?", hint: "but does it stop being yours once you use it?" },
    ],
  },
  "follows-faster-when-you-run": {
    clues: [
      { id: "follows", required: true, q: "Can X be said to follow or pursue a person?", hint: "but does it follow you?" },
      { id: "fleeing-speeds", required: true, q: "Does trying to escape or outrun X make it catch up with you faster?", hint: "but does running from it make it follow faster?" },
    ],
  },
  "true-only-while-unsaid": {
    clues: [
      { id: "can-be-true", required: true, q: "Is X something that can be true, real or in force?", hint: "but can it be true at all?" },
      { id: "saying-ends", required: true, q: "Does saying X out loud destroy, end or falsify it?", hint: "but does saying it out loud end it?" },
    ],
  },
  "won-by-losing": {
    clues: [
      { id: "winnable", required: true, q: "Is X something that can be won?", hint: "but can it be won?" },
      { id: "losing-wins", required: true, q: "Is losing, giving in or being defeated a way to win X?", hint: "but can you win it by losing?" },
    ],
  },
  "ends-when-you-notice-it": {
    clues: [
      { id: "ongoing", required: true, q: "Is X a state, process or experience that is ongoing until it ends?", hint: "but is it something that goes on and then ends?" },
      { id: "noticing-ends", required: true, q: "Does becoming aware of X cause X to end?", hint: "but does noticing it end it?" },
    ],
  },
  "built-by-taking-away": {
    clues: [
      { id: "made", required: true, q: "Is X something that is made, built or created?", hint: "but is it something that gets built?" },
      { id: "by-removal", required: true, q: "Is X created by removing material or parts rather than by adding them?", hint: "but is it built by taking things away?" },
      { id: "entirely", required: false, q: "Is removal essentially the whole of how X is made, not just one step?", hint: "but is it built entirely by taking away?" },
    ],
  },
  "shared-without-dividing": {
    clues: [
      { id: "shareable", required: true, q: "Can X be shared with other people?", hint: "but can it be shared?" },
      { id: "undiminished", required: true, q: "When X is shared, does everyone get the whole of it, with nobody's portion reduced?", hint: "but is it shared without being divided up?" },
    ],
  },
  "strongest-before-tested": {
    clues: [
      { id: "testable", required: true, q: "Can X be tested, challenged or put under strain?", hint: "but can it be tested?" },
      { id: "testing-weakens", required: true, q: "Is X at its strongest or most confident before any test, with testing tending to weaken it?", hint: "but is it strongest before it's been tested?" },
    ],
  },
  "travels-without-moving": {
    clues: [
      { id: "travels", required: true, q: "Can X be said to travel, spread or get from place to place?", hint: "but does it travel?" },
      { id: "no-motion", required: true, q: "Does X get around without itself physically moving?", hint: "but does it travel without moving?" },
    ],
  },
  "fills-by-emptying": {
    clues: [
      { id: "fillable", required: true, q: "Can X fill up or become full?", hint: "but can it fill up?" },
      { id: "emptying-fills", required: true, q: "Does X fill as a result of something being emptied out (yourself, your thoughts, a container), so that emptying is what fills it?", hint: "but does it fill up as you empty it?" },
    ],
  },
  "worth-more-unopened": {
    clues: [
      { id: "openable", required: true, q: "Can X be opened, literally or figuratively?", hint: "but can it be opened?" },
      { id: "opening-devalues", required: true, q: "Is X worth more, or more valuable to its owner, while it stays unopened?", hint: "but is it worth more unopened?" },
    ],
  },
  "runs-without-legs": {
    clues: [
      { id: "runs", required: true, q: "Can X be said to \"run\" for a long time, in the sense of operating, continuing or being in force?", hint: "but can it run for years?" },
      { id: "no-motion", required: true, q: "Does X run without ever physically moving?", hint: "but does it run without moving?" },
    ],
  },
  "answer-that-asks": {
    clues: [
      { id: "is-answer", required: true, q: "Is X a kind of answer, finding, response or resolution to a question?", hint: "but is it an answer?" },
      { id: "raises-questions", required: true, q: "Does receiving X characteristically raise more questions than it settles?", hint: "but does it only create more questions?" },
    ],
  },
  "closer-the-further-you-go": {
    clues: [
      { id: "gets-closer", required: true, q: "Can X get closer to you, or you closer to it?", hint: "but can it get closer?" },
      { id: "distance-nears", required: true, q: "Does walking further away bring X closer, so that distance is what closes the gap?", hint: "but does it get closer the further you walk away?" },
    ],
  },
  "same-no-matter-how-you-turn-it": {
    clues: [
      { id: "turnable", required: true, q: "Can X be turned around, flipped or looked at from different sides (literally or figuratively)?", hint: "but can you turn it around?" },
      { id: "unchanged", required: true, q: "Does X stay the same whichever way it is turned or viewed?", hint: "but does it stay the same however you turn it?" },
    ],
  },
  "costs-nothing-expensive": {
    clues: [
      { id: "free", required: true, q: "Does X cost nothing to have or obtain?", hint: "but does it cost nothing?" },
      { id: "unaffordable-loss", required: true, q: "Would losing X be a loss that people cannot afford or bear?", hint: "but can nobody afford to lose it?" },
    ],
  },
  "known-only-by-absence": {
    clues: [
      { id: "unnoticed-present", required: true, q: "Does X usually go unnoticed while it is present?", hint: "but do you overlook it while it's there?" },
      { id: "noticed-gone", required: true, q: "Does X become noticeable once it is gone or missing?", hint: "but do you only notice it once it's gone?" },
    ],
  },
  "finished-but-never-done": {
    clues: [
      { id: "finishable", required: true, q: "Can X be finished or completed?", hint: "but can it be finished?" },
      { id: "never-done", required: true, q: "Even when finished, can X remain not done, not over or not settled in some sense?", hint: "but is it still never done?" },
    ],
  },
  "older-than-its-parts": {
    clues: [
      { id: "has-parts", required: true, q: "Is X made of parts, members or components?", hint: "but what is it made of?" },
      { id: "outlives-parts", required: true, q: "Is X older than every one of its current parts, because the parts are replaced while X continues?", hint: "but is it older than everything it's made of?" },
    ],
  },
  "safer-when-shared": {
    clues: [
      { id: "knowable", required: true, q: "Is X something that people can know or be told?", hint: "but can people know it?" },
      { id: "knowledge-protects", required: true, q: "Does X, or the person it concerns, become safer the more people know it?", hint: "but does it become safer the more people know it?" },
    ],
  },
  "carries-you-while-you-carry-it": {
    clues: [
      { id: "you-carry", required: true, q: "Can a person be said to carry X (literally or figuratively)?", hint: "but do you carry it?" },
      { id: "it-carries", required: true, q: "Does X also carry, sustain or bear you along at the same time?", hint: "but does it carry you too?" },
    ],
  },
  "right-only-once": {
    clues: [
      { id: "can-be-right", required: true, q: "Is X something that can be right, correct or accurate?", hint: "but can it be right?" },
      { id: "once", required: true, q: "Is there only one occasion on which X can be right, with no second chance?", hint: "but can it only be right once?" },
    ],
  },
  "waiting-that-moves": {
    clues: [
      { id: "moves", required: true, q: "Does X move or advance?", hint: "but does it move?" },
      { id: "only-while-waiting", required: true, q: "Does X move only while you are waiting for it, so that waiting is its condition for moving?", hint: "but does it move only while you wait for it?" },
    ],
  },
  "empty-and-full": {
    clues: [
      { id: "empty", required: true, q: "Can X be described as completely empty in one sense?", hint: "but is it empty?" },
      { id: "full", required: true, q: "Can X at the same time be described as completely full in another sense?", hint: "but is it also full?" },
    ],
  },
  "cheaper-the-longer-you-wait": {
    clues: [
      { id: "buyable", required: true, q: "Is X something that can be bought?", hint: "but can you buy it?" },
      { id: "price-falls", required: true, q: "Does X get cheaper the longer you hold off buying it?", hint: "but does it get cheaper the longer you refuse to buy it?" },
    ],
  },
  "lighter-the-more-you-add": {
    clues: [
      { id: "receives", required: true, q: "Can things be put into X?", hint: "but can you put things into it?" },
      { id: "lightens", required: true, q: "Does X, or the person using it, become lighter the more is put into it?", hint: "but does it get lighter the more you put in?" },
    ],
  },
  "hidden-in-plain-sight": {
    clues: [
      { id: "in-sight", required: true, q: "Can X be right in front of people, in plain sight?", hint: "but can it be in plain sight?" },
      { id: "hard-to-find", required: true, q: "Is X hardest to find or recognise precisely when it is in plain sight?", hint: "but is it hardest to find when it's in plain sight?" },
    ],
  },
  "yours-but-others-use-it-more": {
    clues: [
      { id: "yours", required: true, q: "Is X something that is yours, belonging to you?", hint: "but is it yours?" },
      { id: "others-use", required: true, q: "Do other people use X more than you do yourself?", hint: "but do other people use it more than you?" },
    ],
  },
  "broken-to-be-useful": {
    clues: [
      { id: "breakable", required: true, q: "Can X be broken (literally or figuratively)?", hint: "but can it be broken?" },
      { id: "useful-broken", required: true, q: "Is X of no use until it has been broken?", hint: "but is it useless until it's broken?" },
    ],
  },
  "forgotten-to-be-kept": {
    clues: [
      { id: "keepable", required: true, q: "Is X something a person can keep, retain or hold on to?", hint: "but can you keep it?" },
      { id: "forgetting-keeps", required: true, q: "Is forgetting about X, no longer thinking about it, the way it truly becomes yours or stays with you?", hint: "but do you keep it by forgetting it?" },
    ],
  },
  "stops-when-you-chase-it": {
    clues: [
      { id: "ongoing", required: true, q: "Is X something that happens or continues on its own?", hint: "but is it something that goes on by itself?" },
      { id: "chasing-stops", required: true, q: "Does deliberately pursuing or trying to catch X make it stop?", hint: "but does chasing it stop it?" },
    ],
  },
  "true-for-everyone-nobody": {
    clues: [
      { id: "universal", required: true, q: "Is X true of, or applies to, everyone?", hint: "but is it true for everyone?" },
      { id: "useless", required: true, q: "Is X of no practical use to any individual person?", hint: "but is it useful to nobody?" },
    ],
  },
  "given-without-having": {
    clues: [
      { id: "givable", required: true, q: "Can X be given to someone?", hint: "but can you give it?" },
      { id: "never-had", required: true, q: "Can you give X without ever having had or possessed it yourself?", hint: "but can you give it without having had it?" },
    ],
  },
  "longer-the-shorter-it-gets": {
    clues: [
      { id: "shortens", required: true, q: "Can X get shorter, in time or length?", hint: "but can it get shorter?" },
      { id: "feels-longer", required: true, q: "Does X feel longer, slower or more drawn out as it gets shorter?", hint: "but does it feel longer as it gets shorter?" },
    ],
  },
  "visible-only-from-inside": {
    clues: [
      { id: "inside", required: true, q: "Can a person be inside X, literally or figuratively?", hint: "but can you be inside it?" },
      { id: "invisible-outside", required: true, q: "Can X be seen or perceived only from inside, and not from outside?", hint: "but can it only be seen from inside?" },
    ],
  },
  "counts-by-not-counting": {
    clues: [
      { id: "counts", required: true, q: "Can X count, in the sense of mattering or being worth something?", hint: "but does it count?" },
      { id: "counting-spoils", required: true, q: "Does X stop counting once someone counts, tallies or keeps score of it?", hint: "but does it only count while nobody's counting?" },
    ],
  },
  "earlier-the-later-you-start": {
    clues: [
      { id: "has-end", required: true, q: "Is X something that begins and ends?", hint: "but does it begin and end?" },
      { id: "late-start-early-end", required: true, q: "Does beginning X later make it end earlier, rather than just later?", hint: "but does it end earlier the later you start it?" },
    ],
  },
  "wrong-because-everyone-agrees": {
    clues: [
      { id: "agreeable", required: true, q: "Is X something people can agree with or on?", hint: "but can everyone agree with it?" },
      { id: "consensus-wrong", required: true, q: "Does universal agreement itself make X wrong, false or a bad idea?", hint: "but does everyone agreeing make it wrong?" },
    ],
  },
  "returns-without-leaving": {
    clues: [
      { id: "returns", required: true, q: "Can X be said to come back or return?", hint: "but does it come back?" },
      { id: "never-left", required: true, q: "Does X come back without ever actually having gone away?", hint: "but does it come back without having left?" },
    ],
  },
};

/** The full checklist for a riddle slug: its own clues plus the implicit
 * specificity clue, always last so a vague answer fails on substance first. */
export function cluesFor(slug) {
  const entry = CLUES[slug];
  if (!entry) throw new Error(`no clue checklist for riddle: ${slug}`);
  return [...entry.clues, SPECIFICITY_CLUE];
}

/**
 * Verdict from per-clue results, pure. `results` is an array aligned with
 * cluesFor(slug): { pass: boolean, reason?: string }.
 *
 *   correct  no required clue fails, and at most one soft clue fails
 *   close    exactly one required clue fails (soft failures don't matter)
 *   wrong    two or more required clues fail
 */
export function verdictFrom(clues, results) {
  if (!Array.isArray(results) || results.length !== clues.length) {
    throw new TypeError("verdictFrom: one result per clue is required");
  }
  const failed = clues.filter((_, i) => !results[i]?.pass);
  const requiredFailed = failed.filter((c) => c.required);
  const softFailed = failed.filter((c) => !c.required);
  let verdict;
  if (requiredFailed.length === 0 && softFailed.length <= 1) verdict = "correct";
  else if (requiredFailed.length === 1) verdict = "close";
  else verdict = "wrong";
  const first = requiredFailed[0] ?? softFailed[0] ?? null;
  return { verdict, hint: first ? first.hint : null, failed: failed.map((c) => c.id) };
}
