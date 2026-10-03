/**
 * Does the bonus round's Noul statement actually discriminate?
 *
 * The main riddle's statement was chosen empirically (see sweep.mjs - 10
 * candidate phrasings measured against a hand-scored benchmark). The bonus
 * round's statement was written by hand and never measured, so this does the
 * equivalent minimum check: for several words from OPPOSITE_WORDS, score a
 * spread of answers from "a defensible opposite" down to "unrelated noise"
 * and report whether the ordering comes out sane.
 *
 *   node scripts/riddle-bench/bonus-probe.mjs
 *
 * Read-only: runs the same model the browser runs, submits nothing anywhere.
 */
import { OpenJev, noul } from "open-jev";
import { bonusChallengeForDay, OPPOSITE_WORDS } from "../../../shared/challenges.js";
import { canonicalizeForJudge } from "../../../shared/judge-canonicalize.js";

const MODEL = "kev-0.6b";

// Hand-labelled: "good" = a defensible opposite, "weak" = loosely related,
// "noise" = unrelated/nonsense. A usable statement should rank good > noise.
const CASES = [
  {
    word: "wifi",
    good: ["an ethernet cable", "a dead zone", "total silence"],
    weak: ["a library", "a letter"],
    noise: ["a banana", "seventeen", "purple elephant"],
  },
  {
    word: "bureaucracy",
    good: ["anarchy", "a handshake deal", "one person deciding"],
    weak: ["a small startup", "a village"],
    noise: ["a sandwich", "blue", "running fast"],
  },
  {
    word: "nostalgia",
    good: ["dread of the future", "living in the present", "amnesia"],
    weak: ["boredom", "a new city"],
    noise: ["a stapler", "42", "wet paint"],
  },
];

const jev = await OpenJev.load({ model: MODEL, dtype: "auto" });
console.log(`loaded on ${jev.runtime.device}, dtype ${jev.runtime.dtype}\n`);

// Proves the statement under test is literally the shipped one.
const sample = bonusChallengeForDay("2026-10-03");
console.log(`shipped statement for 2026-10-03: ${sample.noulStatement}`);
console.log(`word list length: ${OPPOSITE_WORDS.length}\n`);

async function scoreOne(word, answer) {
  const statement = `Is the answer a plausible opposite of "${word}"?`;
  const [verdict] = await jev.decide(canonicalizeForJudge(answer), [noul(statement)]);
  return verdict.probability * 100;
}

let discriminating = 0;
for (const c of CASES) {
  console.log(`--- opposite of "${c.word}" ---`);
  const out = {};
  for (const band of ["good", "weak", "noise"]) {
    out[band] = [];
    for (const a of c[band]) {
      const s = await scoreOne(c.word, a);
      out[band].push(s);
      console.log(`  ${band.padEnd(5)} ${s.toFixed(2).padStart(6)}  ${a}`);
    }
  }
  const avg = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length;
  const gAvg = avg(out.good);
  const nAvg = avg(out.noise);
  const gap = gAvg - nAvg;
  const ok = gap > 5;
  if (ok) discriminating += 1;
  console.log(
    `  => good avg ${gAvg.toFixed(2)} | weak avg ${avg(out.weak).toFixed(2)} | noise avg ${nAvg.toFixed(2)} | gap ${gap.toFixed(2)} ${ok ? "(discriminates)" : "(DOES NOT discriminate)"}\n`,
  );
}

console.log(`${discriminating}/${CASES.length} words showed a usable good-vs-noise gap.`);
await jev.dispose?.();
