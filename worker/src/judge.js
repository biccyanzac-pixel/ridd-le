/**
 * The judge, server side (scoring v6).
 *
 * Path for one answer:  junk filter -> cache -> per-IP limit -> provider pick
 * (quota) -> model -> write cache -> respond. The cache is written BEFORE the
 * caller gets the verdict, so a repeat of the same (riddle, normalised
 * answer) never reaches a model again - test/judge.e2e.mjs proves it.
 *
 * When no provider has quota, or a provider errors, the answer is not an
 * error for the player: it is accepted as "pending", queued, and judged by
 * the cron when quota returns. No second model ever judges live.
 *
 * Only the riddle, its clues, the example and the answer go to a model. The
 * log stores inputs and verdicts, never who sent them.
 */
import { challengeForDay } from "../../shared/challenges.js";
import { CLUES_REVISION } from "../../shared/clues.js";
import { judgeCacheKey, junkReason, normalizeForJudge } from "../../shared/judge-normalize.js";
import { JUDGE_PROMPT_VERSION, parseJudgeReply, responseSchema, systemPrompt, userPrompt } from "../../shared/judge-prompt.js";
import PREWARM from "../../shared/prewarm.json";

export const VERDICT_SCORE = { correct: 100, close: 50, wrong: 0 };
export const PENDING = "pending";

// Uncached model calls one address may trigger per hour. Cache hits and
// junk cost nothing and are not counted.
const IP_HOURLY_LIMIT = 20;
const MODEL_TIMEOUT_MS = 25_000;
const PREWARM_BUDGET_PER_RUN = 25;
const QUEUE_BUDGET_PER_RUN = 40;

// --- providers -----------------------------------------------------------------

// Test double, selected with `--var JUDGE_PRIMARY:mock` under wrangler dev.
// Verdict follows the candidate's first word: "good ..." passes every clue,
// "near ..." fails the first clue only, anything else fails them all. An
// answer containing "flaky" fails on its first call and succeeds afterwards,
// to exercise the paused/queued path. Never configured in production.
const flakySeen = new Set();
const mock = {
  async call(env, model, req) {
    if (env.JUDGE_MOCK_FAIL === "1") throw new Error("mock provider down");
    const answer = req.user.match(/Candidate answer X: "([^"]*)"/)?.[1] ?? "";
    if (/flaky/i.test(answer) && !flakySeen.has(answer)) {
      flakySeen.add(answer);
      throw new Error("mock flaky failure");
    }
    const ids = [...req.user.matchAll(/^\d+\. \[([^\]]+)\]/gm)].map((m) => m[1]);
    const first = answer
      .trim()
      .toLowerCase()
      .replace(/^(a|an|the)\s+/, "")
      .split(/\s+/)[0];
    const clues = ids.map((id, i) => ({
      id,
      pass: first === "good" ? true : first === "near" ? i !== 0 : id === "specific",
      reason: "mock",
    }));
    return JSON.stringify({ clues });
  },
};

const PROVIDERS = {
  mock,
  cloudflare: {
    async call(env, model, req) {
      const body = {
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        temperature: 0,
        max_tokens: 1500,
      };
      let result;
      try {
        result = await withTimeout(env.AI.run(model, { ...body, response_format: { type: "json_object" } }));
      } catch (err) {
        if (!/5025|JSON/i.test(String(err?.message))) throw err;
        result = await withTimeout(env.AI.run(model, body));
      }
      if (Array.isArray(result?.choices)) return result.choices[0]?.message?.content ?? "";
      if (typeof result?.response === "string") return result.response;
      return JSON.stringify(result?.response ?? result);
    },
  },
  groq: {
    async call(env, model, req) {
      return openaiChat("https://api.groq.com/openai/v1/chat/completions", env.GROQ_API_KEY, model, req, {
        reasoning_effort: "low",
      });
    },
  },
  gemini: {
    async call(env, model, req) {
      const res = await withTimeout(
        fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: [{ role: "user", parts: [{ text: req.user }] }],
            generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: req.schema },
          }),
        }),
      );
      if (!res.ok) throw httpError(res, await res.text());
      const json = await res.json();
      return json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    },
  },
};

async function openaiChat(url, key, model, req, extra) {
  if (!key) throw new Error("provider key missing");
  const res = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 400,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        response_format: { type: "json_object" },
        ...extra,
      }),
    }),
  );
  if (!res.ok) throw httpError(res, await res.text());
  const json = await res.json();
  return json?.choices?.[0]?.message?.content ?? "";
}

function httpError(res, text) {
  const err = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  err.status = res.status;
  return err;
}

function withTimeout(promise, ms = MODEL_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("model timed out")), ms)),
  ]);
}

/** Provider slots from config: primary and backup, each {name, model, dailyLimit}. */
export function providerSlots(env) {
  const slots = [];
  for (const which of ["PRIMARY", "BACKUP"]) {
    const name = env[`JUDGE_${which}`];
    if (!name || !PROVIDERS[name]) continue;
    slots.push({
      which: which.toLowerCase(),
      name,
      model: env[`JUDGE_${which}_MODEL`],
      dailyLimit: Number(env[`JUDGE_${which}_DAILY`]) || 0,
    });
  }
  return slots;
}

// --- quota ---------------------------------------------------------------------

export function dayKeyNow(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

async function usage(env, provider, day) {
  const row = await env.DB.prepare(`SELECT calls FROM judge_quota WHERE provider = ? AND day = ?`)
    .bind(provider, day)
    .first();
  return row?.calls ?? 0;
}

async function countCall(env, provider, day) {
  await env.DB.prepare(
    `INSERT INTO judge_quota (provider, day, calls) VALUES (?, ?, 1)
     ON CONFLICT (provider, day) DO UPDATE SET calls = calls + 1`,
  )
    .bind(provider, day)
    .run();
}

/**
 * Which provider judges the next uncached answer, or null for paused:
 * primary below 80% of its day; else backup while it has any; else what is
 * left of primary; else nothing.
 */
export async function pickProvider(env, day = dayKeyNow()) {
  const slots = providerSlots(env);
  if (slots.length === 0) return null;
  const [primary, backup] = slots;
  const used = await Promise.all(slots.map((s) => usage(env, s.name, day)));
  if (used[0] < primary.dailyLimit * 0.8) return primary;
  if (backup && used[1] < backup.dailyLimit) return backup;
  if (used[0] < primary.dailyLimit) return primary;
  return null;
}

// --- per-IP limit ----------------------------------------------------------------

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function ipAllowed(env, ip) {
  if (!ip) return true;
  const hour = new Date().toISOString().slice(0, 13);
  // Salted with the hour so the stored hash cannot be joined across hours.
  const ipHash = (await sha256(`${hour}|${ip}`)).slice(0, 32);
  const row = await env.DB.prepare(
    `INSERT INTO judge_rate (ip_hash, hour, calls) VALUES (?, ?, 1)
     ON CONFLICT (ip_hash, hour) DO UPDATE SET calls = calls + 1
     RETURNING calls`,
  )
    .bind(ipHash, hour)
    .first();
  return (row?.calls ?? 1) <= (Number(env.JUDGE_IP_HOURLY) || IP_HOURLY_LIMIT);
}

// --- cache -----------------------------------------------------------------------

function served(row) {
  if (!row) return null;
  const verdict = row.override_verdict || row.verdict;
  const hint = row.override_verdict ? row.override_hint : row.hint;
  return {
    verdict,
    hint: verdict === "correct" ? null : hint,
    perClue: safeJson(row.per_clue),
    model: row.model,
    cacheKey: row.cache_key,
    overridden: Boolean(row.override_verdict),
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function cachedVerdict(env, cacheKey) {
  const row = await env.DB.prepare(`SELECT * FROM judge_verdicts WHERE cache_key = ?`).bind(cacheKey).first();
  return served(row);
}

async function writeVerdict(env, { cacheKey, slug, normalized, result, model }) {
  // INSERT OR IGNORE then re-read: if two requests for a brand-new answer
  // race, the first verdict written is the one everybody gets.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO judge_verdicts
       (cache_key, slug, normalized_answer, verdict, hint, per_clue, model, prompt_version, clues_revision, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      cacheKey,
      slug,
      normalized,
      result.verdict,
      result.hint,
      JSON.stringify(result.perClue ?? []),
      model,
      JUDGE_PROMPT_VERSION,
      CLUES_REVISION,
      new Date().toISOString(),
    )
    .run();
  return cachedVerdict(env, cacheKey);
}

// --- log -------------------------------------------------------------------------

async function log(env, { day, slug, answer, normalized, verdict, hint, source, model, latencyMs }) {
  await env.DB.prepare(
    `INSERT INTO judge_log (id, day, slug, answer, normalized_answer, verdict, hint, source, model, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      day,
      slug,
      answer,
      normalized,
      verdict,
      hint ?? null,
      source,
      model ?? null,
      latencyMs ?? null,
      new Date().toISOString(),
    )
    .run();
}

// --- the judge -------------------------------------------------------------------

/** One model call for one answer, counted against quota. Throws on failure. */
async function askModel(env, slot, challenge, answer, day) {
  const req = {
    system: systemPrompt(),
    user: userPrompt({ prompt: challenge.prompt, slug: challenge.slug, example: challenge.example, answer }),
    schema: responseSchema(challenge.slug),
  };
  await countCall(env, slot.name, day);
  const t0 = Date.now();
  const text = await PROVIDERS[slot.name].call(env, slot.model, req);
  const parsed = parseJudgeReply(challenge.slug, text); // throws if unparseable
  return { ...parsed, latencyMs: Date.now() - t0, model: `${slot.name}/${slot.model}` };
}

/**
 * Judge an answer to a riddle. Never throws for a player-facing reason.
 *
 * Returns { verdict, hint, source, cacheKey, model? } where verdict is
 * correct | close | wrong | pending. `source` is junk | cache | judge | paused.
 * `ip` is used only for the hourly limit and never stored.
 */
export async function judgeAnswer(env, { challenge, answer, ip, day = dayKeyNow(), source = "play" }) {
  const slug = challenge.slug;
  const junk = junkReason(answer, challenge.prompt);
  const normalized = normalizeForJudge(answer);
  const cacheKey = judgeCacheKey(slug, answer);
  const base = { day, slug, answer, normalized };

  if (junk) {
    await log(env, { ...base, verdict: "wrong", hint: junk.hint, source: "junk" });
    return { verdict: "wrong", hint: junk.hint, source: "junk", cacheKey, junk: junk.reason };
  }

  const hit = await cachedVerdict(env, cacheKey);
  if (hit) {
    await log(env, { ...base, verdict: hit.verdict, hint: hit.hint, source: hit.overridden ? "override" : "cache", model: hit.model });
    return { ...hit, source: "cache" };
  }

  if (!(await ipAllowed(env, ip))) {
    await log(env, { ...base, verdict: PENDING, source: "paused", hint: "rate" });
    return { verdict: PENDING, hint: null, source: "paused", cacheKey, reason: "rate_limited" };
  }

  const slot = await pickProvider(env, day);
  if (!slot) {
    await log(env, { ...base, verdict: PENDING, source: "paused", hint: "quota" });
    return { verdict: PENDING, hint: null, source: "paused", cacheKey, reason: "quota" };
  }

  let result;
  try {
    result = await askModel(env, slot, challenge, answer, day);
  } catch (err) {
    console.error("judge failed", slot.name, String(err?.message ?? err));
    await log(env, { ...base, verdict: PENDING, source: "paused", hint: "error", model: `${slot.name}/${slot.model}` });
    return { verdict: PENDING, hint: null, source: "paused", cacheKey, reason: "provider_error" };
  }

  // Write first, respond second. If someone else wrote this key in the
  // meantime, theirs is what we return: one verdict per answer, forever.
  const stored = await writeVerdict(env, { cacheKey, slug, normalized, result, model: result.model });
  await log(env, { ...base, verdict: stored.verdict, hint: stored.hint, source, model: result.model, latencyMs: result.latencyMs });
  return { ...stored, source: "judge" };
}

// --- queue (paused mode) -----------------------------------------------------------

export async function enqueue(env, { cacheKey, slug, answer, submissionId }) {
  await env.DB.prepare(
    `INSERT INTO judge_queue (id, cache_key, slug, answer, submission_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), cacheKey, slug, answer, submissionId ?? null, new Date().toISOString())
    .run();
}

async function applyToSubmission(env, submissionId, verdict) {
  if (!submissionId) return;
  const score = VERDICT_SCORE[verdict.verdict];
  await env.DB.prepare(
    `UPDATE submissions SET score = ?, noul = ?, verdict = ?, hint = ?, judged = 1 WHERE id = ? AND judged = 0`,
  )
    .bind(score, score / 100, verdict.verdict, verdict.hint, submissionId)
    .run();
}

/** Judge queued answers while quota lasts. Returns how many were resolved. */
export async function drainQueue(env, budget = QUEUE_BUDGET_PER_RUN) {
  const { results } = await env.DB.prepare(`SELECT * FROM judge_queue ORDER BY created_at ASC LIMIT ?`)
    .bind(budget)
    .all();
  let done = 0;
  for (const item of results ?? []) {
    const challenge = challengeBySlug(item.slug);
    if (!challenge) {
      await env.DB.prepare(`DELETE FROM judge_queue WHERE id = ?`).bind(item.id).run();
      continue;
    }
    const verdict = await judgeAnswer(env, { challenge, answer: item.answer, ip: null, source: "queue" });
    if (verdict.verdict === PENDING) break; // still no quota; try next cron
    await applyToSubmission(env, item.submission_id, verdict);
    await env.DB.prepare(`DELETE FROM judge_queue WHERE id = ?`).bind(item.id).run();
    done += 1;
  }
  return done;
}

// --- pre-warming -------------------------------------------------------------------

function challengeBySlug(slug) {
  // challengeForDay resolves prompt/example by day; for a slug we need the
  // definition itself. CHALLENGES is exported from shared/challenges.js.
  return CHALLENGE_INDEX.get(slug) ?? null;
}

import { CHALLENGES } from "../../shared/challenges.js";
const CHALLENGE_INDEX = new Map(CHALLENGES.map((c) => [c.slug, c]));

/**
 * Judge the likely answers for a day's riddle ahead of time, within a
 * budget, only while the primary provider has most of its day left. Returns
 * how many new verdicts were cached.
 */
export async function prewarm(env, dayKey, budget = PREWARM_BUDGET_PER_RUN) {
  const challenge = challengeForDay(dayKey);
  const answers = PREWARM[challenge.slug] ?? [];
  const slots = providerSlots(env);
  if (!slots.length) return 0;
  const today = dayKeyNow();
  const used = await usage(env, slots[0].name, today);
  if (used > slots[0].dailyLimit * 0.5) return 0;

  let warmed = 0;
  for (const answer of answers) {
    if (warmed >= budget) break;
    const key = judgeCacheKey(challenge.slug, answer);
    if (await cachedVerdict(env, key)) continue;
    const v = await judgeAnswer(env, { challenge, answer, ip: null, day: today, source: "prewarm" });
    if (v.verdict === PENDING) break;
    if (v.source === "judge") warmed += 1;
  }
  return warmed;
}

// --- flags, overrides, reporting ---------------------------------------------------

export async function flagVerdict(env, cacheKey) {
  const r = await env.DB.prepare(`UPDATE judge_verdicts SET flagged = flagged + 1 WHERE cache_key = ?`)
    .bind(cacheKey)
    .run();
  return (r?.meta?.changes ?? 0) > 0;
}

export async function overrideVerdict(env, { cacheKey, verdict, hint }) {
  if (!VERDICT_SCORE.hasOwnProperty(verdict)) throw new Error("bad verdict");
  const r = await env.DB.prepare(
    `UPDATE judge_verdicts SET override_verdict = ?, override_hint = ?, override_at = ? WHERE cache_key = ?`,
  )
    .bind(verdict, hint ?? null, new Date().toISOString(), cacheKey)
    .run();
  if (!(r?.meta?.changes > 0)) return false;
  // Everyone who gave this answer gets the corrected score, past and future.
  const score = VERDICT_SCORE[verdict];
  await env.DB.prepare(`UPDATE submissions SET score = ?, noul = ?, verdict = ?, hint = ? WHERE cache_key = ?`)
    .bind(score, score / 100, verdict, verdict === "correct" ? null : hint ?? null, cacheKey)
    .run();
  const row = await env.DB.prepare(`SELECT slug, normalized_answer FROM judge_verdicts WHERE cache_key = ?`)
    .bind(cacheKey)
    .first();
  await log(env, {
    day: dayKeyNow(),
    slug: row?.slug ?? "",
    answer: row?.normalized_answer ?? "",
    normalized: row?.normalized_answer ?? "",
    verdict,
    hint,
    source: "override",
  });
  return true;
}

/** Everything judged on a day, plus that day's flags: the owner's daily file. */
export async function dailyLog(env, day) {
  const [entries, flagged, quota] = await Promise.all([
    env.DB.prepare(`SELECT slug, answer, normalized_answer, verdict, hint, source, model, latency_ms, created_at FROM judge_log WHERE day = ? ORDER BY created_at`)
      .bind(day)
      .all(),
    env.DB.prepare(`SELECT cache_key, slug, normalized_answer, verdict, hint, flagged, override_verdict, model FROM judge_verdicts WHERE flagged > 0 ORDER BY flagged DESC`).all(),
    env.DB.prepare(`SELECT provider, calls FROM judge_quota WHERE day = ?`).bind(day).all(),
  ]);
  return { day, quota: quota.results ?? [], entries: entries.results ?? [], flagged: flagged.results ?? [] };
}

/** The weekly summary: calls, hit rate, flags, paused count, common "close" answers. */
export async function weeklySummary(env, endDay = dayKeyNow(), days = 7) {
  const start = new Date(Date.parse(`${endDay}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const [quota, sources, paused, flags, close, queued] = await Promise.all([
    env.DB.prepare(`SELECT provider, SUM(calls) AS calls FROM judge_quota WHERE day BETWEEN ? AND ? GROUP BY provider`).bind(start, endDay).all(),
    env.DB.prepare(`SELECT source, COUNT(*) AS n FROM judge_log WHERE day BETWEEN ? AND ? GROUP BY source`).bind(start, endDay).all(),
    env.DB.prepare(`SELECT day, COUNT(*) AS n, MIN(created_at) AS first, MAX(created_at) AS last FROM judge_log WHERE source = 'paused' AND day BETWEEN ? AND ? GROUP BY day`).bind(start, endDay).all(),
    env.DB.prepare(`SELECT COUNT(*) AS n, SUM(flagged) AS presses FROM judge_verdicts WHERE flagged > 0`).first(),
    env.DB.prepare(
      `SELECT slug, normalized_answer, hint, COUNT(*) AS n FROM judge_log
        WHERE verdict = 'close' AND source IN ('judge', 'cache') AND day BETWEEN ? AND ?
        GROUP BY slug, normalized_answer ORDER BY n DESC LIMIT 50`,
    ).bind(start, endDay).all(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM judge_queue`).first(),
  ]);
  const bySource = Object.fromEntries((sources.results ?? []).map((r) => [r.source, r.n]));
  const served = (bySource.cache ?? 0) + (bySource.judge ?? 0) + (bySource.override ?? 0);
  return {
    from: start,
    to: endDay,
    callsPerProvider: quota.results ?? [],
    verdictsBySource: bySource,
    cacheHitRate: served ? Math.round((1000 * ((bySource.cache ?? 0) + (bySource.override ?? 0))) / served) / 10 : null,
    pausedByDay: paused.results ?? [],
    stillQueued: queued?.n ?? 0,
    flaggedAnswers: flags?.n ?? 0,
    flagPresses: flags?.presses ?? 0,
    commonCloseAnswers: close.results ?? [],
  };
}
