/**
 * Drives browser-bench.html so the tiered benchmark runs on the SAME backend
 * the players use, then reports the same metrics as the node-side runs.
 *
 * The node benchmarks all resolved to the "cpu" device. The repository's own
 * WASM investigation found WebGPU-q4 and plain-WASM-q4 agree to within 0.01
 * with zero binary flips, but "cpu" was not part of that comparison - so
 * before concluding anything about production scoring, the numbers need
 * reproducing on a real browser backend.
 *
 *   # dev server must be running in web/ (npm run dev)
 *   node scripts/riddle-bench/run-browser-bench.mjs
 *
 * Read-only: submits nothing, writes nothing.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import { evaluate, printRow, verdictFor } from "./metrics.mjs";

const URL = process.argv[2] || "http://localhost:5173/scripts/riddle-bench/browser-bench.html";
const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  // WebGPU is off by default in headless Chromium; ask for it so this can
  // exercise the same backend as a real visitor where possible.
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"],
});
const page = await (await browser.newContext()).newPage();
page.on("console", (m) => {
  const t = m.text();
  if (/loaded on|done|FAILED|ALL DONE/.test(t)) console.log(`  [page] ${t}`);
});

console.log(`opening ${URL}`);
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__BENCH_DONE__ === true, null, { timeout: 30 * 60 * 1000 });
const out = await page.evaluate(() => window.__BENCH__);
await browser.close();

if (out.error) {
  console.error(`\nbenchmark failed in the browser: ${out.error}`);
  process.exit(1);
}

console.log(`\nbackend actually used: ${out.device} / ${out.dtype}   rows: ${out.rows.length}\n`);

const BANDS = { good: (t) => t <= 4, hard: (t) => t >= 5 && t <= 7, junk: (t) => t >= 8 };
const all = evaluate(`browser: ${out.device}`, out.rows, BANDS);
printRow(all);

const parrot = out.rows.filter((r) => r.tier === 8).map((r) => r.score);
const top = out.rows.filter((r) => r.tier <= 2).map((r) => r.score);
const avg = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length;
console.log(
  `parroting(tier8) ${avg(parrot).toFixed(1)}  vs  best answers(tier1-2) ${avg(top).toFixed(1)}  ${avg(top) > avg(parrot) ? "correct order" : "INVERTED"}`,
);

console.log("\nper riddle:");
for (const id of [...new Set(out.rows.map((r) => r.riddle))]) {
  printRow(evaluate(`  ${id.slice(0, 20)}`, out.rows.filter((r) => r.riddle === id), BANDS));
}

console.log("\nhighest-scoring answers overall (what a leaderboard would show):");
for (const r of [...out.rows].sort((a, b) => b.score - a.score).slice(0, 8)) {
  console.log(`  ${r.score.toFixed(1).padStart(6)}  tier ${r.tier}  "${r.answer}"`);
}

console.log(
  `\nCONCLUSION: ${verdictFor(all.pairAcc)} on the real browser backend (${out.device}).`,
);
