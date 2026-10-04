/**
 * Drives real-collect.html and reports, for each framing: whether it orders
 * REAL player answers sensibly, and whether good answers get genuinely high
 * numbers. The second part matters as much as the first - a scorer that
 * ranks correctly but puts every answer near zero is not a game.
 *
 *   node scripts/riddle-bench/run-real.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import { pairwiseAccuracy, mean, spearman } from "./metrics.mjs";
import { REAL_BONUS } from "./real-answers.mjs";

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"],
});
const page = await (await browser.newContext()).newPage();
page.on("console", (m) => {
  if (/backend|done|DONE|FAILED/.test(m.text())) console.log(`  ${m.text()}`);
});
await page.goto("http://localhost:5173/scripts/riddle-bench/real-collect.html", {
  waitUntil: "domcontentloaded",
});
await page.waitForFunction(() => window.__REAL_DONE__ === true, null, { timeout: 60 * 60 * 1000 });
const d = await page.evaluate(() => window.__REAL__);
await browser.close();
if (d.error) {
  console.error(d.error);
  process.exit(1);
}
fs.writeFileSync("real-scores.json", JSON.stringify(d, null, 2));
console.log(`\nbackend ${d.device}/${d.dtype}\n`);

function summarise(label, rows, goodTier, badTier) {
  const framings = [...new Set(rows.map((r) => r.framing))];
  console.log(`### ${label}`);
  console.log(
    `  ${"framing".padEnd(16)} pairAcc   rho    best-answer avg   worst-answer avg   top score   spread`,
  );
  const out = [];
  for (const f of framings) {
    const rs = rows.filter((r) => r.framing === f);
    const good = rs.filter((r) => r.tier <= goodTier).map((r) => r.score);
    const bad = rs.filter((r) => r.tier >= badTier).map((r) => r.score);
    const acc = pairwiseAccuracy(rs);
    const rho = spearman(rs.map((r) => r.tier), rs.map((r) => r.score));
    const res = {
      f,
      acc,
      rho,
      good: mean(good),
      bad: mean(bad),
      top: Math.max(...rs.map((r) => r.score)),
      spread: Math.max(...rs.map((r) => r.score)) - Math.min(...rs.map((r) => r.score)),
    };
    out.push(res);
    console.log(
      `  ${f.padEnd(16)} ${acc.toFixed(1).padStart(5)}%  ${rho.toFixed(2).padStart(5)}  ${res.good.toFixed(1).padStart(14)}  ${res.bad.toFixed(1).padStart(17)}  ${res.top.toFixed(1).padStart(9)}  ${res.spread.toFixed(1).padStart(7)}`,
    );
  }
  out.sort((a, b) => b.acc - a.acc);
  console.log(`\n  best ordering: ${out[0].f} (${out[0].acc.toFixed(1)}%)`);
  const rewarding = out.filter((o) => o.good > o.bad && o.top >= 60).sort((a, b) => b.acc - a.acc);
  console.log(
    `  orders correctly AND rewards good answers (top >= 60): ${rewarding.length ? rewarding.map((o) => `${o.f} ${o.acc.toFixed(0)}%/top ${o.top.toFixed(0)}`).join(", ") : "NONE"}\n`,
  );
  return out;
}

const bonus = summarise("BONUS - real answers to 'opposite of wifi'", d.bonus, 2, 5);
summarise("MAIN RIDDLE - real answers", d.riddle, 2, 5);

// The specific comparison jacob raised.
console.log("=== jacob's point: should 'off the grid' beat 'nothing'? ===");
for (const f of [...new Set(d.bonus.map((r) => r.framing))]) {
  const get = (a) => d.bonus.find((r) => r.framing === f && r.answer === a)?.score ?? NaN;
  const grid = get("off the grid");
  const nothing = get("nothing");
  const eth = get("ethernet cable");
  const fiveg = get("5g mobile network connection");
  console.log(
    `  ${f.padEnd(16)} off-the-grid ${grid.toFixed(1).padStart(5)}  nothing ${nothing.toFixed(1).padStart(5)}  ethernet ${eth.toFixed(1).padStart(5)}  5g ${fiveg.toFixed(1).padStart(5)}   ${grid > nothing && eth > nothing ? "CORRECT" : "still wrong"}`,
  );
}
console.log(`\n  (shipped, as players saw it: off-the-grid 3.39, nothing 10.57, ethernet 1.04, 5g 1.19)`);
