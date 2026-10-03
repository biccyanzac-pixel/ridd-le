/**
 * Is the MAIN riddle's deployed judge statement the wrong one?
 *
 * judge-quality.mjs measured the shipped statement on the existing 58-case
 * tiered set and found it ranks answers at 48.4% pairwise accuracy - a coin
 * flip - with good answers scoring *below* outright junk.
 *
 * sweep.mjs's own notes explain why. Its round-1 statements all shared one
 * dominant failure: an answer that merely restates the riddle's wording
 * scored 85-99, above almost every genuine answer. Round 2 (G/H/I/J) was
 * written specifically to name and exclude that. The statement in production,
 * `riddleStatement`, is round-1's D.
 *
 * So this separates two very different diagnoses:
 *   - the model cannot rank riddle answers at all  -> every statement ~50%
 *   - production shipped a known-bad statement     -> a round-2 one is better
 *
 * The second is a fixable bug in the main game, which matters far more than
 * anything about the bonus round.
 *
 *   node scripts/riddle-bench/riddle-shipped-vs-round2.mjs
 *
 * Read-only: runs the same model the browser runs, writes nothing anywhere.
 */
import { OpenJev, noul } from "open-jev";
import { canonicalizeForJudge } from "../../../shared/judge-canonicalize.js";
import { riddleStatement } from "../../../shared/challenges.js";
import { RIDDLES } from "./cases.mjs";
import { evaluate, printRow, verdictFor } from "./metrics.mjs";

const MODEL = "kev-0.6b";

const CANDIDATES = {
  "D shipped (round 1)": (r) =>
    `Is the answer a plausible interpretation of the riddle "${r}" that resolves its apparent contradiction?`,
  "G no-restate": (r) =>
    `Is the answer a genuinely different, plausible interpretation of the riddle "${r}" that resolves its apparent contradiction, rather than a restatement of the riddle's own wording?`,
  "H short-solution": (r) => `The answer is a different, plausible solution to the riddle "${r}".`,
  "I new-meaning": (r) =>
    `The answer gives a new, plausible meaning that solves the riddle "${r}", not just repeating the riddle's own words.`,
  "J structured": (r) =>
    `Riddle: "${r}"\nThe answer above gives a plausible interpretation, different from the riddle's own wording, that makes the riddle true.`,
};

// Sanity check: the first candidate must be byte-identical to production, or
// this comparison is measuring something the players never see.
{
  const probe = "TEST RIDDLE";
  if (CANDIDATES["D shipped (round 1)"](probe) !== riddleStatement(probe)) {
    throw new Error("candidate D has drifted from shared/challenges.js's riddleStatement");
  }
  console.log("verified: candidate D is byte-identical to the deployed riddleStatement()\n");
}

const BANDS = { good: (t) => t <= 4, hard: (t) => t >= 5 && t <= 7, junk: (t) => t >= 8 };

const jev = await OpenJev.load({ model: MODEL, dtype: "auto" });
console.log(`loaded on ${jev.runtime.device}, dtype ${jev.runtime.dtype}`);
console.log(`${Object.keys(CANDIDATES).length} statements x 58 cases\n`);

const ask = async (state, statement) => {
  const [v] = await jev.decide(canonicalizeForJudge(state), [noul(statement)]);
  return v.probability * 100;
};

const summary = [];
for (const [label, build] of Object.entries(CANDIDATES)) {
  const rows = [];
  // Parroting is tier 8 - tracked separately because it is the specific
  // failure round 2 was written to fix.
  for (const r of RIDDLES) {
    const statement = build(r.prompt);
    for (const c of r.cases) {
      rows.push({ tier: c.tier, score: await ask(c.answer, statement) });
    }
  }
  const res = evaluate(label, rows, BANDS);
  res.parrotMean =
    rows.filter((r) => r.tier === 8).reduce((t, r) => t + r.score, 0) /
    Math.max(1, rows.filter((r) => r.tier === 8).length);
  res.topMean =
    rows.filter((r) => r.tier <= 2).reduce((t, r) => t + r.score, 0) /
    Math.max(1, rows.filter((r) => r.tier <= 2).length);
  summary.push(res);
  printRow(res);
  console.log(
    `${" ".repeat(22)}  parroting(tier8) ${res.parrotMean.toFixed(1)}  vs  best answers(tier1-2) ${res.topMean.toFixed(1)}  ${res.topMean > res.parrotMean ? "correct order" : "INVERTED"}`,
  );
}

console.log("\n=== ranked by pairwise accuracy ===");
summary.sort((a, b) => b.pairAcc - a.pairAcc);
for (const s of summary) {
  console.log(
    `${s.label.padEnd(22)} pairAcc ${s.pairAcc.toFixed(1).padStart(5)}%  rho ${s.spearman.toFixed(2).padStart(5)}  easyGap ${s.easyGap.toFixed(1).padStart(6)}  parrot ${s.parrotMean.toFixed(1).padStart(5)} vs top ${s.topMean.toFixed(1).padStart(5)}  -> ${verdictFor(s.pairAcc)}`,
  );
}

const shipped = summary.find((s) => s.label.startsWith("D shipped"));
const best = summary[0];
const delta = best.pairAcc - shipped.pairAcc;
console.log(
  `\nshipped: ${shipped.pairAcc.toFixed(1)}%  |  best available: ${best.label} at ${best.pairAcc.toFixed(1)}%  |  difference ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} points`,
);
console.log(
  best.pairAcc >= 65 && delta > 8
    ? "DIAGNOSIS: production shipped a weak statement and a materially better one exists."
    : best.pairAcc < 57
      ? "DIAGNOSIS: no statement ranks usefully - the model cannot do this task, and the riddle round's scores are close to noise."
      : "DIAGNOSIS: all statements are weak; the better one helps but does not make the round reliable.",
);
await jev.dispose?.();
