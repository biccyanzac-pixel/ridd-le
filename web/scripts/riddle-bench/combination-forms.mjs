/**
 * Linear subtraction fixes parroting and breaks nonsense: it lifts tiers 9-10
 * from 20-27 up to 58-60, level with excellent answers, because nonsense
 * earns almost no namesNoThing penalty ("a sandwich" does name a thing) while
 * every score shifts up together.
 *
 * The requirement is three-sided, so the shape of the combination matters,
 * not just its weight:
 *   tiers 1-4  high        (good answers rewarded)
 *   tier 8     low         (parroting punished)
 *   tiers 9-10 low         (nonsense punished - the live judge already does
 *                           this, so any candidate must not undo it)
 *
 * Multiplicative forms are the obvious thing linear subtraction is missing: a
 * penalty that SCALES the quality score cannot lift an answer whose quality
 * was low to begin with, which is exactly the property nonsense needs.
 *
 * Free: reads the collected scores, runs no model.
 *
 *   node scripts/riddle-bench/combination-forms.mjs /tmp/full-scores.json
 */
import fs from "node:fs";
import { pairwiseAccuracy, mean } from "./metrics.mjs";

const d = JSON.parse(fs.readFileSync(process.argv[2] || "full-scores.json", "utf8"));
const rows = d.riddle;
const LABEL = {
  1: "excellent", 2: "strong", 3: "plausible", 4: "defensible", 5: "stretch",
  6: "vague", 7: "literal", 8: "PARROT", 9: "unrelated", 10: "nonsense",
};

const q = (r) => r.comp.shipped / 100;
const p = (r) => r.comp.namesNoThing / 100;
const rest = (r) => r.comp.restates / 100;

/** Candidate forms. Each returns 0..100 directly so no distribution-wide
 * mapping is needed - a score the game can compute for one answer alone. */
const FORMS = {
  "live: quality": (r) => q(r) * 100,
  "linear: q - 5.75p": (r) => (q(r) - 5.75 * p(r)) * 100,
  "multiply: q(1-p)": (r) => q(r) * (1 - p(r)) * 100,
  "multiply: q(1-p)^2": (r) => q(r) * (1 - p(r)) ** 2 * 100,
  "multiply: q(1-p)^3": (r) => q(r) * (1 - p(r)) ** 3 * 100,
  "multiply: q(1-p)^4": (r) => q(r) * (1 - p(r)) ** 4 * 100,
  "gate: q if p<.3 else q/4": (r) => (p(r) < 0.3 ? q(r) : q(r) / 4) * 100,
  "gate: q if p<.3 else 0": (r) => (p(r) < 0.3 ? q(r) : 0) * 100,
  "multiply both: q(1-p)^3(1-rest)": (r) => q(r) * (1 - p(r)) ** 3 * (1 - rest(r)) * 100,
};

const tiers = [...new Set(rows.map((r) => r.tier))].sort((a, b) => a - b);
console.log(`backend ${d.device}/${d.dtype}   ${rows.length} riddle answers\n`);
console.log(
  `${"form".padEnd(32)}${tiers.map((t) => String(t).padStart(5)).join("")}   order  parrotOK  junkOK`,
);
console.log(
  `${" ".repeat(32)}${tiers.map((t) => LABEL[t].slice(0, 4).padStart(5)).join("")}`,
);

const results = [];
for (const [name, f] of Object.entries(FORMS)) {
  const byTier = tiers.map((t) => mean(rows.filter((r) => r.tier === t).map(f)));
  // ordering among genuine answers only (1-6), so exploit-catching cannot inflate it
  const genuine = rows.filter((r) => r.tier <= 6);
  const order = pairwiseAccuracy(genuine.map((r) => ({ tier: r.tier, score: f(r) })));
  // per-group strictness: every bad answer below every good one
  const groups = [...new Set(rows.map((r) => r.group))];
  const strict = (badPred) => {
    let ok = 0;
    let n = 0;
    for (const g of groups) {
      const gr = rows.filter((r) => r.group === g);
      const good = gr.filter((r) => r.tier <= 4).map(f);
      const bad = gr.filter((r) => badPred(r.tier)).map(f);
      if (!good.length || !bad.length) continue;
      n += 1;
      if (Math.max(...bad) < Math.min(...good)) ok += 1;
    }
    return n ? (ok / n) * 100 : NaN;
  };
  const parrotOK = strict((t) => t === 8);
  const junkOK = strict((t) => t >= 9);
  results.push({ name, byTier, order, parrotOK, junkOK, f });
  console.log(
    `${name.padEnd(32)}${byTier.map((v) => v.toFixed(0).padStart(5)).join("")}  ${order.toFixed(0).padStart(5)}%  ${(Number.isNaN(parrotOK) ? "n/a" : parrotOK.toFixed(0) + "%").padStart(7)}  ${(Number.isNaN(junkOK) ? "n/a" : junkOK.toFixed(0) + "%").padStart(6)}`,
  );
}

console.log(`\n=== which forms satisfy all three requirements? ===`);
console.log(`(good tiers 1-4 must beat tier 8 AND tiers 9-10, by a visible margin)\n`);
for (const r of results) {
  const good = mean([0, 1, 2, 3].map((i) => r.byTier[i]));
  const parrot = r.byTier[tiers.indexOf(8)];
  const junk = mean([9, 10].filter((t) => tiers.includes(t)).map((t) => r.byTier[tiers.indexOf(t)]));
  const ok = good > parrot + 10 && good > junk + 10;
  console.log(
    `  ${r.name.padEnd(32)} good ${good.toFixed(0).padStart(3)}  parrot ${parrot.toFixed(0).padStart(3)}  junk ${junk.toFixed(0).padStart(3)}  order ${r.order.toFixed(0)}%  ${ok ? "SATISFIES ALL THREE" : "fails"}`,
  );
}

const viable = results.filter((r) => {
  const good = mean([0, 1, 2, 3].map((i) => r.byTier[i]));
  const parrot = r.byTier[tiers.indexOf(8)];
  const junk = mean([9, 10].filter((t) => tiers.includes(t)).map((t) => r.byTier[tiers.indexOf(t)]));
  return good > parrot + 10 && good > junk + 10;
});
if (viable.length) {
  const best = viable.sort((a, b) => b.order - a.order)[0];
  console.log(`\nbest viable form: ${best.name} (ordering ${best.order.toFixed(1)}%)`);
  console.log(`\n--- that form on the live exploit riddle ---`);
  for (const r of rows
    .filter((x) => x.prompt.includes("safer the more people"))
    .sort((a, b) => best.f(b) - best.f(a))) {
    console.log(`  ${best.f(r).toFixed(0).padStart(4)}  ${LABEL[r.tier].padEnd(10)}  ${r.answer.slice(0, 58)}`);
  }
} else {
  console.log(`\nNO form satisfies all three with the components available.`);
}
