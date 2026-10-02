/**
 * Phase 8: verifies the browser only calls the server judge in exactly
 * the one case it should - local WASM failing after WebGPU is already
 * unusable - and never merely because WebGPU is unavailable (local WASM
 * working is enough) or because WebGPU works. Does not fake a successful
 * WASM inference; the failure case blocks the real ORT runtime binary's
 * CDN request, the same mechanism web/scripts/test-wasm-debug-mode.mjs
 * uses, so this is a genuine session-create failure, not a stub.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const DEV_URL = "http://localhost:5173/";
const JUDGE_SERVER_HOST = "127.0.0.1:8788";

async function runCase(mode) {
  const browser = await chromium.launch({ executablePath: EDGE_PATHS.find((p) => fs.existsSync(p)), headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  if (mode === "webgpu-working") {
    // Real WebGPU on this dev machine (Edge headless does expose a usable
    // adapter) - no init script needed, this is the normal path.
  } else if (mode === "no-gpu-wasm-works") {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
    });
  } else if (mode === "no-gpu-wasm-fails") {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
    });
    // Blocks the real ORT WASM runtime binary's CDN fetch - judge-wasm.js's
    // session-create genuinely fails (real failure, not a stub), the same
    // mechanism test-wasm-debug-mode.mjs uses.
    await page.route("**/cdn.jsdelivr.net/**", (route) => route.abort("failed"));
  }

  let judgeServerRequests = 0;
  await page.route(`**${JUDGE_SERVER_HOST}/api/judge`, async (route) => {
    judgeServerRequests++;
    await route.continue();
  });

  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [console error] ${m.text().slice(0, 200)}`);
  });

  await page.goto(DEV_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  const result = await page.evaluate(async () => {
    const { loadJudge, scoreAnswer, UnsupportedDeviceError, judgeRuntime } = await import("/src/judge.js");
    const out = {};
    try {
      await loadJudge();
      out.runtime = judgeRuntime();
      const prompt = "What can you enter without going in?";
      const statement = `Is the answer a plausible interpretation of the riddle "${prompt}" that resolves its apparent contradiction?`;
      const verdict = await scoreAnswer({ answer: "a keyboard", statement, prompt });
      out.verdict = verdict;
    } catch (err) {
      out.error = { name: err?.name, message: err?.message, isUnsupported: err instanceof UnsupportedDeviceError };
    }
    return out;
  });

  await browser.close();
  return { mode, judgeServerRequests, result };
}

const modes = ["webgpu-working", "no-gpu-wasm-works", "no-gpu-wasm-fails"];
for (const mode of modes) {
  console.log(`\n=== ${mode} ===`);
  const r = await runCase(mode);
  console.log(`  judge server /api/judge request count: ${r.judgeServerRequests}`);
  console.log(`  runtime: ${JSON.stringify(r.result.runtime)}`);
  if (r.result.verdict) console.log(`  verdict: score=${r.result.verdict.score} device=${r.result.verdict.device}`);
  if (r.result.error) console.log(`  error: ${JSON.stringify(r.result.error)}`);
}
console.log("\nDONE");
