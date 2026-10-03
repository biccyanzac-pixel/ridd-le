/**
 * Offline analysis of the scores collected by run-collect.mjs. No model, so
 * this can be re-run freely without touching the judge.
 *
 * Answers, for both rounds:
 *   1. Can the MODEL ALONE suppress restatement? i.e. is there a threshold on
 *      some parrot question that catches every restatement without rejecting
 *      a genuine answer. That is what it would take to retire the word-filter
 *      gate rather than keep it as a fallback.
 *   2. Which single question best judges "is this really the answer"?
 *   3. Do two or three calls beat one, and by how much, using fixed untuned
 *      combinations plus a fitted one scored leave-one-group-out so the
 *      number is not inflated by tuning on the same cases.
 *
 *   node scripts/riddle-bench/analyse-judges.mjs /tmp/collected-webgpu.json
 */
import fs from "node:fs";
import { RIDDLE_COMPONENTS, BONUS_COMPONENTS } from "./judge-specs.mjs";
import { pairwiseAccuracy, spearman, mean, verdictFor } from "./metrics.mjs";

const file = process.argv[2] || "collected.json";
const data = JSON.parse(fs.readFileSync(file, "utf8"));
console.log(`backend: ${data.device}/${data.dtype}  (the one players get)\n`);

/** Highest-tier-number band is always the worst answers. */
const ROUNDS = [
  {
    name: "MAIN RIDDLE",
    rows: data.riddle,
    comps: RIDDLE_COMPONENTS,
    good: (t) => t <= 4,
    parrot: (t) => t === 8,
    junk: (t) => t >= 9,
    mid: (t) => t >= 5 && t <= 7,
  },
  {
    name: "BONUS (opposite of)",
    rows: data.bonus,
    comps: BONUS_COMPONENTS,
    good: (t) => t <= 3,
    parrot: (t) => t === 5, // same subject but not an opposite
    junk: (t) => t === 6,
    mid: (t) => t === 4,
  },
];

for (const round of ROUNDS) {
  const { name, rows, comps } = round;
  if (!rows?.length) {
    console.log(`\n### ${name}: no rows collected\n`);
    continue;
  }
  const names = Object.keys(comps);
  console.log(`\n############ ${name}  (${rows.length} cases) ############`);

  // ---- 1. can the model alone gate restatement?
  console.log(`\n--- 1. model-only suppression of restatement/near-miss answers ---`);
  console.log(`    (a clean gate needs every bad case above every good one)`);
  for (const n of names) {
    if (comps[n].role !== "parrot") continue;
    const bad = rows.filter((r) => round.parrot(r.tier)).map((r) => r.comp[n]);
    const good = rows.filter((r) => round.good(r.tier)).map((r) => r.comp[n]);
    const hi = comps[n].sign === -1 ? bad : good; // for sign +1 components, good should be higher
    const lo = comps[n].sign === -1 ? good : bad;
    // Best achievable threshold: maximise caught-bad while losing no good.
    const sorted = [...new Set([...bad, ...good])].sort((a, b) => a - b);
    let best = { caught: 0, lost: 0, thr: null };
    for (const thr of sorted) {
      const caught = comps[n].sign === -1 ? bad.filter((x) => x >= thr).length : bad.filter((x) => x <= thr).length;
      const lost = comps[n].sign === -1 ? good.filter((x) => x >= thr).length : good.filter((x) => x <= thr).length;
      if (lost === 0 && caught > best.caught) best = { caught, lost, thr };
    }
    console.log(
      `  ${n.padEnd(18)} bad ${mean(bad).toFixed(1).padStart(5)}  good ${mean(good).toFixed(1).padStart(5)}  sep ${(mean(hi) - mean(lo)).toFixed(1).padStart(6)}  best clean threshold catches ${best.caught}/${bad.length} (losing 0 good)`,
    );
  }

  // ---- 2. single questions, ranked by how well they order everything
  console.log(`\n--- 2. single question: ordering quality over all tiers ---`);
  const singles = names
    .map((n) => {
      const scored = rows.map((r) => ({ tier: r.tier, score: comps[n].sign * r.comp[n] }));
      return {
        n,
        role: comps[n].role,
        pairAcc: pairwiseAccuracy(scored),
        rho: spearman(scored.map((s) => s.tier), scored.map((s) => s.score)),
        goodVsJunk:
          mean(rows.filter((r) => round.good(r.tier)).map((r) => comps[n].sign * r.comp[n])) -
          mean(rows.filter((r) => round.junk(r.tier)).map((r) => comps[n].sign * r.comp[n])),
        goodVsParrot:
          mean(rows.filter((r) => round.good(r.tier)).map((r) => comps[n].sign * r.comp[n])) -
          mean(rows.filter((r) => round.parrot(r.tier)).map((r) => comps[n].sign * r.comp[n])),
      };
    })
    .sort((a, b) => b.pairAcc - a.pairAcc);
  for (const s of singles) {
    console.log(
      `  ${s.n.padEnd(18)} [${s.role.padEnd(8)}] pairAcc ${s.pairAcc.toFixed(1).padStart(5)}%  rho ${s.rho.toFixed(2).padStart(5)}  good-vs-junk ${s.goodVsJunk >= 0 ? "+" : ""}${s.goodVsJunk.toFixed(1).padStart(6)}  good-vs-parrot ${s.goodVsParrot >= 0 ? "+" : ""}${s.goodVsParrot.toFixed(1).padStart(6)}  ${verdictFor(s.pairAcc)}`,
    );
  }

  // ---- 3. multi-call combinations
  console.log(`\n--- 3. combinations (2 and 3 calls), fixed and untuned ---`);
  const z = (xs) => {
    const m = mean(xs);
    const s = Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) || 1;
    return xs.map((x) => (x - m) / s);
  };
  // z-score each component once so differences are on a comparable scale
  const zc = {};
  for (const n of names) zc[n] = z(rows.map((r) => r.comp[n]));
  const combos = [];
  for (let i = 0; i < names.length; i += 1) {
    for (let j = 0; j < names.length; j += 1) {
      if (i === j) continue;
      const a = names[i];
      const b = names[j];
      // only combine a quality signal with a penalty/filter signal
      if (comps[a].role !== "quality") continue;
      if (comps[b].role === "quality") continue;
      const scored = rows.map((r, k) => ({
        tier: r.tier,
        score: comps[a].sign * zc[a][k] + comps[b].sign * zc[b][k],
      }));
      combos.push({ label: `${a} + ${b}`, pairAcc: pairwiseAccuracy(scored), parts: 2 });
    }
  }
  // 3-call: best quality + two different non-quality signals
  const qualities = names.filter((n) => comps[n].role === "quality");
  const filters = names.filter((n) => comps[n].role !== "quality");
  for (const q of qualities) {
    for (let i = 0; i < filters.length; i += 1) {
      for (let j = i + 1; j < filters.length; j += 1) {
        const scored = rows.map((r, k) => ({
          tier: r.tier,
          score:
            comps[q].sign * zc[q][k] +
            comps[filters[i]].sign * zc[filters[i]][k] +
            comps[filters[j]].sign * zc[filters[j]][k],
        }));
        combos.push({ label: `${q} + ${filters[i]} + ${filters[j]}`, pairAcc: pairwiseAccuracy(scored), parts: 3 });
      }
    }
  }
  combos.sort((a, b) => b.pairAcc - a.pairAcc);
  console.log(`  best 2-call:`);
  for (const c of combos.filter((c) => c.parts === 2).slice(0, 5)) {
    console.log(`    ${c.pairAcc.toFixed(1).padStart(5)}%  ${c.label}`);
  }
  console.log(`  best 3-call:`);
  for (const c of combos.filter((c) => c.parts === 3).slice(0, 5)) {
    console.log(`    ${c.pairAcc.toFixed(1).padStart(5)}%  ${c.label}`);
  }

  // Selecting the best of many combinations on the same data is itself a form
  // of tuning, so the winner is re-checked leave-one-group-out: pick the best
  // combination on the other groups, score it on the held-out one.
  const groups = [...new Set(rows.map((r) => r.group))];
  let heldOutCorrect = 0;
  let heldOutTotal = 0;
  const picks = [];
  for (const g of groups) {
    const trainIdx = rows.map((r, k) => [r, k]).filter(([r]) => r.group !== g);
    const testIdx = rows.map((r, k) => [r, k]).filter(([r]) => r.group === g);
    let bestLabel = null;
    let bestAcc = -1;
    for (const c of combos) {
      const parts = c.label.split(" + ");
      const scored = trainIdx.map(([r, k]) => ({
        tier: r.tier,
        score: parts.reduce((t, p) => t + comps[p].sign * zc[p][k], 0),
      }));
      const acc = pairwiseAccuracy(scored);
      if (acc > bestAcc) {
        bestAcc = acc;
        bestLabel = c.label;
      }
    }
    const parts = bestLabel.split(" + ");
    const scoredTest = testIdx.map(([r, k]) => ({
      tier: r.tier,
      score: parts.reduce((t, p) => t + comps[p].sign * zc[p][k], 0),
    }));
    const acc = pairwiseAccuracy(scoredTest);
    picks.push({ g, bestLabel, acc });
    heldOutCorrect += acc * scoredTest.length;
    heldOutTotal += scoredTest.length;
  }
  console.log(`\n  held-out check (combination chosen without seeing the test group):`);
  for (const p of picks) {
    console.log(`    ${p.g.slice(0, 22).padEnd(24)} ${p.acc.toFixed(1).padStart(5)}%   picked: ${p.bestLabel}`);
  }
  const hoAvg = heldOutCorrect / heldOutTotal;
  const shippedAcc = singles.find((s) => s.n === "shipped").pairAcc;
  console.log(
    `\n  SUMMARY ${name}: shipped ${shippedAcc.toFixed(1)}%  |  best in-sample combo ${combos[0].pairAcc.toFixed(1)}%  |  honest held-out ${hoAvg.toFixed(1)}%  -> ${verdictFor(hoAvg)}`,
  );
}
