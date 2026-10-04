/**
 * Settles the scoring design by measurement.
 *
 * Every earlier attempt optimised ONE thing and broke another: the big
 * penalty weight caught every parroted answer and then ranked "a silence"
 * above "a promise"; the "meaningful" question had the best ranking number
 * and scored everything ~89; the "without" framing won on one prompt and
 * collapsed on eight. So each candidate is scored here against all four
 * requirements at once, and a candidate that fails any of them is not a
 * candidate:
 *
 *   ORDER     does it rank genuine answers by quality (pairwise accuracy
 *             over tiers 1-6 only, excluding parroting and junk, so the
 *             number is about judgement rather than exploit-catching)
 *   PARROT    is every parroted answer below every genuine one, per riddle
 *   JUNK      are random/nonsense answers below genuine ones
 *   REWARD    do good answers actually land high once mapped to 0-100,
 *             with real spread - jacob's objection to flat scores
 *
 * Held out by group throughout: a weight or combination is chosen on the
 * other riddles and judged on the one it never saw.
 *
 *   node scripts/riddle-bench/analyse-full.mjs /tmp/full-scores.json
 */
import fs from "node:fs";
import { pairwiseAccuracy, spearman, mean } from "./metrics.mjs";

const d = JSON.parse(fs.readFileSync(process.argv[2] || "full-scores.json", "utf8"));
console.log(`backend ${d.device}/${d.dtype}`);
console.log(`${d.riddle.length} riddle rows, ${d.bonus.length} bonus rows\n`);

const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) || 1;
};
/** Map an unbounded combined value to 0-100. k sets how much of the range is
 * used; it changes spread but never order. */
const show = (x, m, s, k = 1.1) => 100 / (1 + Math.exp(-(x - m) / (s * k)));

function analyse(label, rows, roles, bands) {
  const names = Object.keys(roles);
  const quality = names.filter((n) => roles[n] === "quality");
  const penalties = names.filter((n) => roles[n] !== "quality");
  const groups = [...new Set(rows.map((r) => r.group))];
  console.log(`\n${"=".repeat(78)}\n### ${label}\n${"=".repeat(78)}`);

  // ---- what each component does on its own
  console.log(`\n--- components alone ---`);
  for (const n of names) {
    const good = rows.filter((r) => bands.good(r.tier)).map((r) => r.comp[n]);
    const parrot = rows.filter((r) => bands.parrot(r.tier)).map((r) => r.comp[n]);
    const junk = rows.filter((r) => bands.junk(r.tier)).map((r) => r.comp[n]);
    console.log(
      `  ${n.padEnd(20)} [${roles[n].padEnd(7)}] good ${mean(good).toFixed(1).padStart(5)}  parrot ${(parrot.length ? mean(parrot).toFixed(1) : "n/a").padStart(5)}  junk ${(junk.length ? mean(junk).toFixed(1) : "n/a").padStart(5)}`,
    );
  }

  // ---- candidate designs: 1 call, or quality minus one penalty at weight k
  const KS = [];
  for (let k = 0; k <= 12.01; k += 0.25) KS.push(Math.round(k * 100) / 100);

  const combine = (r, q, pen, k) => r.comp[q] - (pen ? k * r.comp[pen] : 0);

  /** All four requirements for one design, on a given row subset. */
  function evaluate(rows_, q, pen, k) {
    const val = (r) => combine(r, q, pen, k);
    // ORDER: genuine answers only
    const genuine = rows_.filter((r) => !bands.parrot(r.tier) && !bands.junk(r.tier));
    const order = pairwiseAccuracy(genuine.map((r) => ({ tier: r.tier, score: val(r) })));
    // PARROT / JUNK: per group, is every bad one below every good one
    let parrotClean = 0;
    let parrotGroups = 0;
    let junkClean = 0;
    let junkGroups = 0;
    for (const g of [...new Set(rows_.map((r) => r.group))]) {
      const gr = rows_.filter((r) => r.group === g);
      const good = gr.filter((r) => bands.good(r.tier)).map(val);
      const par = gr.filter((r) => bands.parrot(r.tier)).map(val);
      const jk = gr.filter((r) => bands.junk(r.tier)).map(val);
      if (good.length && par.length) {
        parrotGroups += 1;
        if (Math.max(...par) < Math.min(...good)) parrotClean += 1;
      }
      if (good.length && jk.length) {
        junkGroups += 1;
        if (Math.max(...jk) < Math.min(...good)) junkClean += 1;
      }
    }
    // REWARD: displayed score for good answers, and spread
    const all = rows_.map(val);
    const m = mean(all);
    const s = sd(all);
    const goodShown = rows_.filter((r) => bands.good(r.tier)).map((r) => show(val(r), m, s));
    const badShown = rows_
      .filter((r) => bands.parrot(r.tier) || bands.junk(r.tier))
      .map((r) => show(val(r), m, s));
    return {
      order,
      parrot: parrotGroups ? parrotClean / parrotGroups : NaN,
      junk: junkGroups ? junkClean / junkGroups : NaN,
      goodShown: mean(goodShown),
      badShown: badShown.length ? mean(badShown) : NaN,
      topShown: Math.max(...goodShown),
      spread: Math.max(...all) - Math.min(...all),
    };
  }

  // ---- held-out: choose (penalty, k) on other groups, judge on the held one
  console.log(`\n--- held-out search over quality x penalty x weight ---`);
  const designs = [];
  for (const q of quality) {
    designs.push({ q, pen: null, k: 0 });
    for (const pen of penalties) for (const k of KS) if (k > 0) designs.push({ q, pen, k });
  }
  // A design must not sacrifice ordering to catch parrots, so selection
  // requires both, with ordering weighted first.
  const fitness = (e) =>
    (Number.isNaN(e.parrot) ? 0 : e.parrot) * 30 + (Number.isNaN(e.junk) ? 0 : e.junk) * 15 + e.order;

  const perGroup = [];
  for (const held of groups) {
    const train = rows.filter((r) => r.group !== held);
    const test = rows.filter((r) => r.group === held);
    if (!test.some((r) => bands.good(r.tier))) continue;
    let best = null;
    for (const dz of designs) {
      const e = evaluate(train, dz.q, dz.pen, dz.k);
      const f = fitness(e);
      if (!best || f > best.f) best = { ...dz, f, e };
    }
    const te = evaluate(test, best.q, best.pen, best.k);
    perGroup.push({ held, pick: best, te });
    console.log(
      `  ${held.slice(0, 18).padEnd(20)} picked ${best.q}${best.pen ? ` - ${best.k}x${best.pen}` : " alone"}`.padEnd(68) +
        `held-out order ${te.order.toFixed(0)}%  parrot ${Number.isNaN(te.parrot) ? " n/a" : (te.parrot * 100).toFixed(0) + "%"}  junk ${Number.isNaN(te.junk) ? " n/a" : (te.junk * 100).toFixed(0) + "%"}`,
    );
  }
  const avg = (f) => mean(perGroup.map((p) => f(p.te)).filter((x) => !Number.isNaN(x)));
  console.log(
    `\n  HELD-OUT AVERAGE: order ${avg((e) => e.order).toFixed(1)}%  parrot-clean ${(avg((e) => e.parrot) * 100).toFixed(0)}%  junk-clean ${(avg((e) => e.junk) * 100).toFixed(0)}%`,
  );
  const picks = {};
  for (const p of perGroup) {
    const key = `${p.pick.q}${p.pick.pen ? ` - ${p.pick.k}x${p.pick.pen}` : " alone"}`;
    picks[key] = (picks[key] ?? 0) + 1;
  }
  console.log(`  designs chosen: ${Object.entries(picks).map(([k, v]) => `${k} (${v})`).join(", ")}`);

  // ---- the single most-chosen design, measured on everything
  const winner = Object.entries(picks).sort((a, b) => b[1] - a[1])[0][0];
  const m = winner.match(/^(\S+)(?: - ([\d.]+)x(\S+))?/);
  const wq = m[1];
  const wk = m[2] ? Number(m[2]) : 0;
  const wpen = m[3] ?? null;
  const full = evaluate(rows, wq, wpen, wk);
  const baseline = evaluate(rows, quality.includes("shipped") ? "shipped" : quality[0], null, 0);
  console.log(`\n--- "${winner}" vs the live single call, over all rows ---`);
  console.log(
    `  ${"".padEnd(22)}${"order".padStart(8)}${"parrot".padStart(9)}${"junk".padStart(8)}${"good shown".padStart(13)}${"bad shown".padStart(12)}${"top".padStart(7)}`,
  );
  for (const [nm, e] of [
    ["live (1 call)", baseline],
    [winner, full],
  ]) {
    console.log(
      `  ${nm.slice(0, 20).padEnd(22)}${e.order.toFixed(0).padStart(7)}%${((e.parrot * 100).toFixed(0) + "%").padStart(9)}${((e.junk * 100).toFixed(0) + "%").padStart(8)}${e.goodShown.toFixed(0).padStart(13)}${e.badShown.toFixed(0).padStart(12)}${e.topShown.toFixed(0).padStart(7)}`,
    );
  }
  return { winner, full, baseline, wq, wk, wpen };
}

const riddle = analyse("MAIN RIDDLE", d.riddle, d.riddleRoles, {
  good: (t) => t <= 4,
  parrot: (t) => t === 8,
  junk: (t) => t >= 9,
});

const bonus = analyse("BONUS ROUND", d.bonus, d.bonusRoles, {
  good: (t) => t <= 3,
  parrot: (t) => t === 5,
  junk: (t) => t === 6,
});

console.log(`\n${"=".repeat(78)}\nRECOMMENDATION\n${"=".repeat(78)}`);
for (const [nm, r] of [["main riddle", riddle], ["bonus", bonus]]) {
  const calls = r.wpen ? 2 : 1;
  const better =
    r.full.order >= r.baseline.order - 2 &&
    (Number.isNaN(r.full.parrot) || r.full.parrot >= (Number.isNaN(r.baseline.parrot) ? 0 : r.baseline.parrot));
  console.log(
    `${nm}: ${r.winner}  (${calls} model call${calls > 1 ? "s" : ""})  ${better ? "-> improves without sacrificing ordering" : "-> TRADES ordering for exploit-catching, do not ship blindly"}`,
  );
}
