/**
 * Shared scoring metrics for the judge benchmarks.
 *
 * pairwiseAccuracy is the one to read first: over every pair of answers whose
 * hand-assigned tier differs, how often does the judge rank the better one
 * higher? 50% is a coin flip. sweep.mjs reported only relative comparisons
 * between statements, which cannot tell you whether the winner is good enough
 * to rank a leaderboard at all.
 */

export const mean = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length;

export const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

export function spearman(tiers, scores) {
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

/** Fraction of differing-tier pairs ordered correctly. Score ties take half
 * credit, the usual AUC convention. */
export function pairwiseAccuracy(rows) {
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

export function verdictFor(pairAcc) {
  if (pairAcc >= 75) return "usable";
  if (pairAcc >= 65) return "marginal";
  if (pairAcc >= 57) return "weak";
  return "~coin flip";
}

/** `bands` maps a tier to one of good / hard / junk. */
export function evaluate(label, rows, bands) {
  const scores = rows.map((r) => r.score);
  const pick = (pred) => rows.filter((r) => pred(r.tier)).map((r) => r.score);
  const good = pick(bands.good);
  const hard = pick(bands.hard);
  const junk = pick(bands.junk);
  const cutoff = [...scores].sort((a, b) => b - a)[Math.floor(scores.length / 4)];
  return {
    label,
    n: rows.length,
    pairAcc: pairwiseAccuracy(rows),
    spearman: spearman(
      rows.map((r) => r.tier),
      scores,
    ),
    goodMean: mean(good),
    hardMean: hard.length ? mean(hard) : NaN,
    junkMean: junk.length ? mean(junk) : NaN,
    hardGap: hard.length ? mean(good) - mean(hard) : NaN,
    easyGap: junk.length ? mean(good) - mean(junk) : NaN,
    spread: sd(scores),
    topLeak: rows.filter((r) => bands.junk(r.tier) && r.score >= cutoff).length,
    junkCount: junk.length,
  };
}

export function printRow(r) {
  const f = (x, w = 5) => (Number.isNaN(x) ? "  n/a" : `${x >= 0 ? "" : ""}${x.toFixed(1)}`.padStart(w));
  console.log(
    `${r.label.padEnd(22)} n=${String(r.n).padStart(3)}  pairAcc ${f(r.pairAcc)}%  rho ${r.spearman.toFixed(2).padStart(5)}  good ${f(r.goodMean)}  hard ${f(r.hardMean)}  junk ${f(r.junkMean)}  hardGap ${f(r.hardGap)}  easyGap ${f(r.easyGap)}  spread ${f(r.spread)}  junkInTop ${r.topLeak}/${r.junkCount}  ${verdictFor(r.pairAcc)}`,
  );
}
