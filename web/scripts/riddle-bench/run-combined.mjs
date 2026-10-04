/**
 * Does one question asking both things beat the live question, and beat the
 * two-call penalty that dragged every answer down?
 *
 * Reported in plain terms: what a good real answer scores, what a reworded
 * riddle scores, what nonsense scores, and whether good is comfortably on
 * top. No composite metrics - those are what made the earlier reports
 * impossible to follow.
 *
 *   node scripts/riddle-bench/run-combined.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import { mean } from "./metrics.mjs";

const exe = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const b = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"],
});
const p = await (await b.newContext()).newPage();
p.on("console", (m) => {
  if (/backend|DONE|FAILED/.test(m.text())) console.log(`  ${m.text()}`);
});
await p.goto("http://localhost:5173/scripts/riddle-bench/combined-question.html", {
  waitUntil: "domcontentloaded",
});
await p.waitForFunction(() => window.__CQ_DONE__ === true, null, { timeout: 120 * 60 * 1000 });
const d = await p.evaluate(() => window.__CQ__);
await b.close();
if (d.error) {
  console.error(d.error);
  process.exit(1);
}
fs.writeFileSync("combined-scores.json", JSON.stringify(d, null, 2));
console.log(`\nbackend ${d.device}/${d.dtype}\n`);

const framings = [...new Set(d.rows.map((r) => r.framing))];
// "good" uses only REAL production answers plus the hand-written genuine
// answers in the paraphrase sets - never the invented tiers that proved
// unreliable.
const isGood = (r) => (r.set === "real" && r.tier <= 4) || (r.set === "paraphrase" && r.tier === 2);
const isReworded = (r) => r.tier === 8;
const isNonsense = (r) => r.set === "invented" && r.tier >= 9;

console.log("all numbers are out of 100, averaged\n");
console.log(
  `  ${"framing".padEnd(16)}${"good".padStart(7)}${"reworded".padStart(10)}${"nonsense".padStart(10)}   does good win?`,
);
const rank = [];
for (const f of framings) {
  const rs = d.rows.filter((r) => r.framing === f);
  const g = mean(rs.filter(isGood).map((r) => r.score));
  const w = mean(rs.filter(isReworded).map((r) => r.score));
  const n = mean(rs.filter(isNonsense).map((r) => r.score));
  const wins = g > w + 5 && g > n + 5;
  rank.push({ f, g, w, n, wins });
  console.log(
    `  ${f.padEnd(16)}${g.toFixed(0).padStart(7)}${w.toFixed(0).padStart(10)}${n.toFixed(0).padStart(10)}   ${wins ? `YES  (+${(g - w).toFixed(0)} over reworded, +${(g - n).toFixed(0)} over nonsense)` : g <= w ? `NO - reworded wins by ${(w - g).toFixed(0)}` : `NO - nonsense too close`}`,
  );
}

const winners = rank.filter((r) => r.wins).sort((a, b) => b.g - a.g);
console.log(
  `\nframings where good answers win AND keep a high score: ${winners.length ? winners.map((w) => `${w.f} (good ${w.g.toFixed(0)})`).join(", ") : "NONE"}`,
);

if (winners.length) {
  const best = winners[0];
  console.log(`\n--- "${best.f}" on real answers, highest first ---`);
  for (const r of d.rows
    .filter((r) => r.framing === best.f && r.set === "real")
    .sort((a, b) => b.score - a.score)) {
    console.log(`  ${r.score.toFixed(0).padStart(3)}   ${r.answer.slice(0, 44)}`);
  }
  console.log(`\n--- "${best.f}" on reworded riddles ---`);
  for (const r of d.rows
    .filter((r) => r.framing === best.f && isReworded(r))
    .sort((a, b) => b.score - a.score)) {
    console.log(`  ${r.score.toFixed(0).padStart(3)}   ${r.answer.slice(0, 52)}`);
  }
}
