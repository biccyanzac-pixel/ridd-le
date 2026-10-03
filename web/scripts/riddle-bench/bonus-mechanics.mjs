/**
 * Compares candidate BONUS ROUND MECHANICS, not just phrasings.
 *
 * The three earlier sweeps (wording, framing, question type - 576 model
 * calls) all concluded the same thing about "what's the opposite of X?": you
 * can fix the absolute scores by asking better, but nothing makes the
 * ranking reliable, because the model has little signal for antonymy of a
 * bare abstract noun.
 *
 * So this tests different GAMES, on the theory that the model's real strength
 * - the one the riddle round already exploits - is judging whether a complete
 * composed statement is plausible. Four mechanics, same metrics, so they can
 * be compared directly:
 *
 *   A oppositeWord    the shipped game, best known framing (control)
 *   B oppositePhrase  same game, but the prompt is a phrase, not one word
 *   C templateTruth   fill blanks from a word bank; judged on how true the
 *                     finished sentence is
 *   D templateExtreme same fills, scored on how far from "don't know" the
 *                     verdict lands - rewards making it emphatically true OR
 *                     emphatically false
 *
 *   node scripts/riddle-bench/bonus-mechanics.mjs
 *
 * Read-only: runs the same model the browser runs, writes nothing anywhere.
 */
import { OpenJev, noul } from "open-jev";
import { canonicalizeForJudge } from "../../../shared/judge-canonicalize.js";

const MODEL = "kev-0.6b";

/** The word bank a player would choose from. Deliberately concrete-but-
 * abstractable nouns that combine into aphorisms. */
export const WORD_BANK = [
  "silence", "applause", "habit", "apology", "promise", "deadline", "mirror",
  "shadow", "map", "rumour", "debt", "fever", "ladder", "anchor", "compass",
  "keyhole", "echo", "draft", "ritual", "bargain", "grudge", "lullaby",
  "alibi", "receipt", "scar", "rehearsal", "inheritance", "detour", "curfew",
  "blueprint", "verdict", "placebo", "souvenir", "trapdoor", "headline",
  "uniform", "passport", "ledger", "eulogy", "confession", "invitation",
  "loophole", "threshold", "armistice", "inventory", "sermon", "forecast",
  "mortgage", "hostage", "tourniquet",
];

// --- A/B: "opposite of", using the best framing found by bonus-framing.mjs
const OPPOSITE_WORD_CASES = [
  {
    prompt: "wifi",
    good: ["an ethernet cable", "a dead zone", "total silence"],
    noise: ["a banana", "seventeen", "purple elephant"],
  },
  {
    prompt: "bureaucracy",
    good: ["anarchy", "a handshake deal", "one person deciding"],
    noise: ["a sandwich", "blue", "running fast"],
  },
  {
    prompt: "nostalgia",
    good: ["dread of the future", "living in the present", "amnesia"],
    noise: ["a stapler", "42", "wet paint"],
  },
  {
    prompt: "gravity",
    good: ["weightlessness", "floating away", "a balloon rising"],
    noise: ["a spreadsheet", "loud", "on tuesday"],
  },
];

const OPPOSITE_PHRASE_CASES = [
  {
    prompt: "a locked door",
    good: ["an open gate", "a standing invitation", "a house with no walls"],
    noise: ["a banana", "seventeen", "purple elephant"],
  },
  {
    prompt: "a crowded train at rush hour",
    good: ["an empty platform at midnight", "a private car", "a quiet country lane"],
    noise: ["a sandwich", "blue", "running fast"],
  },
  {
    prompt: "the first day of a holiday",
    good: ["the last night before work", "a monday morning", "the end of term"],
    noise: ["a stapler", "42", "wet paint"],
  },
  {
    prompt: "a half-finished apology",
    good: ["a full confession", "a sincere promise kept", "complete silence"],
    noise: ["a spreadsheet", "loud", "on tuesday"],
  },
];

// --- C/D: fill the blanks from the bank. `good` fills aim at a sentence that
// lands as true; `noise` fills are legal-but-careless picks from the same
// bank, which is the realistic failure mode (not gibberish - a player can
// only ever submit bank words).
const TEMPLATE_CASES = [
  {
    template: (w) => `A ${w[0]} is just a ${w[1]} with better timing.`,
    blanks: 2,
    good: [["rumour", "confession"], ["promise", "debt"], ["bargain", "apology"]],
    noise: [["keyhole", "mortgage"], ["ladder", "forecast"], ["compass", "eulogy"]],
  },
  {
    template: (w) => `Every ${w[0]} eventually becomes a ${w[1]}.`,
    blanks: 2,
    good: [["apology", "ritual"], ["grudge", "inheritance"], ["draft", "blueprint"]],
    noise: [["tourniquet", "forecast"], ["keyhole", "applause"], ["anchor", "headline"]],
  },
  {
    template: (w) => `You can survive a ${w[0]} but not a ${w[1]}.`,
    blanks: 2,
    good: [["deadline", "verdict"], ["rumour", "confession"], ["detour", "trapdoor"]],
    noise: [["compass", "souvenir"], ["ledger", "invitation"], ["uniform", "map"]],
  },
  {
    template: (w) => `A ${w[0]} without a ${w[1]} is only a ${w[2]}.`,
    blanks: 3,
    good: [
      ["promise", "deadline", "rumour"],
      ["alibi", "receipt", "confession"],
      ["bargain", "ledger", "promise"],
    ],
    noise: [
      ["echo", "ladder", "passport"],
      ["lullaby", "mortgage", "keyhole"],
      ["sermon", "compass", "souvenir"],
    ],
  },
];

const jev = await OpenJev.load({ model: MODEL, dtype: "auto" });
console.log(`loaded on ${jev.runtime.device}, dtype ${jev.runtime.dtype}`);
console.log(`word bank: ${WORD_BANK.length} words\n`);

const avg = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length;
const ask = async (state, statement) => {
  const [v] = await jev.decide(canonicalizeForJudge(state), [noul(statement)]);
  return v.probability * 100;
};

/** Verifies every fill only uses bank words - a mechanic that needs
 * off-bank words would not be the game described. */
for (const c of TEMPLATE_CASES) {
  for (const fill of [...c.good, ...c.noise]) {
    for (const w of fill) {
      if (!WORD_BANK.includes(w)) throw new Error(`fill word not in bank: ${w}`);
    }
    if (fill.length !== c.blanks) throw new Error(`fill has ${fill.length} words, needs ${c.blanks}`);
  }
}

const results = [];
async function measure(name, items, scoreOf, { note = "" } = {}) {
  const gaps = [];
  let clean = 0;
  const goodAll = [];
  const noiseAll = [];
  for (const item of items) {
    const g = [];
    for (const x of item.good) g.push(await scoreOf(item, x));
    const n = [];
    for (const x of item.noise) n.push(await scoreOf(item, x));
    goodAll.push(...g);
    noiseAll.push(...n);
    gaps.push(avg(g) - avg(n));
    if (Math.min(...g) > Math.max(...n)) clean += 1;
  }
  const r = {
    name,
    meanGap: avg(gaps),
    worst: Math.min(...gaps),
    clean,
    items: items.length,
    goodMean: avg(goodAll),
    noiseMean: avg(noiseAll),
    note,
  };
  results.push(r);
  console.log(
    `${name.padEnd(16)} gap ${r.meanGap >= 0 ? "+" : ""}${r.meanGap.toFixed(2).padStart(6)}  worst ${r.worst.toFixed(1).padStart(6)}  clean ${clean}/${items.length}  good ${r.goodMean.toFixed(1).padStart(5)}  noise ${r.noiseMean.toFixed(1).padStart(5)}  ${note}`,
  );
  return r;
}

// A: control - the shipped game at its best known framing
await measure("A oppositeWord", OPPOSITE_WORD_CASES, (item, a) =>
  ask(a, `This is the opposite of "${item.prompt}".`),
);

// B: same game, phrase prompts instead of single words
await measure("B oppositePhrase", OPPOSITE_PHRASE_CASES, (item, a) =>
  ask(a, `This is the opposite of "${item.prompt}".`),
);

// C: filled template, judged on truth
await measure("C templateTruth", TEMPLATE_CASES, (item, fill) =>
  ask(item.template(fill), "This sentence is true."),
);

// C2: same, but asking for plausibility rather than bare truth - the riddle
// round's own question style, which was the one empirically validated
await measure("C2 templatePlaus", TEMPLATE_CASES, (item, fill) =>
  ask(item.template(fill), "This is a plausible and meaningful claim."),
);

// D: extremity - reward a verdict far from "don't know" in EITHER direction,
// which is the "make it as true or as false as you can" mechanic
await measure(
  "D templateExtreme",
  TEMPLATE_CASES,
  async (item, fill) => {
    const p = await ask(item.template(fill), "This sentence is true.");
    return Math.abs(p - 50) * 2; // 0 = maximally undecided, 100 = emphatic
  },
  { note: "(|p-50|*2)" },
);

console.log("\n=== ranked by mean good-vs-noise gap ===");
results.sort((a, b) => b.meanGap - a.meanGap);
for (const r of results) {
  console.log(
    `${r.name.padEnd(16)} gap ${r.meanGap >= 0 ? "+" : ""}${r.meanGap.toFixed(2).padStart(6)}  clean ${r.clean}/${r.items}  good ${r.goodMean.toFixed(1)}  noise ${r.noiseMean.toFixed(1)}`,
  );
}

const best = results[0];
console.log(`\nbest mechanic: ${best.name} (gap ${best.meanGap.toFixed(2)}, clean ${best.clean}/${best.items})`);
console.log(
  best.clean === best.items && best.meanGap > 15
    ? "STRONG: ranks every item's good fills above its careless ones, with a wide margin."
    : best.clean >= best.items - 1 && best.meanGap > 10
      ? "WORKABLE: ranks nearly everything correctly - usable as a scored round."
      : "WEAK: still cannot reliably tell a thoughtful answer from a careless one.",
);
await jev.dispose?.();
