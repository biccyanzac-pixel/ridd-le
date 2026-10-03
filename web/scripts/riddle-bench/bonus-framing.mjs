/**
 * Framing sweep for the bonus round.
 *
 * bonus-sweep.mjs varied the WORDING of the statement but held the FRAMING
 * fixed: the model's `state` was always the bare answer and the statement was
 * always a question about it. That is only one of several ways to put the
 * same judgement to the model, and for a 0.6B model the structure plausibly
 * matters more than the adjectives - every score landing near zero, good
 * answers included, looks like the shape of the question being rejected
 * rather than the content being judged.
 *
 * This varies the structure: what goes in the state, what goes in the
 * statement, and whether the pair is presented together.
 *
 *   node scripts/riddle-bench/bonus-framing.mjs
 *
 * Read-only: runs the same model the browser runs, writes nothing anywhere.
 */
import { OpenJev, noul } from "open-jev";
import { canonicalizeForJudge } from "../../../shared/judge-canonicalize.js";

const MODEL = "kev-0.6b";

// Each framing turns (word, answer) into the { state, statement } pair the
// model actually sees. `current` is what is deployed today; `bestWording` is
// the strongest result from the wording-only sweep, kept here so the two
// sweeps are directly comparable.
const FRAMINGS = {
  current: (w, a) => ({ state: a, statement: `Is the answer a plausible opposite of "${w}"?` }),
  bestWording: (w, a) => ({ state: a, statement: `The answer is as unlike "${w}" as possible.` }),
  declarative: (w, a) => ({ state: a, statement: `This is the opposite of "${w}".` }),
  pairInState: (w, a) => ({ state: `${w} / ${a}`, statement: `These two things are opposites.` }),
  claimInState: (w, a) => ({ state: `The opposite of ${w} is ${a}.`, statement: `This claim is true.` }),
  qaInState: (w, a) => ({
    state: `Question: what is the opposite of ${w}? Answer: ${a}.`,
    statement: `The answer is a good answer to the question.`,
  }),
  colonPair: (w, a) => ({ state: `${w}: ${a}`, statement: `The second phrase means the opposite of the first.` }),
  sentencePair: (w, a) => ({
    state: `${a} is the opposite of ${w}.`,
    statement: `This sentence makes sense.`,
  }),
};

const CASES = [
  {
    word: "wifi",
    good: ["an ethernet cable", "a dead zone", "total silence"],
    noise: ["a banana", "seventeen", "purple elephant"],
  },
  {
    word: "bureaucracy",
    good: ["anarchy", "a handshake deal", "one person deciding"],
    noise: ["a sandwich", "blue", "running fast"],
  },
  {
    word: "nostalgia",
    good: ["dread of the future", "living in the present", "amnesia"],
    noise: ["a stapler", "42", "wet paint"],
  },
  {
    word: "gravity",
    good: ["weightlessness", "floating away", "a balloon rising"],
    noise: ["a spreadsheet", "loud", "on tuesday"],
  },
];

const jev = await OpenJev.load({ model: MODEL, dtype: "auto" });
console.log(`loaded on ${jev.runtime.device}, dtype ${jev.runtime.dtype}`);
const per = CASES.reduce((t, c) => t + c.good.length + c.noise.length, 0);
console.log(`${Object.keys(FRAMINGS).length} framings x ${CASES.length} words = ${Object.keys(FRAMINGS).length * per} model calls\n`);

const avg = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length;
const results = [];

for (const [key, build] of Object.entries(FRAMINGS)) {
  const gaps = [];
  let clean = 0;
  const goodAll = [];
  const noiseAll = [];
  for (const c of CASES) {
    const scoreOf = async (a) => {
      const { state, statement } = build(c.word, a);
      const [v] = await jev.decide(canonicalizeForJudge(state), [noul(statement)]);
      return v.probability * 100;
    };
    const g = [];
    for (const a of c.good) g.push(await scoreOf(a));
    const n = [];
    for (const a of c.noise) n.push(await scoreOf(a));
    goodAll.push(...g);
    noiseAll.push(...n);
    gaps.push(avg(g) - avg(n));
    if (Math.min(...g) > Math.max(...n)) clean += 1;
  }
  const meanGap = avg(gaps);
  const worst = Math.min(...gaps);
  // Headroom matters as much as the gap: if every score is pinned near 0 the
  // player sees "3.50" no matter how good their guess was.
  const goodMean = avg(goodAll);
  const spread = Math.max(...goodAll) - Math.min(...noiseAll);
  results.push({ key, meanGap, worst, clean, goodMean, spread });
  console.log(
    `${key.padEnd(13)} gap ${meanGap >= 0 ? "+" : ""}${meanGap.toFixed(2).padStart(6)}  worst ${worst.toFixed(1).padStart(6)}  clean ${clean}/${CASES.length}  goodAvg ${goodMean.toFixed(1).padStart(5)}  spread ${spread.toFixed(1).padStart(5)}`,
  );
}

console.log("\n=== ranked by mean good-vs-noise gap ===");
results.sort((a, b) => b.meanGap - a.meanGap);
for (const r of results) {
  console.log(
    `${r.key.padEnd(13)} gap ${r.meanGap >= 0 ? "+" : ""}${r.meanGap.toFixed(2).padStart(6)}  clean ${r.clean}/${CASES.length}  worstWord ${r.worst.toFixed(1).padStart(6)}  goodAvg ${r.goodMean.toFixed(1)}`,
  );
}

const best = results[0];
const usable = best.clean === CASES.length && best.meanGap > 10 && best.goodMean > 20;
console.log(
  `\nbest framing: "${best.key}" - gap ${best.meanGap.toFixed(2)}, clean ${best.clean}/${CASES.length}, good answers average ${best.goodMean.toFixed(1)}.`,
);
console.log(
  usable
    ? "USABLE: separates sense from noise AND leaves room for a score worth showing."
    : best.meanGap > 10 && best.clean >= CASES.length - 1
      ? "PROMISING: ranks correctly; check whether the absolute scores are high enough to show a player."
      : "STILL NOT USABLE: the problem is not the framing either.",
);
await jev.dispose?.();
