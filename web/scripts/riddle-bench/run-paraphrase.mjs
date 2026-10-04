/**
 * Reports which detector can see synonym-paraphrase parroting - the live
 * exploit, where an answer restates the riddle using none of its words and
 * the judge pays 98.77 for it.
 *
 * The bar is deliberately strict, because a detector used as a veto that is
 * wrong on one riddle is worse than none: every paraphrase must score above
 * every genuine answer, on EVERY riddle separately, not just on average.
 *
 *   node scripts/riddle-bench/run-paraphrase.mjs
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
  if (/backend|DONE|FAILED|phase/.test(m.text())) console.log(`  ${m.text()}`);
});
await p.goto("http://localhost:5173/scripts/riddle-bench/paraphrase-test.html", {
  waitUntil: "domcontentloaded",
});
await p.waitForFunction(() => window.__PARA_DONE__ === true, null, { timeout: 90 * 60 * 1000 });
const d = await p.evaluate(() => window.__PARA__);
await b.close();
if (d.error) {
  console.error(d.error);
  process.exit(1);
}
fs.writeFileSync("paraphrase-scores.json", JSON.stringify(d, null, 2));
console.log(`\nbackend ${d.device}/${d.dtype}\n`);

const detectors = [...new Set(d.rows.map((r) => r.detector))];
const riddles = [...new Set(d.rows.map((r) => r.riddle))];

console.log("=== per detector: can it separate paraphrase from genuine? ===\n");
const summary = [];
for (const det of detectors) {
  const rows = d.rows.filter((r) => r.detector === det);
  const para = rows.filter((r) => r.kind === "paraphrase").map((r) => r.score);
  const gen = rows.filter((r) => r.kind === "genuine").map((r) => r.score);
  // clean on every riddle separately - the test that matters
  let cleanRiddles = 0;
  for (const rd of riddles) {
    const pr = rows.filter((r) => r.riddle === rd && r.kind === "paraphrase").map((r) => r.score);
    const ge = rows.filter((r) => r.riddle === rd && r.kind === "genuine").map((r) => r.score);
    if (Math.min(...pr) > Math.max(...ge)) cleanRiddles += 1;
  }
  // a single global threshold that catches all paraphrase with no false positives
  const globalClean = Math.min(...para) > Math.max(...gen);
  summary.push({ det, para: mean(para), gen: mean(gen), cleanRiddles, globalClean, minPara: Math.min(...para), maxGen: Math.max(...gen) });
  console.log(
    `  ${det.padEnd(20)} paraphrase ${mean(para).toFixed(1).padStart(5)}  genuine ${mean(gen).toFixed(1).padStart(5)}  sep ${(mean(para) - mean(gen)).toFixed(1).padStart(6)}  clean on ${cleanRiddles}/${riddles.length} riddles  ${globalClean ? `GLOBAL THRESHOLD WORKS (between ${Math.max(...gen).toFixed(1)} and ${Math.min(...para).toFixed(1)})` : `no global threshold (worst paraphrase ${Math.min(...para).toFixed(1)} <= best genuine ${Math.max(...gen).toFixed(1)})`}`,
  );
}

console.log("\n=== jacob's actual live answer, under each detector ===");
const JACOB = "something that is more safe as greater number of individuals are aware of it";
for (const det of detectors) {
  const row = d.rows.find((r) => r.detector === det && r.answer === JACOB);
  const gen = d.rows
    .filter((r) => r.detector === det && r.riddle.includes("safer") && r.kind === "genuine")
    .map((r) => r.score);
  console.log(
    `  ${det.padEnd(20)} ${row.score.toFixed(1).padStart(5)}   (genuine answers to the same riddle: ${gen.map((g) => g.toFixed(0)).join(", ")})`,
  );
}

console.log("\n=== verdict ===");
const usable = summary.filter((s) => s.globalClean).sort((a, b) => b.para - b.gen - (a.para - a.gen));
const perRiddle = summary.filter((s) => s.cleanRiddles === riddles.length);
if (usable.length) {
  console.log(
    `${usable[0].det} separates every paraphrase from every genuine answer with a single threshold - usable as a veto or a heavy penalty.`,
  );
} else if (perRiddle.length) {
  console.log(
    `${perRiddle[0].det} is clean within each riddle but has no single global threshold, so it can only be used relative to the day's own answers, not as a fixed rule.`,
  );
} else {
  const best = summary.sort((a, b) => b.para - b.gen - (a.para - a.gen))[0];
  console.log(
    `No detector separates paraphrase cleanly. Best is ${best.det} (paraphrase ${best.para.toFixed(1)} vs genuine ${best.gen.toFixed(1)}), usable only as a soft penalty that will sometimes be wrong.`,
  );
}
