/**
 * Drives collect.html and saves every component score per case, so the
 * analysis can be redone for free without re-running the model.
 *
 *   # dev server must be running in web/
 *   node scripts/riddle-bench/run-collect.mjs [--no-gpu] [--out file.json]
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const URL = "http://localhost:5173/scripts/riddle-bench/collect.html";
const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const outIdx = process.argv.indexOf("--out");
const outFile = outIdx !== -1 ? process.argv[outIdx + 1] : "collected.json";

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"],
});
const page = await (await browser.newContext()).newPage();
if (process.argv.includes("--no-gpu")) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
  });
}
page.on("console", (m) => {
  const t = m.text();
  if (/backend|done|DONE|FAILED|calls to make/.test(t)) console.log(`  ${t}`);
});

console.log(`opening ${URL}`);
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__COLLECT_DONE__ === true, null, { timeout: 90 * 60 * 1000 });
const data = await page.evaluate(() => window.__COLLECT__);
await browser.close();

if (data.error) {
  console.error(`collection failed in the browser: ${data.error}`);
  process.exit(1);
}
fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
console.log(
  `\nsaved ${data.riddle.length} riddle rows + ${data.bonus.length} bonus rows from ${data.device}/${data.dtype} to ${outFile}`,
);
