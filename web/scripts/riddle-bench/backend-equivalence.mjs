/**
 * Do all backends really score the same answer the same way?
 *
 * The repository's WASM investigation found WebGPU-q4 and plain-WASM-q4 agree
 * to within 0.01 with zero binary flips, and the dtype is pinned to "q4"
 * everywhere so no device can silently load q4f16. But the node benchmarks
 * resolve to the "cpu" device, which that comparison never covered, and the
 * whole point of pinning the dtype was that every player gets identical
 * numbers. So this checks it per case rather than by comparing aggregates.
 *
 * Writes this backend's per-case scores to a JSON file. Run it once in node
 * (cpu), once via run-browser-bench.mjs --save (webgpu/wasm), then pass both
 * files back in to diff them:
 *
 *   node scripts/riddle-bench/backend-equivalence.mjs --out cpu.json
 *   node scripts/riddle-bench/backend-equivalence.mjs --diff cpu.json webgpu.json
 *
 * Read-only with respect to the game: submits nothing, deploys nothing.
 */
import fs from "node:fs";
import { riddleStatement } from "../../../shared/challenges.js";
import { RIDDLES } from "./cases.mjs";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const diffIdx = args.indexOf("--diff");

if (diffIdx !== -1) {
  const [fa, fb] = [args[diffIdx + 1], args[diffIdx + 2]];
  const a = JSON.parse(fs.readFileSync(fa, "utf8"));
  const b = JSON.parse(fs.readFileSync(fb, "utf8"));
  console.log(`A: ${a.device}/${a.dtype} (${a.rows.length} rows)   B: ${b.device}/${b.dtype} (${b.rows.length} rows)\n`);

  const key = (r) => `${r.riddle}||${r.answer}`;
  const mapB = new Map(b.rows.map((r) => [key(r), r.score]));
  const diffs = [];
  let missing = 0;
  for (const r of a.rows) {
    if (!mapB.has(key(r))) {
      missing += 1;
      continue;
    }
    diffs.push({ answer: r.answer, riddle: r.riddle, a: r.score, b: mapB.get(key(r)), d: Math.abs(r.score - mapB.get(key(r))) });
  }
  diffs.sort((x, y) => y.d - x.d);
  const ds = diffs.map((d) => d.d);
  const maxD = Math.max(...ds);
  const meanD = ds.reduce((t, x) => t + x, 0) / ds.length;
  // A "flip" is a pair of answers the two backends would rank differently -
  // the thing that actually matters for a leaderboard.
  let flips = 0;
  let pairs = 0;
  for (let i = 0; i < diffs.length; i += 1) {
    for (let j = i + 1; j < diffs.length; j += 1) {
      if (diffs[i].riddle !== diffs[j].riddle) continue;
      pairs += 1;
      const oa = Math.sign(diffs[i].a - diffs[j].a);
      const ob = Math.sign(diffs[i].b - diffs[j].b);
      if (oa !== 0 && ob !== 0 && oa !== ob) flips += 1;
    }
  }
  console.log(`compared ${diffs.length} cases (${missing} unmatched)`);
  console.log(`max  absolute difference: ${maxD.toFixed(4)} points`);
  console.log(`mean absolute difference: ${meanD.toFixed(4)} points`);
  console.log(`ranking flips: ${flips}/${pairs} same-riddle pairs`);
  console.log("\nlargest differences:");
  for (const d of diffs.slice(0, 6)) {
    console.log(`  ${d.d.toFixed(4).padStart(8)}  ${d.a.toFixed(2).padStart(6)} vs ${d.b.toFixed(2).padStart(6)}  "${d.answer}"`);
  }
  const verdict =
    maxD <= 0.01 && flips === 0
      ? "EQUIVALENT: within the 0.01 tolerance the repo claims, no ranking flips."
      : maxD <= 1 && flips === 0
        ? "CONSISTENT ENOUGH: differences above 0.01 but no ranking flips - same leaderboard, slightly different numbers."
        : "NOT EQUIVALENT: players on different backends would see different results.";
  console.log(`\n${verdict}`);
  process.exit(0);
}

// --- scoring mode
const { OpenJev, noul } = await import("open-jev");
const { canonicalizeForJudge } = await import("../../../shared/judge-canonicalize.js");
const jev = await OpenJev.load({ model: "kev-0.6b", dtype: "auto" });
const out = { device: jev.runtime?.device ?? "unknown", dtype: jev.runtime?.dtype ?? "unknown", rows: [] };
console.log(`scoring on ${out.device}/${out.dtype}`);

for (const r of RIDDLES) {
  const statement = riddleStatement(r.prompt);
  for (const c of r.cases) {
    const [v] = await jev.decide(canonicalizeForJudge(c.answer), [noul(statement)]);
    out.rows.push({ riddle: r.id, tier: c.tier, answer: c.answer, score: v.probability * 100 });
  }
}
const file = outIdx !== -1 ? args[outIdx + 1] : "backend-scores.json";
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`wrote ${out.rows.length} rows to ${file}`);
await jev.dispose?.();
