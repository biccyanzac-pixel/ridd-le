/**
 * Headless check of the server-judged (v6) play flow, with screenshots.
 *
 *   worker:  see worker/test/judge.e2e.mjs for the local worker command
 *            (add --var ALLOWED_ORIGIN:http://localhost:5173)
 *   site:    VITE_LEADERBOARD_URL=http://127.0.0.1:8789 VITE_SCORING_VERSION=6 npx vite --port 5173
 *   run:     node scripts/judge-ui-check.mjs [http://localhost:5173] [out-dir]
 *
 * Walks: name + a correct answer, a junk answer (refused, no attempt spent),
 * a close answer with its hint, a flag press, a paused ("flaky") answer, and
 * the finished state. Screenshots at 360 px and desktop, light and dark, and
 * one with reduced motion. Uses the system Chrome.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { FACETS, cluesFor, scoreFrom } from "../../shared/clues.js";
import { challengeForDay, todayKey } from "../../shared/challenges.js";

// The mock provider's numbers (worker/src/judge.js), run through scoreFrom.
const slug = challengeForDay(todayKey()).slug;
const facetsOf = (v) => Object.fromEntries(FACETS.map((f) => [f.id, v]));
function expectedScore(kind) {
  const clues = cluesFor(slug);
  const ratings = clues.map((c, i) => (kind === "good" ? 95 : kind === "near" ? (i === 0 ? 20 : 90) : c.id === "specific" ? 90 : 10));
  return scoreFrom(clues, ratings.map((score) => ({ score })), facetsOf(kind === "good" ? 95 : kind === "near" ? 60 : 20)).score;
}
const GOOD = expectedScore("good").toFixed(2);
const NEAR = expectedScore("near").toFixed(2);
const AVG2 = ((expectedScore("good") + expectedScore("near")) / 2).toFixed(1);

const BASE = process.argv[2] || "http://localhost:5173";
const OUT = process.argv[3] || path.join(process.cwd(), "judge-ui-shots");
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures += 1;
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function fresh({ width = 390, height = 844, colorScheme = "dark", reducedMotion = "no-preference" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("  page error:", e.message));
  await page.goto(BASE, { waitUntil: "networkidle" });
  return { context, page };
}

async function submitAnswer(page, text) {
  await page.fill("#answer", text);
  await page.click("#submit");
  await page.waitForFunction(() => !document.querySelector("#submit").disabled, null, { timeout: 30_000 });
}

// --- the main flow at phone width, dark ----------------------------------------
{
  const { context, page } = await fresh();
  check("no model download screen: the form is shown at once", await page.isHidden("#preparing") && await page.isVisible("#play"));
  const nameVisible = await page.isVisible("#name-field");
  if (nameVisible) await page.fill("#name", "Tester");
  await page.screenshot({ path: path.join(OUT, "01-form-360-dark.png"), fullPage: false });

  await submitAnswer(page, "a stack of far too many words here");
  check("junk is refused with a hint and no attempt spent", (await page.textContent("#error"))?.length > 10 && await page.isHidden("#attempts"), await page.textContent("#error"));
  await page.screenshot({ path: path.join(OUT, "02-junk-refused.png") });

  await submitAnswer(page, "good lantern");
  await page.waitForSelector("#attempt-list .attempt-row");
  const first = await page.textContent("#attempt-list .attempt-row:nth-child(1) .attempt-score");
  check("a strong answer shows its score", first?.trim() === GOOD, `${first} vs ${GOOD}`);
  // The score counts up from the previous average; wait for it to settle.
  await page.waitForFunction((g) => document.querySelector("#daily-score")?.textContent.includes(g), GOOD, { timeout: 5000 }).catch(() => {});
  check("the daily score shows the first attempt's score", (await page.textContent("#daily-score"))?.includes(GOOD), await page.textContent("#daily-score"));
  await page.screenshot({ path: path.join(OUT, "03-correct-360-dark.png") });

  await submitAnswer(page, "near lantern");
  const second = await page.textContent("#attempt-list .attempt-row:nth-child(2) .attempt-score");
  const hint = await page.textContent("#attempt-list .attempt-row:nth-child(2) .attempt-hint");
  check("a near-miss shows a middling score with a hint", second?.trim() === NEAR && hint?.startsWith("but"), `${second} / ${hint}`);
  const flag = page.locator("#attempt-list .attempt-row:nth-child(2) .attempt-flag");
  check("an 'Unfair score?' button is offered", (await flag.count()) === 1);
  await flag.click();
  await page.waitForTimeout(600);
  check("flagging thanks the player", (await flag.textContent())?.includes("Flagged"), await flag.textContent());
  await page.screenshot({ path: path.join(OUT, "04-close-hint-flag.png") });

  await submitAnswer(page, `flaky torch ${Date.now() % 10000}`);
  const third = await page.textContent("#attempt-list .attempt-row:nth-child(3) .attempt-score");
  check("a paused answer shows 'Judging paused', not an error", third?.trim() === "Judging paused" && await page.isHidden("#error"), third);
  check("the caption says one attempt is still to be scored", (await page.textContent("#daily-score-caption"))?.includes("paused"));
  await page.waitForFunction((a) => document.querySelector("#daily-score")?.textContent.includes(a), AVG2, { timeout: 5000 }).catch(() => {});
  check("a pending attempt is left out of the average", (await page.textContent("#daily-score"))?.includes(AVG2), `${await page.textContent("#daily-score")} vs ${AVG2}`);
  check("the game is finished: form gone, done note shown", await page.isHidden("#play") && await page.isVisible("#attempts-done"));
  check("the bonus round is offered once the riddle is done", await page.isVisible("#bonus"));
  await page.screenshot({ path: path.join(OUT, "05-paused-finished-360-dark.png"), fullPage: true });
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check("no horizontal scroll at 390 px", width <= 390, String(width));
  await context.close();
}

// --- light, desktop, reduced motion: same page, already played ----------------
{
  const { context, page } = await fresh({ width: 1280, height: 900, colorScheme: "light" });
  await page.screenshot({ path: path.join(OUT, "06-desktop-light.png"), fullPage: true });
  await context.close();
}
{
  const { context, page } = await fresh({ width: 360, height: 780, colorScheme: "light", reducedMotion: "reduce" });
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check("no horizontal scroll at 360 px", width <= 360, String(width));
  await page.screenshot({ path: path.join(OUT, "07-360-light-reduced-motion.png"), fullPage: true });
  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL JUDGE UI CHECKS PASSED");
console.log(`screenshots in ${OUT}`);
process.exit(failures ? 1 : 0);
