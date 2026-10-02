/**
 * Phase 9 (scoped): verifies the 3-attempt scoring flow produces
 * IDENTICAL scores for the same 3 answers whether judged by local WASM
 * or (forced) the server fallback - using the real production
 * scoreAnswer() and averageScore() from shared/challenges.js, not
 * reimplementations.
 *
 * Deliberately does NOT exercise real leaderboard submission: web/src/
 * api.js fetches its base URL from the deployed production config
 * (confirmed - every test in this session shows CORS errors against the
 * real jacob-gg-leaderboard worker from localhost), so driving the full
 * submit()/leaderboard flow here would write test data into the real,
 * live leaderboard. That part is intentionally out of scope for a local
 * prototype test; it would need either a local worker/D1 instance or an
 * explicit decision to point at a disposable test environment, neither
 * of which exists yet and neither of which this phase was asked to set
 * up. Duplicate-answer rejection is pure client-side hashing logic
 * (shared/normalize.js) with no judge dependency at all, so it is
 * unaffected by which judge backend is used and isn't re-tested here.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const DEV_URL = "http://localhost:5173/";
const ANSWERS = ["a competition", "a stalling test answer", "purple elephant toaster"];

async function runThreeAttempts(forceServerFallback) {
  const browser = await chromium.launch({ executablePath: EDGE_PATHS.find((p) => fs.existsSync(p)), headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
  });
  if (forceServerFallback) {
    await page.route("**/cdn.jsdelivr.net/**", (route) => route.abort("failed"));
  }
  await page.goto(DEV_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  const result = await page.evaluate(async (answers) => {
    const { loadJudge, scoreAnswer, judgeRuntime } = await import("/src/judge.js");
    const { averageScore, challengeForDay } = await import(
      "/@fs/C:/Users/jacobp/Desktop/jacob.gg/shared/challenges.js"
    );
    await loadJudge();
    // Today's REAL challenge, via the same shared function the server
    // now uses to derive its own prompt - the server no longer accepts
    // a client-supplied prompt, so both sides must agree on "today"
    // independently rather than the test hardcoding one.
    const challenge = challengeForDay();
    const attempts = [];
    for (const answer of answers) {
      const verdict = await scoreAnswer({ answer, statement: challenge.noulStatement });
      attempts.push({ answer, score: verdict.score });
    }
    return { device: judgeRuntime()?.device, challengeId: challenge.id, attempts, average: averageScore(attempts) };
  }, ANSWERS);

  await browser.close();
  return result;
}

console.log("=== Run 1: local WASM (real, no-GPU forces it, nothing blocked) ===");
const localRun = await runThreeAttempts(false);
console.log(JSON.stringify(localRun, null, 2));

console.log("\n=== Run 2: forced server fallback (local WASM session-create blocked) ===");
const serverRun = await runThreeAttempts(true);
console.log(JSON.stringify(serverRun, null, 2));

console.log("\n=== COMPARISON ===");
let allMatch = true;
for (let i = 0; i < ANSWERS.length; i++) {
  const a = localRun.attempts[i].score;
  const b = serverRun.attempts[i].score;
  const match = a === b;
  allMatch &&= match;
  console.log(`  "${ANSWERS[i]}": local=${a} server=${b} MATCH=${match}`);
}
console.log(`  average: local=${localRun.average} server=${serverRun.average} MATCH=${localRun.average === serverRun.average}`);
allMatch &&= localRun.average === serverRun.average;

console.log(allMatch ? "\nRESULT: PASS - identical scores on both backends" : "\nRESULT: FAIL");
console.log("DONE");
