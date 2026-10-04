/**
 * namesNoThing separates paraphrase-parroting from genuine answers inside
 * every riddle, but its absolute level moves between riddles, so no fixed
 * threshold works. A penalty subtracted from the score does not need one:
 *
 *   score = quality - k * namesNoThing
 *
 * This finds whether any k puts every paraphrase below every genuine answer,
 * and - the part that matters - whether a k chosen WITHOUT seeing a riddle
 * still works on it. Choosing k on all five would be the same mistake as the
 * "without" framing, which scored 81% on the prompt it was found on and 52%
 * across eight.
 *
 * Free: reads paraphrase-scores.json, runs no model.
 *
 *   node scripts/riddle-bench/penalty-weight.mjs [paraphrase-scores.json]
 */
import fs from "node:fs";

const d = JSON.parse(fs.readFileSync(process.argv[2] || "paraphrase-scores.json", "utf8"));
const riddles = [...new Set(d.rows.map((r) => r.riddle))];

/** All answers for a riddle, with both component scores attached. */
function answersFor(riddle) {
  const quality = d.rows.filter((r) => r.riddle === riddle && r.detector === "shippedQuality");
  return quality.map((q) => ({
    answer: q.answer,
    kind: q.kind,
    quality: q.score,
    penalty: d.rows.find(
      (r) => r.riddle === riddle && r.detector === "namesNoThing" && r.answer === q.answer,
    ).score,
  }));
}

const combined = (a, k) => a.quality - k * a.penalty;

/** Does weight k order this riddle correctly - every paraphrase below every
 * genuine answer? */
function cleanFor(riddle, k) {
  const as = answersFor(riddle);
  const para = as.filter((a) => a.kind === "paraphrase").map((a) => combined(a, k));
  const gen = as.filter((a) => a.kind === "genuine").map((a) => combined(a, k));
  return Math.max(...para) < Math.min(...gen);
}

const KS = [];
for (let k = 0; k <= 60.01; k += 0.25) KS.push(Math.round(k * 100) / 100);

console.log("=== how many riddles each weight orders correctly ===\n");
const scored = KS.map((k) => ({ k, clean: riddles.filter((r) => cleanFor(r, k)).length }));
let shown = 0;
for (const s of scored) {
  if (s.clean === riddles.length && shown < 14) {
    console.log(`  k=${s.k.toFixed(2)}  clean on ${s.clean}/${riddles.length}  <- works everywhere`);
    shown += 1;
  }
}
const working = scored.filter((s) => s.clean === riddles.length);
if (!working.length) {
  const best = scored.sort((a, b) => b.clean - a.clean)[0];
  console.log(`  no weight works on all ${riddles.length}. Best: k=${best.k} on ${best.clean}/${riddles.length}`);
} else {
  console.log(
    `\n  ${working.length} of ${KS.length} weights work on all ${riddles.length} riddles, from k=${working[0].k} to k=${working[working.length - 1].k}`,
  );
}

// ---- the honest test: pick k without seeing the riddle it is judged on
console.log("\n=== leave-one-riddle-out: k chosen on the other four ===\n");
let heldOutOk = 0;
for (const held of riddles) {
  const others = riddles.filter((r) => r !== held);
  // widest band of k that works on the other four, then take its middle
  const ok = KS.filter((k) => others.every((r) => cleanFor(r, k)));
  if (!ok.length) {
    console.log(`  ${held.slice(0, 44).padEnd(46)} no k works on the other four`);
    continue;
  }
  const chosen = ok[Math.floor(ok.length / 2)];
  const works = cleanFor(held, chosen);
  if (works) heldOutOk += 1;
  console.log(
    `  ${held.slice(0, 44).padEnd(46)} k=${chosen.toFixed(2)} (from ${ok.length} candidates)  held-out: ${works ? "CORRECT" : "FAILS"}`,
  );
}
console.log(`\n  held-out success: ${heldOutOk}/${riddles.length}`);

// ---- what the player would see, at a sensible k
const K = working.length ? working[Math.floor(working.length / 2)] : 1.5;
console.log(`\n=== what players would see at k=${K.toFixed(2)} (raw, before any rescaling) ===\n`);
for (const r of riddles) {
  console.log(`  "${r}"`);
  const as = answersFor(r)
    .map((a) => ({ ...a, c: combined(a, K) }))
    .sort((x, y) => y.c - x.c);
  for (const a of as) {
    console.log(
      `    ${a.c.toFixed(1).padStart(7)}  ${(a.kind === "paraphrase" ? "PARROT " : "genuine")}  ${a.answer.slice(0, 58)}`,
    );
  }
  console.log("");
}
console.log(
  `NOTE: the combined value is negative and unbounded, so it still needs mapping to 0-100 for display, and`,
);
console.log(
  `this says nothing about whether the penalty disturbs ordering among ordinary answers - that needs the`,
);
console.log(`58-case set re-collected with namesNoThing before it could be shipped.`);
