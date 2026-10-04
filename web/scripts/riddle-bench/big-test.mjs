/**
 * The big run: every framing against every case we have, real and invented,
 * so conclusions rest on more than nine answers to one prompt.
 *
 * Two specific questions it has to settle.
 *
 * 1. Can the MODEL catch the parroting the word-gate cannot? jacob's live
 *    answers to "What can become more true when you stop believing it?" -
 *    "the truth" (70.27), "the belief that truth" (79.87), "the truth that
 *    could become exceedingly more truthful if you were to" (73.98) - all
 *    pass the gate, because "truth" and "belief" are derived forms of the
 *    riddle's "true" and "believing" rather than inflections of them.
 *    Tightening the word rules to cover derivations risks the over-blocking
 *    the prefix experiment already showed. A semantic question might not
 *    care about spelling at all.
 *
 * 2. Does the "without" framing that transformed the bonus round on the wifi
 *    prompt (36.4% -> 81.8%) hold up across all eight prompts, including
 *    abstractions like nostalgia and bureaucracy where "what you have when
 *    you have no X" may not read sensibly?
 *
 *   node scripts/riddle-bench/big-test.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import { pairwiseAccuracy, spearman, mean } from "./metrics.mjs";

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
  if (/backend|phase|FAILED|DONE/.test(m.text())) console.log(`  ${m.text()}`);
});
await page.goto("http://localhost:5173/scripts/riddle-bench/big-test.html", {
  waitUntil: "domcontentloaded",
});
await page.waitForFunction(() => window.__BIG_DONE__ === true, null, { timeout: 90 * 60 * 1000 });
const d = await page.evaluate(() => window.__BIG__);
await browser.close();
if (d.error) {
  console.error(d.error);
  process.exit(1);
}
fs.writeFileSync("big-test-scores.json", JSON.stringify(d, null, 2));
console.log(`\nbackend ${d.device}/${d.dtype}\n`);

// ---------------------------------------------------------------- parroting
console.log("### 1. parroting the word-gate misses: can the model see it?");
console.log("    (gate verdict shown as blocked/passes; every one of these PASSES the gate)\n");
const byFraming = [...new Set(d.parrot.map((r) => r.framing))];
const answers = [...new Set(d.parrot.map((r) => r.answer))];
console.log(`    ${"answer".padEnd(52)} ${byFraming.map((f) => f.slice(0, 11).padStart(12)).join("")}`);
for (const a of answers) {
  const label = d.parrot.find((r) => r.answer === a);
  const cells = byFraming
    .map((f) => {
      const row = d.parrot.find((r) => r.answer === a && r.framing === f);
      return (row ? row.score.toFixed(1) : "-").padStart(12);
    })
    .join("");
  console.log(`  ${label.isParrot ? "P" : " "} ${a.slice(0, 50).padEnd(52)}${cells}`);
}
console.log("\n    P = parroting/echoing. For a usable penalty, P rows must score HIGH on a");
console.log("    detector column and genuine rows LOW, with no overlap.\n");
for (const f of byFraming) {
  const rows = d.parrot.filter((r) => r.framing === f);
  const p = rows.filter((r) => r.isParrot).map((r) => r.score);
  const g = rows.filter((r) => !r.isParrot).map((r) => r.score);
  const clean = Math.min(...p) > Math.max(...g);
  console.log(
    `  ${f.padEnd(20)} parrot ${mean(p).toFixed(1).padStart(5)}  genuine ${mean(g).toFixed(1).padStart(5)}  separation ${(mean(p) - mean(g)).toFixed(1).padStart(6)}  ${clean ? "CLEAN SPLIT - usable as a veto" : `overlap (worst parrot ${Math.min(...p).toFixed(1)} vs best genuine ${Math.max(...g).toFixed(1)})`}`,
  );
}

// ------------------------------------------------------------------- bonus
console.log("\n### 2. does the 'without' framing generalise across prompts?\n");
const framings = [...new Set(d.bonus.map((r) => r.framing))];
const prompts = [...new Set(d.bonus.map((r) => r.prompt))];
console.log(`    ${"prompt".padEnd(32)} ${framings.map((f) => f.slice(0, 13).padStart(14)).join("")}`);
for (const p of prompts) {
  const cells = framings
    .map((f) => {
      const rows = d.bonus.filter((r) => r.prompt === p && r.framing === f);
      return `${pairwiseAccuracy(rows).toFixed(0)}%`.padStart(14);
    })
    .join("");
  console.log(`  ${p.slice(0, 32).padEnd(34)}${cells}`);
}
console.log("");
for (const f of framings) {
  const rows = d.bonus.filter((r) => r.framing === f);
  const perPrompt = prompts.map((p) => pairwiseAccuracy(rows.filter((r) => r.prompt === p)));
  const good = rows.filter((r) => r.tier <= 2).map((r) => r.score);
  console.log(
    `  ${f.padEnd(16)} overall ${pairwiseAccuracy(rows).toFixed(1).padStart(5)}%  rho ${spearman(rows.map((r) => r.tier), rows.map((r) => r.score)).toFixed(2).padStart(5)}  worst prompt ${Math.min(...perPrompt).toFixed(0).padStart(3)}%  best-answer avg ${mean(good).toFixed(1).padStart(5)}  top ${Math.max(...rows.map((r) => r.score)).toFixed(1).padStart(5)}`,
  );
}
const best = framings
  .map((f) => {
    const rows = d.bonus.filter((r) => r.framing === f);
    return { f, acc: pairwiseAccuracy(rows), worst: Math.min(...prompts.map((p) => pairwiseAccuracy(rows.filter((r) => r.prompt === p)))) };
  })
  .sort((a, b) => b.acc - a.acc)[0];
console.log(
  `\n  best overall: ${best.f} at ${best.acc.toFixed(1)}%, worst single prompt ${best.worst.toFixed(0)}% -> ${
    best.acc >= 70 && best.worst >= 55 ? "GENERALISES - safe to ship" : best.acc >= 65 ? "good overall but weak on some prompts" : "does not generalise"
  }`,
);
