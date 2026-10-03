/**
 * Can several NARROW questions do what one broad question cannot?
 *
 * Established so far: asked "is this a plausible interpretation that resolves
 * the riddle", the model ranks at ~52% and scores restatements 12.9 points
 * ABOVE genuine answers. Asked the narrow question "is this a restatement?",
 * it gets restatements 25.6 points above genuine ones - the right way round,
 * and the largest clean signal this model has given. Comparative A/B judging
 * is unusable (48-51%, position bias: it picks the same letter 70-87% of the
 * time when the answers are swapped).
 *
 * So this measures each narrow question separately against the tier band it
 * is meant to catch, then combines them.
 *
 * Guarding against fooling ourselves: with 58 cases, weights tuned on all of
 * them would fit noise. So fixed, untuned combinations are reported first,
 * and the fitted combination is evaluated leave-one-riddle-out - trained on
 * four riddles, tested on the fifth, rotated - which is the honest estimate
 * of how it would behave on a riddle nobody tuned against.
 *
 *   node scripts/riddle-bench/decomposed-judge.mjs
 *
 * Read-only: submits nothing, deploys nothing.
 */
import { OpenJev, noul } from "open-jev";
import { canonicalizeForJudge } from "../../../shared/judge-canonicalize.js";
import { riddleStatement } from "../../../shared/challenges.js";
import { RIDDLES } from "./cases.mjs";
import { evaluate, printRow, pairwiseAccuracy, mean, verdictFor } from "./metrics.mjs";

const MODEL = "kev-0.6b";
const BANDS = { good: (t) => t <= 4, hard: (t) => t >= 5 && t <= 7, junk: (t) => t >= 8 };

/** Each component is a narrow question plus the band it is supposed to
 * separate, so its usefulness is measured against its own job rather than
 * against overall quality. `sign` is +1 when a high score should mean a
 * better answer. */
const COMPONENTS = {
  shipped: {
    sign: +1,
    build: (r) => riddleStatement(r),
    targets: "overall quality (the current single question)",
    hi: (t) => t <= 4,
    lo: (t) => t >= 8,
  },
  restate: {
    sign: -1,
    build: (r) => `This is a restatement of the riddle "${r}", not an answer to it.`,
    targets: "restatement (tier 8)",
    hi: (t) => t === 8,
    lo: (t) => t <= 4,
  },
  sameSubject: {
    sign: +1,
    build: (r) => `The answer is about the same subject as the riddle "${r}".`,
    targets: "relevance (tiers 1-6 vs 9-10)",
    hi: (t) => t <= 6,
    lo: (t) => t >= 9,
  },
  concrete: {
    sign: +1,
    build: () => `The answer names a specific thing rather than a vague abstraction.`,
    targets: "vagueness (tier 6)",
    hi: (t) => t <= 4,
    lo: (t) => t === 6,
  },
  addsIdea: {
    sign: +1,
    build: (r) => `The answer introduces an idea that the riddle "${r}" does not already state.`,
    targets: "novelty (tiers 1-4 vs 8)",
    hi: (t) => t <= 4,
    lo: (t) => t === 8,
  },
  explainsHow: {
    sign: +1,
    build: (r) => `The answer explains how the riddle "${r}" can be true.`,
    targets: "resolution (tiers 1-4 vs 7)",
    hi: (t) => t <= 4,
    lo: (t) => t === 7,
  },
};

const jev = await OpenJev.load({ model: MODEL, dtype: "auto" });
console.log(`loaded on ${jev.runtime.device}, dtype ${jev.runtime.dtype}`);
const names = Object.keys(COMPONENTS);
console.log(`${names.length} components x 58 cases = ${names.length * 58} model calls\n`);

const ask = async (state, statement) => {
  const [v] = await jev.decide(canonicalizeForJudge(state), [noul(statement)]);
  return v.probability * 100;
};

// rows: one per case, carrying every component's raw score
const rows = [];
for (const r of RIDDLES) {
  for (const c of r.cases) {
    const comp = {};
    for (const [name, spec] of Object.entries(COMPONENTS)) {
      comp[name] = await ask(c.answer, spec.build(r.prompt));
    }
    rows.push({ riddle: r.id, tier: c.tier, answer: c.answer, comp });
  }
}

console.log("=== each component, measured against its own job ===");
for (const [name, spec] of Object.entries(COMPONENTS)) {
  const hi = rows.filter((x) => spec.hi(x.tier)).map((x) => x.comp[name]);
  const lo = rows.filter((x) => spec.lo(x.tier)).map((x) => x.comp[name]);
  const sep = mean(hi) - mean(lo);
  const overlap = Math.min(...hi) <= Math.max(...lo);
  console.log(
    `  ${name.padEnd(12)} ${spec.targets.padEnd(42)} hi ${mean(hi).toFixed(1).padStart(5)}  lo ${mean(lo).toFixed(1).padStart(5)}  sep ${sep >= 0 ? "+" : ""}${sep.toFixed(1).padStart(6)}  ${overlap ? "overlapping" : "CLEAN SPLIT"}`,
  );
}

// ---------------------------------------------------------------- combinations
const z = (xs) => {
  const m = mean(xs);
  const s = Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) || 1;
  return xs.map((x) => (x - m) / s);
};

/** Fixed, untuned combinations - no weights fitted to this data. */
const FIXED = {
  "shipped alone": (x) => x.comp.shipped,
  "shipped - restate": (x) => x.comp.shipped - x.comp.restate,
  "sameSubject - restate": (x) => x.comp.sameSubject - x.comp.restate,
  "addsIdea - restate": (x) => x.comp.addsIdea - x.comp.restate,
  "equal-weight all": (x) =>
    names.reduce((t, n) => t + COMPONENTS[n].sign * x.comp[n], 0) / names.length,
  "relevance x novelty, minus restatement": (x) =>
    (x.comp.sameSubject / 100) * (x.comp.addsIdea / 100) * 100 - x.comp.restate,
};

console.log("\n=== fixed combinations (no weights fitted) ===");
const fixedResults = [];
for (const [label, score] of Object.entries(FIXED)) {
  const scored = rows.map((x) => ({ tier: x.tier, score: score(x) }));
  const res = evaluate(label, scored, BANDS);
  fixedResults.push(res);
  printRow(res);
}

// -------------------------------------------- fitted, leave-one-riddle-out CV
// Least-squares linear fit of components -> -tier (so higher = better), with
// each held-out riddle scored by weights it never saw.
function fitWeights(trainRows) {
  // Ridge-regularised normal equations, solved by Gauss-Jordan. Small and
  // explicit rather than pulling in a matrix library.
  const X = trainRows.map((r) => [1, ...names.map((n) => r.comp[n] / 100)]);
  const y = trainRows.map((r) => -r.tier);
  const d = X[0].length;
  const A = Array.from({ length: d }, () => new Array(d).fill(0));
  const b = new Array(d).fill(0);
  for (let i = 0; i < X.length; i += 1) {
    for (let p = 0; p < d; p += 1) {
      b[p] += X[i][p] * y[i];
      for (let q = 0; q < d; q += 1) A[p][q] += X[i][p] * X[i][q];
    }
  }
  for (let p = 1; p < d; p += 1) A[p][p] += 1e-2; // ridge, bias left unpenalised
  for (let col = 0; col < d; col += 1) {
    let piv = col;
    for (let r2 = col + 1; r2 < d; r2 += 1) if (Math.abs(A[r2][col]) > Math.abs(A[piv][col])) piv = r2;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    const pv = A[col][col] || 1e-9;
    for (let q = col; q < d; q += 1) A[col][q] /= pv;
    b[col] /= pv;
    for (let r2 = 0; r2 < d; r2 += 1) {
      if (r2 === col) continue;
      const f = A[r2][col];
      if (!f) continue;
      for (let q = col; q < d; q += 1) A[r2][q] -= f * A[col][q];
      b[r2] -= f * b[col];
    }
  }
  return b;
}
const applyWeights = (w, r) => w[0] + names.reduce((t, n, i) => t + w[i + 1] * (r.comp[n] / 100), 0);

console.log("\n=== fitted combination, leave-one-riddle-out ===");
const heldOut = [];
for (const r of RIDDLES) {
  const train = rows.filter((x) => x.riddle !== r.id);
  const test = rows.filter((x) => x.riddle === r.id);
  const w = fitWeights(train);
  const scored = test.map((x) => ({ tier: x.tier, score: applyWeights(w, x) }));
  heldOut.push(...scored);
  console.log(`  ${r.id.slice(0, 22).padEnd(24)} held-out pairAcc ${pairwiseAccuracy(scored).toFixed(1)}%  (n=${scored.length})`);
}
const cv = evaluate("fitted (LOO-CV)", heldOut, BANDS);
printRow(cv);

// For reference only: the same fit scored on the data it was trained on,
// which is the number to distrust.
const wAll = fitWeights(rows);
const inSample = evaluate(
  "fitted (in-sample, optimistic)",
  rows.map((x) => ({ tier: x.tier, score: applyWeights(wAll, x) })),
  BANDS,
);
printRow(inSample);

console.log("\n=== summary ===");
const best = [...fixedResults, cv].sort((a, b) => b.pairAcc - a.pairAcc)[0];
console.log(`shipped single question: ${fixedResults[0].pairAcc.toFixed(1)}%`);
console.log(`best honest alternative: ${best.label} at ${best.pairAcc.toFixed(1)}% -> ${verdictFor(best.pairAcc)}`);
console.log(
  best.pairAcc >= 65
    ? "WORTH BUILDING: decomposition gets the judge into usable territory."
    : best.pairAcc - fixedResults[0].pairAcc >= 8
      ? "REAL IMPROVEMENT but still short of reliable - a better score, not a trustworthy ranking."
      : "NO REAL GAIN: decomposition does not rescue it either.",
);
await jev.dispose?.();
