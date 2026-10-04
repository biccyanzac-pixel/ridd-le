/**
 * Drives full-collect.html and saves every component score per case.
 *
 *   node scripts/riddle-bench/run-full.mjs [--out file.json]
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const exe = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));
const outIdx = process.argv.indexOf("--out");
const outFile = outIdx !== -1 ? process.argv[outIdx + 1] : "full-scores.json";

const b = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"],
});
const p = await (await b.newContext()).newPage();
p.on("console", (m) => {
  const t = m.text();
  if (/backend|DONE|FAILED|calls|riddle \d|bonus \d|phase downloading (25|50|75|99)/.test(t)) console.log(`  ${t}`);
});
await p.goto("http://localhost:5173/scripts/riddle-bench/full-collect.html", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.__FULL_DONE__ === true, null, { timeout: 180 * 60 * 1000 });
const d = await p.evaluate(() => window.__FULL__);
await b.close();
if (d.error) {
  console.error(d.error);
  process.exit(1);
}
fs.writeFileSync(outFile, JSON.stringify(d, null, 2));
console.log(`\nsaved ${d.riddle.length} riddle + ${d.bonus.length} bonus rows from ${d.device}/${d.dtype} -> ${outFile}`);
