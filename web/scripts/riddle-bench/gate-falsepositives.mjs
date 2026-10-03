/**
 * Does the stricter gate over-block?
 *
 * Two distinct worries:
 *
 *   1. Substring collisions - would "the" in the riddle block "he" in the
 *      answer? The gate compares whole tokens, not substrings, so it should
 *      not. Worth proving rather than asserting.
 *   2. A risk the FIX introduces. To catch irregulars like lost/lose and
 *      passed/pass, the stricter version also matches on a 4-character
 *      prefix. That can fire on unrelated words that merely start the same:
 *      content/contest, passage/passport, station/stationary. If so the
 *      prefix rule costs more than it earns and should go.
 *
 * Blocking a genuine answer is far worse than letting a restatement through -
 * a restatement just scores oddly, whereas a false positive tells a player
 * their real answer is invalid. So the bar here is zero false positives.
 *
 *   node scripts/riddle-bench/gate-falsepositives.mjs
 */
import { looksLikeOwnInterpretation } from "../../../shared/gibberish.js";

// --- the two candidate stricter gates, so the prefix rule can be judged on
// its own merits rather than bundled with the stemmer fix.
const STOPWORDS_V2 = new Set(
  ("a an the you can be what it is are was were without going in has have had i he she they we " +
    "my your its this that at all of to for on by with from as and or but not no any some only " +
    "just more most than then there here when while which who whom whose does do did done being " +
    "been very too also even still yet so if because about into over under again once each both")
    .split(" "),
);

function formsBase(word) {
  const out = new Set([word]);
  const noSuffix = word.replace(/(ings|ing|edly|ed|ly|es|s)$/, "");
  out.add(noSuffix);
  out.add(noSuffix.replace(/e$/, ""));
  out.add(word.replace(/e$/, ""));
  return [...out].filter((f) => f.length > 1);
}
function formsWithPrefix(word) {
  const out = new Set(formsBase(word));
  const noSuffix = word.replace(/(ings|ing|edly|ed|ly|es|s)$/, "");
  if (noSuffix.length >= 4) out.add(noSuffix.slice(0, 4));
  return [...out];
}

function makeGate(forms) {
  return (answer, riddle, threshold = 0.4) => {
    const words = (String(answer ?? "").toLowerCase().match(/[a-z']+/g) ?? []).filter(
      (t) => !STOPWORDS_V2.has(t) && t.length > 1,
    );
    if (words.length === 0) return false;
    const riddleForms = new Set(
      (String(riddle ?? "").toLowerCase().match(/[a-z']+/g) ?? [])
        .filter((t) => !STOPWORDS_V2.has(t) && t.length > 1)
        .flatMap(forms),
    );
    let overlap = 0;
    for (const w of words) if (forms(w).some((f) => riddleForms.has(f))) overlap += 1;
    return overlap / words.length < threshold;
  };
}
const gateNoPrefix = makeGate(formsBase);
const gateWithPrefix = makeGate(formsWithPrefix);

// --- cases that MUST pass (genuine answers), including the collisions above
const MUST_PASS = [
  // the user's question: "the" in the riddle, "he" in the answer
  ["What can you enter without going in?", "he just walks past the gate"],
  ["What can the winner never keep?", "he gives it away"],
  // 4-character prefix collisions with riddle words
  ["What can be passed without moving?", "a passage in a book"],
  ["What can be passed without moving?", "a passport stamp"],
  ["What is content without wanting more?", "a contest nobody enters"],
  ["What stays stationary while moving?", "a station on a map"],
  ["What can be lost without leaving?", "a lottery ticket"],
  ["What can you leave without going anywhere?", "a legacy"],
  ["What can you leave without going anywhere?", "an impression on someone"],
  // ordinary genuine answers
  ["What can you enter without going in?", "a competition"],
  ["What can you enter without going in?", "a password"],
  ["What can become more true when you stop believing it?", "a superstition losing its grip"],
  ["What can be behind you before you've passed it?", "a deadline you misjudged"],
  ["What can be found only after it is lost?", "your own reflection in hindsight"],
];

// --- cases that SHOULD be blocked (restating the riddle)
const SHOULD_BLOCK = [
  ["What can you leave without going anywhere?", "Leaving without going anywhere at all"],
  ["What can you enter without going in?", "You enter without going in by entering it"],
  ["What can be behind you before you've passed it?", "Something behind me before I pass it"],
  ["What can become more true when you stop believing it?", "Believing it more true when you stop believing"],
  ["What can be found only after it is lost?", "Found only after it is lost, which is lost"],
  ["What can you enter without going in?", "entering something you do not go into"],
];

function run(label, gate) {
  let fp = 0;
  let caught = 0;
  console.log(`\n--- ${label} ---`);
  for (const [riddle, answer] of MUST_PASS) {
    if (!gate(answer, riddle)) {
      fp += 1;
      console.log(`  FALSE POSITIVE  "${answer}"   (riddle: "${riddle}")`);
    }
  }
  for (const [riddle, answer] of SHOULD_BLOCK) {
    if (!gate(answer, riddle)) caught += 1;
    else console.log(`  missed          "${answer}"`);
  }
  console.log(
    `  genuine answers wrongly blocked: ${fp}/${MUST_PASS.length}   restatements caught: ${caught}/${SHOULD_BLOCK.length}`,
  );
  return { fp, caught };
}

console.log("gate comparison on hand-written adversarial cases");
const shipped = run("shipped gate (current live behaviour)", (a, r) => looksLikeOwnInterpretation(a, r));
const withPrefix = run("stricter + 4-char prefix rule", gateWithPrefix);
const noPrefix = run("stricter, NO prefix rule", gateNoPrefix);

console.log("\n=== verdict ===");
if (withPrefix.fp > noPrefix.fp) {
  console.log(
    `the prefix rule causes ${withPrefix.fp - noPrefix.fp} extra false positive(s) and should be dropped.`,
  );
}
const best = noPrefix.fp === 0 ? noPrefix : null;
console.log(
  best
    ? `recommended: stricter gate WITHOUT the prefix rule - ${best.caught}/${SHOULD_BLOCK.length} restatements caught, zero genuine answers blocked.`
    : "no variant reaches zero false positives on these cases - do not ship a stricter gate yet.",
);
