/**
 * Which backend JUDGES BETTER - not just whether they agree.
 *
 * backend-equivalence.mjs measured agreement: cpu differs from webgpu by up
 * to 2.87 points with 11 of 312 pairs ordered differently. That says they
 * disagree; it does not say which one is closer to the hand-assigned tiers.
 * This scores each backend against the benchmark and compares.
 *
 * Also prints the actual scores the shipped judge gives the worst tiers,
 * because "random answers don't score very high" is a reasonable thing to
 * expect and worth checking against real numbers rather than an average.
 *
 *   node scripts/riddle-bench/backend-accuracy.mjs cpu.json webgpu.json [collected.json]
 */
import fs from "node:fs";
import { pairwiseAccuracy, spearman, mean, verdictFor } from "./metrics.mjs";

const files = process.argv.slice(2).filter((a) => a.endsWith(".json"));
const BANDS = { good: (t) => t <= 4, junk: (t) => t >= 8 };

console.log("=== which backend is closer to the hand-assigned tiers? ===\n");
const summaries = [];
for (const f of files.slice(0, 2)) {
  const d = JSON.parse(fs.readFileSync(f, "utf8"));
  const rows = d.rows ?? d.riddle?.map((r) => ({ ...r, score: r.comp?.shipped })) ?? [];
  if (!rows.length || rows[0].score == null) continue;
  const acc = pairwiseAccuracy(rows);
  const rho = spearman(rows.map((r) => r.tier), rows.map((r) => r.score));
  const good = mean(rows.filter((r) => BANDS.good(r.tier)).map((r) => r.score));
  const junk = mean(rows.filter((r) => BANDS.junk(r.tier)).map((r) => r.score));
  summaries.push({ label: `${d.device}/${d.dtype}`, acc, rho, good, junk, n: rows.length });
  console.log(
    `${`${d.device}/${d.dtype}`.padEnd(14)} n=${rows.length}  pairAcc ${acc.toFixed(1)}%  rho ${rho.toFixed(3)}  good ${good.toFixed(2)}  junk ${junk.toFixed(2)}  -> ${verdictFor(acc)}`,
  );
}
if (summaries.length === 2) {
  const [a, b] = summaries;
  const d = Math.abs(a.acc - b.acc);
  console.log(
    `\ndifference in ranking accuracy: ${d.toFixed(2)} percentage points (${d < 2 ? "indistinguishable - neither backend judges better" : `${a.acc > b.acc ? a.label : b.label} is better`})`,
  );
  console.log(
    "note: cpu is reachable only from node. A browser resolves to webgpu or wasm, so even if cpu scored better it could not be shipped.",
  );
}

// --- what do the worst answers actually score?
const collected = files.find((f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")).riddle?.[0]?.comp;
  } catch {
    return false;
  }
});
if (collected) {
  const d = JSON.parse(fs.readFileSync(collected, "utf8"));
  console.log(`\n=== what the shipped judge actually gives bad answers (${d.device}/${d.dtype}) ===`);
  const byTier = new Map();
  for (const r of d.riddle) {
    if (!byTier.has(r.tier)) byTier.set(r.tier, []);
    byTier.get(r.tier).push(r);
  }
  const LABEL = {
    1: "excellent", 2: "strong", 3: "plausible", 4: "defensible", 5: "stretching",
    6: "vague", 7: "literal, resolves nothing", 8: "parroting", 9: "unrelated", 10: "nonsense",
  };
  for (const t of [...byTier.keys()].sort((x, y) => x - y)) {
    const xs = byTier.get(t).map((r) => r.comp.shipped);
    console.log(
      `  tier ${String(t).padStart(2)} ${LABEL[t].padEnd(26)} mean ${mean(xs).toFixed(1).padStart(5)}  range ${Math.min(...xs).toFixed(1)}-${Math.max(...xs).toFixed(1)}`,
    );
  }
  console.log("\n  every tier-9/10 answer and its score:");
  for (const r of d.riddle.filter((x) => x.tier >= 9).sort((a, b) => b.comp.shipped - a.comp.shipped)) {
    console.log(`    ${r.comp.shipped.toFixed(1).padStart(5)}  tier ${r.tier}  "${r.answer}"`);
  }
}
