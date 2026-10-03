/**
 * Does the non-AI gate catch what the judge rewards?
 *
 * The browser benchmark calls scoreAnswer() directly, so it measures the
 * judge alone. The real game runs two deterministic gates first
 * (shared/gibberish.js): looksLikeRealText and looksLikeOwnInterpretation,
 * the latter existing precisely to reject answers that parrot the riddle's
 * wording. The judge's top four scores were all parroting, so whether those
 * answers can actually reach the judge in production decides how serious that
 * is:
 *
 *   gates catch them  -> the exploit is largely closed; the real question is
 *                        how well the judge ranks what DOES get through
 *   gates miss them   -> a player can top the live leaderboard by restating
 *                        the riddle
 *
 * Reports both: which cases the gates block, and the judge's ranking accuracy
 * over only the cases that would genuinely reach it.
 *
 *   node scripts/riddle-bench/gate-vs-judge.mjs
 *
 * Read-only: submits nothing, writes nothing.
 */
import { OpenJev, noul } from "open-jev";
import { canonicalizeForJudge } from "../../../shared/judge-canonicalize.js";
import { riddleStatement } from "../../../shared/challenges.js";
import { looksLikeOwnInterpretation, looksLikeRealText } from "../../../shared/gibberish.js";
import { RIDDLES } from "./cases.mjs";
import { evaluate, printRow, verdictFor } from "./metrics.mjs";

const MODEL = "kev-0.6b";
const BANDS = { good: (t) => t <= 4, hard: (t) => t >= 5 && t <= 7, junk: (t) => t >= 8 };

// --- gate analysis needs no model at all
const gated = [];
for (const r of RIDDLES) {
  for (const c of r.cases) {
    const realText = looksLikeRealText(c.answer);
    const ownInterp = looksLikeOwnInterpretation(c.answer, r.prompt);
    gated.push({
      riddle: r.id,
      tier: c.tier,
      answer: c.answer,
      blockedBy: !realText ? "looksLikeRealText" : !ownInterp ? "looksLikeOwnInterpretation" : null,
    });
  }
}

const parrots = gated.filter((g) => g.tier === 8);
const blockedParrots = parrots.filter((g) => g.blockedBy);
console.log("--- the gates, on the parroting tier (tier 8) ---");
for (const p of parrots) {
  console.log(`  ${p.blockedBy ? "BLOCKED" : "passes "}  "${p.answer}"${p.blockedBy ? `  (${p.blockedBy})` : ""}`);
}
console.log(`\ntier-8 parroting blocked: ${blockedParrots.length}/${parrots.length}`);

const junk = gated.filter((g) => g.tier >= 9);
console.log(`tier 9-10 nonsense/unrelated blocked: ${junk.filter((g) => g.blockedBy).length}/${junk.length}`);
const goods = gated.filter((g) => g.tier <= 4);
const falsePositives = goods.filter((g) => g.blockedBy);
console.log(`good answers wrongly blocked (false positives): ${falsePositives.length}/${goods.length}`);
for (const f of falsePositives) console.log(`    "${f.answer}"  (${f.blockedBy})`);

// --- now the judge, over only what reaches it
const jev = await OpenJev.load({ model: MODEL, dtype: "auto" });
console.log(`\nloaded on ${jev.runtime.device}, dtype ${jev.runtime.dtype}`);
const ask = async (answer, statement) => {
  const [v] = await jev.decide(canonicalizeForJudge(answer), [noul(statement)]);
  return v.probability * 100;
};

const rows = [];
for (const r of RIDDLES) {
  const statement = riddleStatement(r.prompt);
  for (const c of r.cases) {
    const g = gated.find((x) => x.riddle === r.id && x.answer === c.answer);
    rows.push({ tier: c.tier, answer: c.answer, score: await ask(c.answer, statement), blockedBy: g.blockedBy });
  }
}

console.log("\n--- judge ranking accuracy ---");
printRow(evaluate("all 58 cases", rows, BANDS));
const reaching = rows.filter((r) => !r.blockedBy);
printRow(evaluate("only what reaches it", reaching, BANDS));

const avg = (xs) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : NaN);
const pj = avg(reaching.filter((r) => r.tier === 8).map((r) => r.score));
const pt = avg(reaching.filter((r) => r.tier <= 2).map((r) => r.score));
console.log(
  `\namong answers that reach the judge: parroting ${Number.isNaN(pj) ? "none left" : pj.toFixed(1)}  vs  best ${pt.toFixed(1)}`,
);

console.log("\ntop scores among answers that would actually reach the judge:");
for (const r of [...reaching].sort((a, b) => b.score - a.score).slice(0, 8)) {
  console.log(`  ${r.score.toFixed(1).padStart(6)}  tier ${String(r.tier).padStart(2)}  "${r.answer}"`);
}

const after = evaluate("x", reaching, BANDS);
console.log(
  `\nVERDICT: gates block ${blockedParrots.length}/${parrots.length} parrots; judge is ${verdictFor(after.pairAcc)} (${after.pairAcc.toFixed(1)}%) on what gets through.`,
);
await jev.dispose?.();
