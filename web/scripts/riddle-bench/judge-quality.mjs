/**
 * How good is a judge statement, in absolute terms?
 *
 * sweep.mjs compared ten riddle statements against each other and reported
 * the winner. That answers "which is best", not "is the best one actually
 * good enough to rank a leaderboard" - and the same question hangs over the
 * bonus round. This measures both on identical metrics so they can be put
 * side by side.
 *
 * The metrics, and why these ones:
 *
 *   pairAcc   Over every pair of answers whose hand-assigned tiers differ,
 *             how often does the judge put the better one higher? 50% is a
 *             coin flip. This is the single number that says whether a
 *             leaderboard means anything, and neither earlier sweep computed
 *             it.
 *   spearman  Rank correlation against the tiers (sweep.mjs computes this for
 *             riddles; included here so riddle and bonus share a scale).
 *   hardGap   Good answers minus answers that are in the right subject area
 *             but wrong (riddle: mid tiers; bonus: tier 5). The realistic
 *             test.
 *   easyGap   Good answers minus outright nonsense. The flattering test that
 *             earlier bonus benchmarks measured by mistake.
 *   spread    Standard deviation of all scores. A judge with a real gap but
 *             no spread still shows every player roughly the same number.
 *   topLeak   How often junk lands in the top quartile of scores. Even a
 *             decent average ordering is unusable if nonsense can win a day.
 *
 *   node scripts/riddle-bench/judge-quality.mjs
 *
 * Read-only: runs the same model the browser runs, writes nothing anywhere.
 */
import { OpenJev, noul } from "open-jev";
import { canonicalizeForJudge } from "../../../shared/judge-canonicalize.js";
import { riddleStatement } from "../../../shared/challenges.js";
import { RIDDLES } from "./cases.mjs";
import { OPPOSITE_CASES } from "./bonus-cases.mjs";

const MODEL = "kev-0.6b";

const mean = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length;
const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

function spearman(tiers, scores) {
  const rank = (values) => {
    const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(values.length);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) ranks[order[k][1]] = avgRank;
      i = j + 1;
    }
    return ranks;
  };
  const rTier = rank(tiers);
  const rScore = rank(scores.map((s) => -s)); // tier low = good, score high = good
  const n = tiers.length;
  const m = (n + 1) / 2;
  let num = 0;
  let dt2 = 0;
  let ds2 = 0;
  for (let i = 0; i < n; i += 1) {
    const dt = rTier[i] - m;
    const ds = rScore[i] - m;
    num += dt * ds;
    dt2 += dt * dt;
    ds2 += ds * ds;
  }
  return num / Math.sqrt(dt2 * ds2);
}

/** Fraction of differing-tier pairs the judge orders correctly. Ties in
 * score count as half credit, the standard AUC convention. */
function pairwiseAccuracy(rows) {
  let correct = 0;
  let total = 0;
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i];
      const b = rows[j];
      if (a.tier === b.tier) continue;
      total += 1;
      const better = a.tier < b.tier ? a : b;
      const worse = a.tier < b.tier ? b : a;
      if (better.score > worse.score) correct += 1;
      else if (better.score === worse.score) correct += 0.5;
    }
  }
  return total ? (correct / total) * 100 : NaN;
}

function report(label, rows, bands) {
  const scores = rows.map((r) => r.score);
  const tiers = rows.map((r) => r.tier);
  const pick = (pred) => rows.filter((r) => pred(r.tier)).map((r) => r.score);
  const good = pick(bands.good);
  const hard = pick(bands.hard);
  const junk = pick(bands.junk);
  const cutoff = [...scores].sort((a, b) => b - a)[Math.floor(scores.length / 4)];
  const leak = rows.filter((r) => bands.junk(r.tier) && r.score >= cutoff).length;
  const out = {
    label,
    n: rows.length,
    pairAcc: pairwiseAccuracy(rows),
    spearman: spearman(tiers, scores),
    hardGap: mean(good) - mean(hard),
    easyGap: mean(good) - mean(junk),
    spread: sd(scores),
    goodMean: mean(good),
    hardMean: mean(hard),
    junkMean: mean(junk),
    topLeak: leak,
    junkCount: junk.length,
  };
  console.log(
    `${label.padEnd(24)} n=${String(out.n).padStart(3)}  pairAcc ${out.pairAcc.toFixed(1).padStart(5)}%  rho ${out.spearman.toFixed(2).padStart(5)}  hardGap ${out.hardGap >= 0 ? "+" : ""}${out.hardGap.toFixed(1).padStart(5)}  easyGap ${out.easyGap >= 0 ? "+" : ""}${out.easyGap.toFixed(1).padStart(5)}  spread ${out.spread.toFixed(1).padStart(5)}  junkInTop ${out.topLeak}/${out.junkCount}`,
  );
  return out;
}

const jev = await OpenJev.load({ model: MODEL, dtype: "auto" });
console.log(`loaded on ${jev.runtime.device}, dtype ${jev.runtime.dtype}\n`);
const ask = async (state, statement) => {
  const [v] = await jev.decide(canonicalizeForJudge(state), [noul(statement)]);
  return v.probability * 100;
};

const summary = [];

// ---------------------------------------------------------------- main riddle
// The SHIPPED statement, on the existing 58-case tiered set. sweep.mjs already
// ranked statements against each other; this asks the different question of
// whether the one in production is good in absolute terms.
{
  const rows = [];
  for (const r of RIDDLES) {
    const statement = riddleStatement(r.prompt);
    for (const c of r.cases) {
      rows.push({ tier: c.tier, score: await ask(c.answer, statement) });
    }
  }
  console.log("--- MAIN RIDDLE (shipped statement) ---");
  // good = tiers 1-4, hard negatives = mid tiers 5-7 (vague / literal /
  // parroting: on-topic but resolving nothing), junk = 8-10.
  summary.push(
    report("riddle: shipped", rows, {
      good: (t) => t <= 4,
      hard: (t) => t >= 5 && t <= 7,
      junk: (t) => t >= 8,
    }),
  );
  // Per-riddle, to see whether the average hides one riddle carrying it.
  for (const r of RIDDLES) {
    const sub = [];
    const statement = riddleStatement(r.prompt);
    for (const c of r.cases) sub.push({ tier: c.tier, score: await ask(c.answer, statement) });
    report(`  ${r.id.slice(0, 20)}`, sub, {
      good: (t) => t <= 4,
      hard: (t) => t >= 5 && t <= 7,
      junk: (t) => t >= 8,
    });
  }
}

// ------------------------------------------------------------- bonus: opposite
// Three framings worth separating: the shipped one, the best from the framing
// sweep, and that framing with the prompt spelled out as a phrase.
const BONUS_STATEMENTS = {
  "bonus: shipped": (p) => `Is the answer a plausible opposite of "${p}"?`,
  "bonus: declarative": (p) => `This is the opposite of "${p}".`,
  "bonus: opposedMeaning": (p) => `This has the opposite meaning to "${p}".`,
};

console.log("\n--- BONUS ROUND (opposite of), tiered incl. related-but-not-opposite ---");
const bonusRows = {};
for (const [label, build] of Object.entries(BONUS_STATEMENTS)) {
  const rows = [];
  for (const item of OPPOSITE_CASES) {
    const statement = build(item.prompt);
    for (const c of item.cases) {
      rows.push({ tier: c.tier, score: await ask(c.answer, statement), kind: item.kind });
    }
  }
  bonusRows[label] = rows;
  summary.push(
    report(label, rows, { good: (t) => t <= 3, hard: (t) => t === 5, junk: (t) => t === 6 }),
  );
}

// Does a richer prompt help? Same statement, split by prompt kind.
console.log("\n--- does prompt kind matter? (best bonus framing, split by kind) ---");
const best = bonusRows["bonus: declarative"];
for (const kind of ["word", "phrase", "concept"]) {
  const sub = best.filter((r) => r.kind === kind);
  report(`  prompt=${kind}`, sub, { good: (t) => t <= 3, hard: (t) => t === 5, junk: (t) => t === 6 });
}

console.log("\n=== side by side ===");
console.log("pairAcc is the headline: 50% is a coin flip, 100% is perfect ordering.\n");
for (const s of summary) {
  const verdict =
    s.pairAcc >= 75 ? "usable" : s.pairAcc >= 65 ? "marginal" : s.pairAcc >= 57 ? "weak" : "≈ coin flip";
  console.log(
    `${s.label.padEnd(24)} pairAcc ${s.pairAcc.toFixed(1).padStart(5)}%  hardGap ${s.hardGap >= 0 ? "+" : ""}${s.hardGap.toFixed(1).padStart(5)}  spread ${s.spread.toFixed(1).padStart(5)}  -> ${verdict}`,
  );
}
await jev.dispose?.();
