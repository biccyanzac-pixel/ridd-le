/**
 * Phrasing sweep for the bonus round, mirroring what sweep.mjs did for the
 * riddle: measure several candidate Noul statements against hand-labelled
 * answers and report which (if any) separates a defensible opposite from
 * noise. The shipped phrasing was never measured and turned out to have no
 * usable signal (see bonus-probe.mjs) - this looks for one that does.
 *
 *   node scripts/riddle-bench/bonus-sweep.mjs
 *
 * Read-only: runs the same model the browser runs, writes nothing anywhere.
 */
import { OpenJev, noul } from "open-jev";
import { canonicalizeForJudge } from "../../../shared/judge-canonicalize.js";

const MODEL = "kev-0.6b";

const STATEMENTS = {
  shipped: (w) => `Is the answer a plausible opposite of "${w}"?`,
  plain: (w) => `The answer is the opposite of "${w}".`,
  pair: (w) => `"${w}" and the answer are opposites.`,
  means: (w) => `The answer means the opposite of "${w}".`,
  antonym: (w) => `Is the answer an antonym of "${w}"?`,
  extreme: (w) => `If "${w}" is one extreme, the answer is the other extreme.`,
  reply: (w) => `Someone asked for the opposite of "${w}". The answer is a good reply.`,
  contradict: (w) => `The answer contradicts "${w}".`,
  meaning: (w) => `The answer and "${w}" are opposites in meaning.`,
  unlike: (w) => `The answer is as unlike "${w}" as possible.`,
};

// good = a defensible opposite, noise = unrelated. A usable statement must
// rank good above noise, consistently, by a margin worth showing a player.
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
const callsPerStatement = CASES.reduce((t, c) => t + c.good.length + c.noise.length, 0);
const total = Object.keys(STATEMENTS).length * callsPerStatement;
console.log(`${Object.keys(STATEMENTS).length} statements x ${CASES.length} words = ${total} model calls\n`);

const avg = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length;
let done = 0;
const results = [];

for (const [key, build] of Object.entries(STATEMENTS)) {
  const gaps = [];
  const perWord = [];
  let cleanSweeps = 0; // every good answer beat every noise answer for that word
  for (const c of CASES) {
    const statement = build(c.word);
    const scoreOf = async (a) => {
      const [v] = await jev.decide(canonicalizeForJudge(a), [noul(statement)]);
      done += 1;
      return v.probability * 100;
    };
    const g = [];
    for (const a of c.good) g.push(await scoreOf(a));
    const n = [];
    for (const a of c.noise) n.push(await scoreOf(a));
    const gap = avg(g) - avg(n);
    gaps.push(gap);
    if (Math.min(...g) > Math.max(...n)) cleanSweeps += 1;
    perWord.push(`${c.word}:${gap >= 0 ? "+" : ""}${gap.toFixed(1)}`);
  }
  const meanGap = avg(gaps);
  const worst = Math.min(...gaps);
  results.push({ key, meanGap, cleanSweeps, worst, perWord: perWord.join(" ") });
  console.log(
    `${key.padEnd(11)} meanGap ${meanGap >= 0 ? "+" : ""}${meanGap.toFixed(2).padStart(6)}  clean ${cleanSweeps}/${CASES.length}  worst ${worst.toFixed(1).padStart(6)}   ${perWord.join(" ")}  [${done}/${total}]`,
  );
}

console.log("\n=== ranked by mean good-vs-noise gap ===");
results.sort((a, b) => b.meanGap - a.meanGap);
for (const r of results) {
  console.log(
    `${r.key.padEnd(11)} gap ${r.meanGap >= 0 ? "+" : ""}${r.meanGap.toFixed(2).padStart(6)}  cleanSweeps ${r.cleanSweeps}/${CASES.length}  worstWord ${r.worst.toFixed(1)}`,
  );
}
const best = results[0];
const verdict =
  best.cleanSweeps === CASES.length && best.meanGap > 10
    ? "USABLE - worth adopting."
    : best.meanGap > 8
      ? "MARGINAL - better than shipped, still weak."
      : "NOT USABLE - no phrasing separates sense from noise; the mechanic needs changing, not rewording.";
console.log(`\nbest: "${best.key}" (gap ${best.meanGap.toFixed(2)}, clean ${best.cleanSweeps}/${CASES.length}). ${verdict}`);
await jev.dispose?.();
