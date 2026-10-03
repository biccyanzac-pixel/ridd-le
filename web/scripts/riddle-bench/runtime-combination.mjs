/**
 * Is the recommended combination actually implementable at runtime?
 *
 * The 60.6% / 64.1% figures came from z-scoring each component ACROSS THE
 * WHOLE BENCHMARK and then subtracting. That is not something the game can
 * do: when a player submits one answer, there is no distribution to
 * normalise against. So those numbers describe a scorer that cannot be
 * built, which makes them useless for shipping.
 *
 * What CAN be shipped is fixed constants: normalise each component by a mean
 * and spread measured once, offline, and baked into the code. This measures
 * that honestly - the constants are fitted on four groups and the accuracy
 * read off the fifth, rotated, so the reported number is for a riddle the
 * constants were never fitted to.
 *
 * Also reports the plain raw difference (no constants at all), since if that
 * is nearly as good it is the simpler thing to ship.
 *
 *   node scripts/riddle-bench/runtime-combination.mjs /tmp/collected-webgpu.json
 */
import fs from "node:fs";
import { RIDDLE_COMPONENTS, BONUS_COMPONENTS } from "./judge-specs.mjs";
import { pairwiseAccuracy, mean, verdictFor } from "./metrics.mjs";

const data = JSON.parse(fs.readFileSync(process.argv[2] || "collected.json", "utf8"));
console.log(`backend: ${data.device}/${data.dtype}\n`);

const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) || 1;
};
/** Squash any real number into 0..1 so the result is still a bounded score
 * that can be shown as 0-100. k controls how much of the range is used. */
const logistic = (x, k = 1) => 1 / (1 + Math.exp(-x / k));

function study(label, rows, comps, quality, penalty, parrotTier) {
  console.log(`### ${label}:  ${quality}  minus  ${penalty}`);
  const gated = rows.filter((r) => r.tier !== parrotTier); // post-gate, the realistic case
  const groups = [...new Set(gated.map((r) => r.group))];

  // 1. raw difference, no constants - the simplest shippable thing
  const raw = gated.map((r) => ({
    tier: r.tier,
    score: r.comp[quality] - r.comp[penalty],
  }));
  console.log(`  raw difference (no constants)            ${pairwiseAccuracy(raw).toFixed(1)}%`);

  // 2. fixed constants fitted on ALL data - optimistic, shown for contrast
  const allQ = { m: mean(gated.map((r) => r.comp[quality])), s: sd(gated.map((r) => r.comp[quality])) };
  const allP = { m: mean(gated.map((r) => r.comp[penalty])), s: sd(gated.map((r) => r.comp[penalty])) };
  const inSample = gated.map((r) => ({
    tier: r.tier,
    score: (r.comp[quality] - allQ.m) / allQ.s - (r.comp[penalty] - allP.m) / allP.s,
  }));
  console.log(`  fixed constants, fitted on everything    ${pairwiseAccuracy(inSample).toFixed(1)}%  (optimistic)`);

  // 3. fixed constants fitted leave-one-group-out - the honest number
  const heldOut = [];
  for (const g of groups) {
    const train = gated.filter((r) => r.group !== g);
    const test = gated.filter((r) => r.group === g);
    const q = { m: mean(train.map((r) => r.comp[quality])), s: sd(train.map((r) => r.comp[quality])) };
    const p = { m: mean(train.map((r) => r.comp[penalty])), s: sd(train.map((r) => r.comp[penalty])) };
    heldOut.push(
      ...test.map((r) => ({
        tier: r.tier,
        score: (r.comp[quality] - q.m) / q.s - (r.comp[penalty] - p.m) / p.s,
        group: g,
      })),
    );
  }
  const honest = pairwiseAccuracy(heldOut);
  console.log(`  fixed constants, held out                ${honest.toFixed(1)}%  <- the shippable number`);

  // single-question baseline on the same gated rows
  const single = gated.map((r) => ({ tier: r.tier, score: r.comp[quality] }));
  const base = pairwiseAccuracy(single);
  console.log(`  ${quality} alone                        ${base.toFixed(1)}%`);

  // What the player would actually see, using all-data constants.
  const shown = gated.map((r) => ({
    tier: r.tier,
    pct:
      logistic((r.comp[quality] - allQ.m) / allQ.s - (r.comp[penalty] - allP.m) / allP.s, 1.6) * 100,
  }));
  const band = (pred) => {
    const xs = shown.filter((_, i) => pred(gated[i].tier)).map((x) => x.pct);
    return xs.length ? `${mean(xs).toFixed(0)} (${Math.min(...xs).toFixed(0)}-${Math.max(...xs).toFixed(0)})` : "n/a";
  };
  console.log(
    `  displayed 0-100 after squashing: good ${band((t) => t <= (label.startsWith("BONUS") ? 3 : 4))}   weak ${band((t) => t >= (label.startsWith("BONUS") ? 4 : 5))}`,
  );
  console.log(
    `  constants to bake in: ${quality} mean ${allQ.m.toFixed(2)} sd ${allQ.s.toFixed(2)} | ${penalty} mean ${allP.m.toFixed(2)} sd ${allP.s.toFixed(2)}`,
  );
  const gain = honest - base;
  console.log(
    `  => ${gain >= 0 ? "+" : ""}${gain.toFixed(1)} points over the single question -> ${
      gain >= 5 ? "worth shipping" : gain >= 2 ? "marginal" : "NOT worth the second call"
    }\n`,
  );
  return { honest, base, gain };
}

const r = study("MAIN RIDDLE", data.riddle, RIDDLE_COMPONENTS, "shipped", "restates", 8);
const b = study("BONUS", data.bonus, BONUS_COMPONENTS, "opposedMeaning", "sameTopicOnly", 5);

console.log("=== bottom line ===");
console.log(
  `main riddle: ${r.base.toFixed(1)}% -> ${r.honest.toFixed(1)}% (${verdictFor(r.honest)}), ${r.gain >= 5 ? "ship it" : "second call does not earn its place"}`,
);
console.log(
  `bonus:       ${b.base.toFixed(1)}% -> ${b.honest.toFixed(1)}% (${verdictFor(b.honest)}), ${b.gain >= 5 ? "ship it" : "second call does not earn its place"}`,
);
