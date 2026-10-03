/**
 * Three experiments aimed at making model scoring actually work, under the
 * constraints that matter: the same small model, no human voting, and a score
 * that cannot be farmed by restating the riddle.
 *
 * 1. STRICTER GATE (no model). The shipped gate misses one restatement
 *    because its stemmer does the opposite of what its comment claims -
 *    /e(ing|ed)$/ only matches literal "eing"/"eed", so "leaving" stems to
 *    "leav" while "leave" stays "leave" and the two never match. Short
 *    function words like "at"/"all" also pad the denominator. This measures a
 *    fixed version: does it catch all 5 restatements while still passing all
 *    26 genuine answers?
 *
 * 2. PARROT DETECTOR (model, as a veto). The judge rewards restatement when
 *    asked "is this a good interpretation". But it might answer "is this just
 *    the riddle repeated back?" correctly - a different, easier question. If
 *    it separates restatements from genuine answers, it can veto or penalise,
 *    which keeps the defence model-based rather than purely a word filter.
 *
 * 3. COMPARATIVE JUDGING (model, different question type). Absolute scoring
 *    sits at ~52% pairwise accuracy. Small typed-decision models are usually
 *    far better at "which of these two is better" than at "rate this one", so
 *    this puts two answers to the same riddle side by side and asks the model
 *    to choose, testing both orderings to expose position bias. If
 *    comparative accuracy is materially higher, a tournament-style
 *    leaderboard is viable - still entirely model-scored.
 *
 *   node scripts/riddle-bench/antiparrot-and-comparative.mjs
 *
 * Read-only: submits nothing, writes nothing, deploys nothing.
 */
import { OpenJev, noul, choice } from "open-jev";
import { canonicalizeForJudge } from "../../../shared/judge-canonicalize.js";
import { riddleStatement } from "../../../shared/challenges.js";
import { looksLikeOwnInterpretation, looksLikeRealText } from "../../../shared/gibberish.js";
import { RIDDLES } from "./cases.mjs";
import { mean } from "./metrics.mjs";

const MODEL = "kev-0.6b";

// ---------------------------------------------------------------- experiment 1
// A fixed gate. Same shape as the shipped one - generic stopwords, overlap
// ratio, no riddle-specific tuning - with the stemmer actually doing what the
// original comment describes, and function words that carry no content added
// to the stoplist so they cannot dilute the ratio.
const STOPWORDS_V2 = new Set(
  ("a an the you can be what it is are was were without going in has have had i he she they we " +
    "my your its this that at all of to for on by with from as and or but not no any some only " +
    "just more most than then there here when while which who whom whose does do did done being " +
    "been very too also even still yet so if because about into over under again once each both")
    .split(" "),
);

/** Normal forms for one word. A match on ANY form counts, which catches
 * morphological variants without pretending to be a real stemmer. */
function forms(word) {
  const out = new Set([word]);
  const noSuffix = word.replace(/(ings|ing|edly|ed|ly|es|s)$/, "");
  out.add(noSuffix);
  out.add(noSuffix.replace(/e$/, "")); // leave -> leav, so "leaving" -> "leav" matches
  out.add(word.replace(/e$/, ""));
  // also a short prefix, to catch irregulars like lost/lose, passed/pass
  if (noSuffix.length >= 4) out.add(noSuffix.slice(0, 4));
  return [...out].filter((f) => f.length > 1);
}

function contentWords(text) {
  return (String(text ?? "").toLowerCase().match(/[a-z']+/g) ?? []).filter(
    (t) => !STOPWORDS_V2.has(t) && t.length > 1,
  );
}

function looksLikeOwnInterpretationV2(answer, riddlePrompt, threshold = 0.4) {
  const answerWords = contentWords(answer);
  if (answerWords.length === 0) return false;
  const riddleForms = new Set(contentWords(riddlePrompt).flatMap(forms));
  let overlapping = 0;
  for (const w of answerWords) {
    if (forms(w).some((f) => riddleForms.has(f))) overlapping += 1;
  }
  return overlapping / answerWords.length < threshold;
}

console.log("=== 1. stricter gate (no model) ===");
let p5 = 0;
let pTotal = 0;
let fp = 0;
let gTotal = 0;
const gateRows = [];
for (const r of RIDDLES) {
  for (const c of r.cases) {
    const oldPass = looksLikeRealText(c.answer) && looksLikeOwnInterpretation(c.answer, r.prompt);
    const newPass = looksLikeRealText(c.answer) && looksLikeOwnInterpretationV2(c.answer, r.prompt);
    gateRows.push({ riddle: r.id, prompt: r.prompt, tier: c.tier, answer: c.answer, oldPass, newPass });
    if (c.tier === 8) {
      pTotal += 1;
      if (!newPass) p5 += 1;
      if (oldPass !== newPass) console.log(`  now blocked: "${c.answer}"`);
    }
    if (c.tier <= 4) {
      gTotal += 1;
      if (!newPass) {
        fp += 1;
        console.log(`  FALSE POSITIVE (good answer blocked): "${c.answer}"  [${r.id}]`);
      }
    }
  }
}
const oldParrotBlocked = gateRows.filter((g) => g.tier === 8 && !g.oldPass).length;
console.log(`  restatements blocked: ${oldParrotBlocked}/${pTotal} before -> ${p5}/${pTotal} after`);
console.log(`  good answers wrongly blocked: ${fp}/${gTotal}`);

// --------------------------------------------------------------- model needed
const jev = await OpenJev.load({ model: MODEL, dtype: "auto" });
console.log(`\nloaded on ${jev.runtime.device}, dtype ${jev.runtime.dtype}`);
const askNoul = async (state, statement) => {
  const [v] = await jev.decide(canonicalizeForJudge(state), [noul(statement)]);
  return v.probability * 100;
};

// ---------------------------------------------------------------- experiment 2
console.log("\n=== 2. can the model detect restatement when asked directly? ===");
const DETECTORS = {
  repeats: (r) => `The answer merely repeats the wording of the riddle "${r}" instead of answering it.`,
  restates: (r) => `This is a restatement of the riddle "${r}", not an answer to it.`,
  noNew: (r) => `The answer introduces no idea that is not already in the riddle "${r}".`,
};
for (const [key, build] of Object.entries(DETECTORS)) {
  const parrot = [];
  const good = [];
  for (const r of RIDDLES) {
    const statement = build(r.prompt);
    for (const c of r.cases) {
      const s = await askNoul(c.answer, statement);
      if (c.tier === 8) parrot.push(s);
      else if (c.tier <= 4) good.push(s);
    }
  }
  const sep = mean(parrot) - mean(good);
  // A veto needs a threshold that catches restatement without catching good
  // answers: measured here as whether the worst restatement still outscores
  // the best genuine answer.
  const cleanlySeparable = Math.min(...parrot) > Math.max(...good);
  console.log(
    `  ${key.padEnd(9)} restatement ${mean(parrot).toFixed(1).padStart(5)}  good ${mean(good).toFixed(1).padStart(5)}  separation ${sep >= 0 ? "+" : ""}${sep.toFixed(1).padStart(6)}  ${cleanlySeparable ? "CLEANLY SEPARABLE (usable as a veto)" : "overlapping (not a clean veto)"}`,
  );
}

// ---------------------------------------------------------------- experiment 3
console.log("\n=== 3. comparative judging: pick the better of two answers ===");
console.log("  (absolute scoring baseline on these same pairs is ~52%)");

function samplePairs(riddle, limit) {
  const pairs = [];
  const cs = riddle.cases;
  for (let i = 0; i < cs.length; i += 1) {
    for (let j = i + 1; j < cs.length; j += 1) {
      if (cs[i].tier !== cs[j].tier) pairs.push([cs[i], cs[j]]);
    }
  }
  // deterministic spread across the tier-gap range rather than a random slice
  pairs.sort((a, b) => Math.abs(b[0].tier - b[1].tier) - Math.abs(a[0].tier - a[1].tier));
  const step = Math.max(1, Math.floor(pairs.length / limit));
  return pairs.filter((_, idx) => idx % step === 0).slice(0, limit);
}

const COMPARATIVE = {
  better: "Which answer better resolves the riddle?",
  genuine: "Which answer is a genuine interpretation that solves the riddle, rather than a restatement of it?",
};

for (const [key, instructions] of Object.entries(COMPARATIVE)) {
  let correct = 0;
  let total = 0;
  let agreed = 0;
  for (const r of RIDDLES) {
    for (const [a, b] of samplePairs(r, 14)) {
      const better = a.tier < b.tier ? "A" : "B";
      const stateAB = `Riddle: "${r.prompt}"\nAnswer A: ${a.answer}\nAnswer B: ${b.answer}`;
      const stateBA = `Riddle: "${r.prompt}"\nAnswer A: ${b.answer}\nAnswer B: ${a.answer}`;
      const [vAB] = await jev.decide(canonicalizeForJudge(stateAB), [choice(instructions, ["A", "B"])]);
      const [vBA] = await jev.decide(canonicalizeForJudge(stateBA), [choice(instructions, ["A", "B"])]);
      // Position bias check: in the swapped presentation the better answer is
      // the other letter, so a consistent judge flips its pick.
      const pickAB = vAB.choice;
      const pickBA = vBA.choice === "A" ? "B" : "A"; // translate back to original labelling
      if (pickAB === pickBA) agreed += 1;
      for (const pick of [pickAB, pickBA]) {
        total += 1;
        if (pick === better) correct += 1;
      }
    }
  }
  const acc = (correct / total) * 100;
  console.log(
    `  ${key.padEnd(8)} accuracy ${acc.toFixed(1)}%  over ${total} judgements  order-consistent ${((agreed / (total / 2)) * 100).toFixed(0)}%  ${acc >= 65 ? "PROMISING" : acc >= 57 ? "weak" : "~coin flip"}`,
  );
}

await jev.dispose?.();
console.log("\ndone - nothing was deployed or submitted.");
