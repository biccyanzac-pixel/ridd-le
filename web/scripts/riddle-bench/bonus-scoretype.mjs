/**
 * The last untested lever for the bonus round: the QUESTION TYPE.
 *
 * bonus-sweep.mjs varied the wording, bonus-framing.mjs varied the structure.
 * Both held the instrument fixed - a `noul`, i.e. one binary yes/no whose
 * p(yes) becomes the score. Those sweeps produced two mirror-image failures
 * that both look like the binary itself being the wrong tool: the shipped
 * phrasing answers "no" to everything (good answers average 4.5) while
 * `claimInState` answers "yes" to everything (good answers average 92.6, but
 * nonsense scores just as high).
 *
 * open-jev also offers `score`: an ordered scale whose answer carries a
 * `normalized` 0..1 value derived from the distribution over levels. That may
 * extract signal a yes/no cannot.
 *
 * NOTE: adopting this would mean the bonus round's score is no longer "a
 * noul", which contradicts a stated principle of the project (see README).
 * That is a deliberate design decision for a human to make, not a detail to
 * slip in - this script only measures whether it would even help.
 *
 *   node scripts/riddle-bench/bonus-scoretype.mjs
 *
 * Read-only: runs the same model the browser runs, writes nothing anywhere.
 */
import { OpenJev, noul, score } from "open-jev";
import { canonicalizeForJudge } from "../../../shared/judge-canonicalize.js";

const MODEL = "kev-0.6b";

// Each config returns { state, question, read } - `read` pulls a 0..100 out
// of whatever answer shape the question type produces.
const asNoul = (v) => v.probability * 100;
const asScore = (v) => v.normalized * 100;

const CONFIGS = {
  // Baselines from the previous sweeps, for a like-for-like comparison.
  "noul:current": (w, a) => ({
    state: a,
    question: noul(`Is the answer a plausible opposite of "${w}"?`),
    read: asNoul,
  }),
  "noul:declarative": (w, a) => ({
    state: a,
    question: noul(`This is the opposite of "${w}".`),
    read: asNoul,
  }),
  // The new instrument.
  "score:howWell5": (w, a) => ({
    state: a,
    question: score(`How well is this the opposite of "${w}"?`, [
      "not at all",
      "barely",
      "somewhat",
      "closely",
      "exactly",
    ]),
    read: asScore,
  }),
  "score:howWell3": (w, a) => ({
    state: a,
    question: score(`How well is this the opposite of "${w}"?`, [
      "unrelated",
      "loosely opposite",
      "clearly opposite",
    ]),
    read: asScore,
  }),
  "score:sentenceTruth": (w, a) => ({
    state: `${a} is the opposite of ${w}.`,
    question: score("How true is this sentence?", [
      "false",
      "doubtful",
      "arguable",
      "likely",
      "true",
    ]),
    read: asScore,
  }),
  "score:opposition": (w, a) => ({
    state: `${w} / ${a}`,
    question: score("How opposed in meaning are these two things?", [
      "unrelated",
      "slightly",
      "moderately",
      "strongly",
      "perfect opposites",
    ]),
    read: asScore,
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
console.log(`${Object.keys(CONFIGS).length} configs x ${CASES.length} words = ${Object.keys(CONFIGS).length * per} model calls\n`);

const avg = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length;
const results = [];

for (const [key, build] of Object.entries(CONFIGS)) {
  const gaps = [];
  let clean = 0;
  const goodAll = [];
  const noiseAll = [];
  for (const c of CASES) {
    const scoreOf = async (a) => {
      const { state, question, read } = build(c.word, a);
      const [v] = await jev.decide(canonicalizeForJudge(state), [question]);
      return read(v);
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
  results.push({
    key,
    meanGap,
    worst: Math.min(...gaps),
    clean,
    goodMean: avg(goodAll),
    noiseMean: avg(noiseAll),
  });
  console.log(
    `${key.padEnd(20)} gap ${meanGap >= 0 ? "+" : ""}${meanGap.toFixed(2).padStart(6)}  worst ${Math.min(...gaps).toFixed(1).padStart(6)}  clean ${clean}/${CASES.length}  good ${avg(goodAll).toFixed(1).padStart(5)}  noise ${avg(noiseAll).toFixed(1).padStart(5)}`,
  );
}

console.log("\n=== ranked by mean good-vs-noise gap ===");
results.sort((a, b) => b.meanGap - a.meanGap);
for (const r of results) {
  console.log(
    `${r.key.padEnd(20)} gap ${r.meanGap >= 0 ? "+" : ""}${r.meanGap.toFixed(2).padStart(6)}  clean ${r.clean}/${CASES.length}  good ${r.goodMean.toFixed(1)}  noise ${r.noiseMean.toFixed(1)}`,
  );
}
const best = results[0];
console.log(
  `\nbest: "${best.key}" - gap ${best.meanGap.toFixed(2)}, clean ${best.clean}/${CASES.length}, good ${best.goodMean.toFixed(1)} vs noise ${best.noiseMean.toFixed(1)}.`,
);
console.log(
  best.clean === CASES.length
    ? "USABLE: ranks every word's good answers above its noise."
    : `NOT RELIABLE: on ${CASES.length - best.clean} of ${CASES.length} words some nonsense still outranks some sensible answer.`,
);
await jev.dispose?.();
