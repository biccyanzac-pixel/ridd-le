/**
 * End-to-end test of the judged play path (scoring v6) against a local
 * wrangler dev with the mock provider. Real HTTP, real D1 emulation.
 *
 *   cd worker
 *   npx wrangler d1 execute jacob-gg-leaderboard --local --file=schema.sql --persist-to .wrangler/judge-test
 *   npx wrangler d1 execute jacob-gg-leaderboard --local --file=migrations/0002_judge.sql --persist-to .wrangler/judge-test
 *   npx wrangler dev --local --port 8789 --persist-to .wrangler/judge-test \
 *     --var JUDGE_PRIMARY:mock --var JUDGE_PRIMARY_MODEL:m --var JUDGE_PRIMARY_DAILY:1000 \
 *     --var JUDGE_BACKUP:mock --var JUDGE_BACKUP_MODEL:m --var JUDGE_BACKUP_DAILY:1000 \
 *     --var JUDGE_ADMIN_TOKEN:test-admin --var SCORING_V6_FROM:2000-01-01 \
 *     --var PLAY_HOURLY_LIMIT:100000 --var JUDGE_IP_HOURLY:100000
 *   node test/judge.e2e.mjs http://127.0.0.1:8789
 *
 * Proves: 100 requests with 20 distinct answers reach the model at most 20
 * times; spellings of one answer share a verdict; junk costs no attempt;
 * verdicts score 100/50/0; a provider failure queues the attempt (never an
 * error) and the cron scores it; flags and overrides work.
 */
import assert from "node:assert/strict";
import { answerHash, normalizeAnswer } from "../../shared/normalize.js";
import { bonusChallengeForDay, challengeForDay, todayKey } from "../../shared/challenges.js";
import { judgeCacheKey } from "../../shared/judge-normalize.js";
import { FACETS, cluesFor, scoreFrom } from "../../shared/clues.js";

// What the mock provider's ratings come to (see the mock in src/judge.js).
const facetsOf = (v) => Object.fromEntries(FACETS.map((f) => [f.id, v]));
function expectedScore(slug, kind) {
  const clues = cluesFor(slug);
  const ratings = clues.map((c, i) =>
    kind === "good" ? 95 : kind === "near" ? (i === 0 ? 20 : 90) : c.id === "specific" ? 90 : 10,
  );
  return scoreFrom(clues, ratings.map((score) => ({ score })), facetsOf(kind === "good" ? 95 : kind === "near" ? 60 : 20)).score;
}
const near = (a, b) => Math.abs(a - b) < 0.011;

const BASE = process.argv[2] || "http://127.0.0.1:8789";
const ADMIN = { Authorization: "Bearer test-admin" };
let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures += 1;
}
async function call(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(options.headers ?? {}) } });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function session() {
  return (await call("/api/session", { method: "POST", body: "{}" })).body;
}

const day = todayKey();
const challenge = { ...challengeForDay(day), scoringVersion: 6 };
challenge.id = `${challenge.slug}@v6:${day}`;

async function play(player, answer) {
  const normalized = normalizeAnswer(answer);
  const hash = await answerHash({ challengeId: challenge.id, scoringVersion: 6, normalizedAnswer: normalized });
  return call("/api/play", {
    method: "POST",
    body: JSON.stringify({ ...player, challengeId: challenge.id, name: "T", answer, answerHash: hash }),
  });
}
async function quotaCalls() {
  const s = (await call(`/api/judge/summary?days=1`, { headers: ADMIN })).body;
  return (s.callsPerProvider ?? []).reduce((n, r) => n + r.calls, 0);
}

const before = await quotaCalls();

// === cache: 100 requests, 20 distinct answers, <= 20 model calls =============
{
  const words = "apple brick cloud daisy eagle fable grape harp igloo jewel kite lemon mango night olive pearl quilt river stone tulip".split(" ");
  const answers = words.map((w) => `good ${w}`);
  const results = [];
  let i = 0;
  while (results.length < 100) {
    const p = await session();
    for (let k = 0; k < 3 && results.length < 100; k += 1) {
      // Vary the spelling so the cache has to normalise, not just match.
      const a = answers[i % 20];
      const spelled = [a, a.toUpperCase(), `The ${a}.`, `${a}s`][i % 4];
      results.push((await play(p, spelled)).body);
      i += 1;
    }
  }
  const after = await quotaCalls();
  check("100 requests with 20 distinct answers reach the model at most 20 times", after - before <= 20, `model calls: ${after - before}`);
  const GOOD = expectedScore(challenge.slug, "good");
  check("every one of the 100 got a real score", results.every((r) => near(r?.result?.score ?? -1, GOOD)), results.filter((r) => !near(r?.result?.score ?? -1, GOOD)).length + " didn't");
  check("no answer scores 100", results.every((r) => r?.result?.score < 100) && GOOD < 100, String(GOOD));
  const cachedCount = results.filter((r) => r?.result?.cached).length;
  check("at least 80 of them were served from the cache", cachedCount >= 80, `cached: ${cachedCount}`);
}

// === verdicts, scores, hints =================================================
{
  const p = await session();
  const good = (await play(p, "good umbrella")).body;
  const nearR = (await play(p, "near umbrella")).body;
  const wrong = (await play(p, "bad umbrella")).body;
  const [G, N, B] = ["good", "near", "bad"].map((k) => expectedScore(challenge.slug, k));
  check("a strong answer scores high with no hint", near(good.result.score, G) && good.result.hint === null, `${good.result.score} vs ${G}`);
  check("a near-miss scores in the middle with the weakest clue's hint", near(nearR.result.score, N) && typeof nearR.result.hint === "string" && nearR.result.hint.length > 5, `${nearR.result.score} / ${nearR.result.hint}`);
  check("a poor answer scores low with a hint", near(wrong.result.score, B) && typeof wrong.result.hint === "string", `${wrong.result.score} vs ${B}`);
  const me = wrong.leaderboard.top.find((r) => r.you) ?? wrong.leaderboard.you;
  check("the daily score is the average of the three", Math.abs(me.score - (G + N + B) / 3) < 0.02, String(me?.score));
  check("attempts carry a numeric score", wrong.attempts.every((a) => Number.isFinite(a.score)));
}

// === junk never costs an attempt ============================================
{
  const p = await session();
  const empty = await play(p, "   ");
  const long = await play(p, "a thing that has far too many words in it");
  const parrot = await play(p, challenge.prompt.replace(/^what\s+/i, "").replace(/\?$/, "").split(" ").slice(0, 3).join(" "));
  check("empty is refused", empty.status === 400);
  check("over six words is refused as junk with a hint", long.status === 400 && long.body.error === "junk_answer" && typeof long.body.hint === "string");
  check("the riddle's own words are refused as junk", parrot.status === 400 && parrot.body.error === "junk_answer", JSON.stringify(parrot.body));
  const ok = (await play(p, "good kettle")).body;
  check("junk consumed no attempt", ok.result.attemptNumber === 1);
}

// === paused mode: a provider failure queues the attempt =====================
{
  const p = await session();
  // Unique per run so a rerun against the same local database still exercises the queue.
  const flakyAnswer = `flaky lantern ${Date.now() % 100000}`;
  const r = (await play(p, flakyAnswer)).body;
  check("a provider failure is not an error for the player", r?.result?.verdict === "pending" && r.result.pending === true, JSON.stringify(r).slice(0, 200));
  check("the pending attempt is recorded", r.attempts.length === 1 && r.attempts[0].pending === true);
  const mine = r.leaderboard.top.find((x) => x.you) ?? r.leaderboard.you;
  check("a pending attempt doesn't drag the average down", mine.score === 0 && r.attempts[0].score === 0);
  const run = (await call("/api/judge/run", { method: "POST", headers: ADMIN })).body;
  check("the cron drains the queue once the provider answers", run.drained >= 1, JSON.stringify(run));
  const after = (await call(`/api/attempts?challengeId=${encodeURIComponent(challenge.id)}&playerId=${p.playerId}`)).body;
  const B2 = expectedScore(challenge.slug, "bad");
  check("the player's result updates on their next visit", after.attempts[0].pending === false && near(after.attempts[0].score, B2), JSON.stringify(after.attempts[0]));
  const again = (await play(await session(), flakyAnswer.toUpperCase())).body;
  check("the queued score is cached for everyone afterwards", again.result.cached === true && near(again.result.score, B2));
}

// === flags and overrides ====================================================
{
  const p = await session();
  const r = (await play(p, "near candle")).body;
  const key = r.result.cacheKey;
  check("the cache key is the normalised one", key === judgeCacheKey(challenge.slug, "near candle"), key);
  const flag = (await call("/api/judge/flag", { method: "POST", body: JSON.stringify({ ...p, cacheKey: key }) })).body;
  check("a player can flag their own verdict", flag.flagged === true);
  const other = await call("/api/judge/flag", { method: "POST", body: JSON.stringify({ ...(await session()), cacheKey: key }) });
  check("a player can't flag someone else's answer", other.status === 403);
  const noAdmin = await call(`/api/judge/log?day=${day}`);
  check("the log needs the admin token", noAdmin.status === 403);
  const log = (await call(`/api/judge/log?day=${day}`, { headers: ADMIN })).body;
  check("the daily log lists the flagged verdict and no player ids", log.flagged.some((f) => f.cache_key === key) && !JSON.stringify(log).includes(p.playerId));
  const ov = (await call("/api/judge/override", { method: "POST", headers: ADMIN, body: JSON.stringify({ cacheKey: key, score: 88 }) })).body;
  check("the owner can override a score", ov.overridden === true);
  const mine = (await call(`/api/attempts?challengeId=${encodeURIComponent(challenge.id)}&playerId=${p.playerId}`)).body;
  check("the override rescored the existing attempt", mine.attempts[0].score === 88, JSON.stringify(mine.attempts[0]));
  const next = (await play(await session(), "NEAR candle")).body;
  check("the override is what everyone gets from now on", next.result.score === 88 && next.result.cached === true);
}

// === the bonus round, judged by the worker too ===============================
{
  const p = await session();
  const bonus = bonusChallengeForDay(day);
  async function bonusPlay(answer) {
    const normalized = normalizeAnswer(answer);
    const hash = await answerHash({ challengeId: bonus.id, scoringVersion: bonus.scoringVersion, normalizedAnswer: normalized });
    return call("/api/play", { method: "POST", body: JSON.stringify({ ...p, challengeId: bonus.id, name: "T", answer, answerHash: hash }) });
  }
  const locked = await bonusPlay("good warmth");
  check("the bonus round stays locked until the riddle is done", locked.status === 403 && locked.body?.error === "bonus_locked");
  for (const a of ["good one", "good two", "good three"]) await play(p, a);
  const r = await bonusPlay("good warmth");
  const expectedBonus = expectedScore(`bonus-opposite/${bonus.word.toLowerCase()}`, "good");
  check("a bonus guess is judged and scored", r.status === 200 && near(r.body?.result?.score ?? -1, expectedBonus), `${r.status} ${JSON.stringify(r.body?.result)}`);
  const parrot = await bonusPlay(bonus.word);
  check("the word itself is refused as junk", parrot.status === 400 && parrot.body?.error === "junk_answer", `${parrot.status} ${JSON.stringify(parrot.body)}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL JUDGE CHECKS PASSED");
process.exit(failures ? 1 : 0);
