/**
 * Does multi-call scoring still earn its keep once the gate removes parroting?
 *
 * Two things became clear from the per-tier scores:
 *
 *   - Nonsense and unrelated answers already score LOW (tier 9 mean 20.2,
 *     tier 10 mean 26.8) - below genuine answers at ~28. Earlier reports of
 *     "nonsense outscores good answers" were an artefact of bundling tier 8
 *     (parroting, mean 80.3) into the same band as tiers 9-10. The judge
 *     handles nonsense correctly; parroting is the single real defect.
 *   - Parroting is what the gate removes before the judge is ever asked.
 *
 * So the honest question for shipping is not "does multi-call beat the
 * shipped judge" but "does it beat the shipped judge on the answers that
 * actually reach it, once parroting is gone". If the gate alone closes most
 * of the gap, three model calls per attempt are not worth it.
 *
 *   node scripts/riddle-bench/post-gate-value.mjs /tmp/collected-webgpu.json
 */
import fs from "node:fs";
import { RIDDLE_COMPONENTS, BONUS_COMPONENTS } from "./judge-specs.mjs";
import { pairwiseAccuracy, mean, verdictFor } from "./metrics.mjs";

const data = JSON.parse(fs.readFileSync(process.argv[2] || "collected.json", "utf8"));
console.log(`backend: ${data.device}/${data.dtype}\n`);

const z = (xs) => {
  const m = mean(xs);
  const s = Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) || 1;
  return xs.map((x) => (x - m) / s);
};

function analyse(label, rows, comps, parrotTier, combosToTry) {
  const names = Object.keys(comps);
  const zc = {};
  for (const n of names) zc[n] = z(rows.map((r) => r.comp[n]));

  const score = (parts) => (r, k) => parts.reduce((t, p) => t + comps[p].sign * zc[p][k], 0);
  const run = (parts, filter) => {
    const scored = rows
      .map((r, k) => ({ tier: r.tier, score: score(parts)(r, k) }))
      .filter((_, k) => filter(rows[k]));
    return pairwiseAccuracy(scored);
  };

  const all = () => true;
  const gated = (r) => r.tier !== parrotTier;

  console.log(`### ${label}`);
  console.log(`  parroting tier excluded = what the gate already removes\n`);
  console.log(`  ${"combination".padEnd(52)} all cases   after gate   gain`);
  for (const parts of combosToTry) {
    const a = run(parts, all);
    const g = run(parts, gated);
    console.log(
      `  ${parts.join(" + ").padEnd(52)} ${a.toFixed(1).padStart(6)}%   ${g.toFixed(1).padStart(7)}%   ${(g - a >= 0 ? "+" : "") + (g - a).toFixed(1)}`,
    );
  }
  const shippedAll = run(["shipped"], all);
  const shippedGated = run(["shipped"], gated);
  const bestGated = Math.max(...combosToTry.map((p) => run(p, gated)));
  const bestLabel = combosToTry.find((p) => run(p, gated) === bestGated).join(" + ");
  console.log(
    `\n  shipped alone: ${shippedAll.toFixed(1)}% -> ${shippedGated.toFixed(1)}% once parroting is gated out`,
  );
  console.log(`  best combination after gating: ${bestGated.toFixed(1)}% (${bestLabel})`);
  const marginal = bestGated - shippedGated;
  console.log(
    `  marginal value of the extra model calls, given the gate: ${marginal >= 0 ? "+" : ""}${marginal.toFixed(1)} points -> ${
      marginal >= 8 ? "WORTH THE EXTRA CALLS" : marginal >= 4 ? "modest - defensible" : "NOT WORTH IT: ship the gate alone"
    }\n`,
  );
  return { shippedGated, bestGated, marginal, bestLabel };
}

const riddle = analyse("MAIN RIDDLE", data.riddle, RIDDLE_COMPONENTS, 8, [
  ["shipped"],
  ["meaningful"],
  ["shipped", "restates"],
  ["shipped", "answersWithRiddle"],
  ["shipped", "meaningful"],
  ["shipped", "restates", "answersWithRiddle"],
  ["shipped", "restates", "meaningful"],
]);

const bonus = analyse("BONUS (opposite of)", data.bonus, BONUS_COMPONENTS, 5, [
  ["shipped"],
  ["opposedMeaning"],
  ["declarative"],
  ["opposedMeaning", "sameTopicOnly"],
  ["opposedMeaning", "notSameThing"],
  ["opposedMeaning", "notSameThing", "sameTopicOnly"],
]);

console.log("=== bottom line ===");
console.log(
  `main riddle: gate alone gets ${riddle.shippedGated.toFixed(1)}%; extra calls add ${riddle.marginal >= 0 ? "+" : ""}${riddle.marginal.toFixed(1)} -> ${verdictFor(riddle.bestGated)}`,
);
console.log(
  `bonus round: has no deterministic gate, so its ${bonus.bestGated.toFixed(1)}% (${bonus.bestLabel}) is the only option above ${bonus.shippedGated.toFixed(1)}%`,
);
