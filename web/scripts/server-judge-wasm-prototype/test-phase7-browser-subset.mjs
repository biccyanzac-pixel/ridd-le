/**
 * A resource-safe subset of Phase 7's browser-vs-server comparison: one
 * case per riddle (5), the worst-case, and the 4 semantic-distinction
 * pairs (8) = 14 cases through ONE real browser session (no-GPU forces
 * local WASM), compared against the already-completed full HTTP results.
 * The full 72-case run through a single browser tab hit Chromium
 * resource exhaustion in this environment (see report) - this subset
 * avoids that while still giving a real end-to-end browser confirmation
 * across every riddle and every semantic/cosmetic category, on top of
 * the already-bit-exact module-level 58-case parity and the Phase 8
 * single-case browser-to-HTTP-server proof.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const DEV_URL = "http://localhost:5173/";

const allHttp = JSON.parse(fs.readFileSync(path.join(here, "phase7_http_results.json"), "utf8"));

const picks = [
  allHttp.find((r) => r.riddle === "enter-without-going-in" && r.answer === "A competition"),
  allHttp.find((r) => r.riddle === "behind-before-passed" && r.answer === "Your reputation"),
  allHttp.find((r) => r.riddle === "more-true-when-stop-believing" && r.answer === "Your independence"),
  allHttp.find((r) => r.riddle === "leave-without-going-anywhere" && r.answer === "A note"),
  allHttp.find((r) => r.riddle === "found-only-after-lost" && r.answer === "Gratitude"),
  allHttp.find((r) => r.label === "worst-case from native-ORT investigation"),
  allHttp.find((r) => r.label === "semantic: a competition"),
  allHttp.find((r) => r.label === "semantic: competition"),
  allHttp.find((r) => r.label === "semantic: an exit"),
  allHttp.find((r) => r.label === "semantic: exit"),
  allHttp.find((r) => r.label === "semantic: dead-end"),
  allHttp.find((r) => r.label === "semantic: dead end"),
  allHttp.find((r) => r.label === "semantic: don't"),
  allHttp.find((r) => r.label === "semantic: dont"),
].filter(Boolean);

console.log(`running ${picks.length} cases through one real browser (local WASM) session ...`);
const browser = await chromium.launch({ executablePath: EDGE_PATHS.find((p) => fs.existsSync(p)), headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.addInitScript(() => {
  Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
});
await page.goto(DEV_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

const browserScores = await page.evaluate(async (cases) => {
  const { loadJudge, scoreAnswer } = await import("/src/judge.js");
  await loadJudge();
  const out = [];
  for (const c of cases) {
    const statement = `Is the answer a plausible interpretation of the riddle "${c.prompt}" that resolves its apparent contradiction?`;
    const verdict = await scoreAnswer({ answer: c.answer, statement, prompt: c.prompt });
    out.push(verdict.score);
  }
  return out;
}, picks.map((p) => ({ answer: p.answer, prompt: p.prompt })));

await browser.close();

console.log("\ncomparison (browser WASM vs already-recorded server HTTP result):");
let allMatch = true;
for (let i = 0; i < picks.length; i++) {
  const match = browserScores[i] === picks[i].server_score;
  allMatch &&= match;
  console.log(`  ${picks[i].label ?? picks[i].riddle} "${picks[i].answer}": browser=${browserScores[i]} server=${picks[i].server_score} MATCH=${match}`);
}
console.log(allMatch ? "\nRESULT: PASS - exact match on every case" : "\nRESULT: FAIL");
console.log("DONE");
