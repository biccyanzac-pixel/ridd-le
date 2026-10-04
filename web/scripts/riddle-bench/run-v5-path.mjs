/**
 * Verifies the two-call scoring path actually works in a browser before it
 * goes live, on tomorrow's real riddle.
 *
 *   node scripts/riddle-bench/run-v5-path.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

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
  if (/backend|DONE|FAILED|call|->/.test(m.text())) console.log(`  ${m.text()}`);
});
await p.goto("http://localhost:5173/scripts/riddle-bench/v5-path.html", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.__V5_DONE__ === true, null, { timeout: 60 * 60 * 1000 });
const d = await p.evaluate(() => window.__V5__);
await b.close();

let fails = 0;
const check = (ok, msg) => {
  if (!ok) fails += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${msg}`);
};

console.log("");
if (d.error) {
  console.error(`the two-call path threw: ${d.error}`);
  process.exit(1);
}
check(d.v4.calls === 1, `today stays one call (${d.v4.id})`);
check(d.v5.calls === 2, `tomorrow uses two calls (${d.v5.id})`);
check(d.rows.length > 0, `scored ${d.rows.length} answers without error`);
check(
  d.rows.every((r) => r.twoCall >= 0 && r.twoCall <= 100),
  "every two-call score is within 0-100",
);
check(
  d.rows.every((r) => r.twoCall <= r.oneCall + 0.001),
  "the penalty never raises a score above the one-call value",
);

const avg = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length;
const gen = d.rows.filter((r) => r.kind === "genuine");
const rew = d.rows.filter((r) => r.kind === "REWORDED");
const non = d.rows.filter((r) => r.kind === "nonsense");
console.log(`\n  genuine   one-call ${avg(gen.map((r) => r.oneCall)).toFixed(1)}  ->  two-call ${avg(gen.map((r) => r.twoCall)).toFixed(1)}`);
console.log(`  REWORDED  one-call ${avg(rew.map((r) => r.oneCall)).toFixed(1)}  ->  two-call ${avg(rew.map((r) => r.twoCall)).toFixed(1)}`);
console.log(`  nonsense  one-call ${avg(non.map((r) => r.oneCall)).toFixed(1)}  ->  two-call ${avg(non.map((r) => r.twoCall)).toFixed(1)}`);
check(
  avg(gen.map((r) => r.twoCall)) > avg(rew.map((r) => r.twoCall)),
  "with two calls, genuine answers beat reworded ones on tomorrow's riddle",
);

console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
