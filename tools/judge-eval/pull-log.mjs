/**
 * The owner's daily file and weekly summary, pulled from the live worker.
 *
 *   node --env-file=.env.judge tools/judge-eval/pull-log.mjs              # today
 *   node --env-file=.env.judge tools/judge-eval/pull-log.mjs 2026-10-25   # one day
 *   node --env-file=.env.judge tools/judge-eval/pull-log.mjs --week       # last 7 days
 *
 * Needs JUDGE_ADMIN_TOKEN in .env.judge (the same value as the worker
 * secret) and, optionally, JUDGE_WORKER_URL. Writes logs/judge-<day>.json
 * plus a readable logs/judge-<day>.md (or judge-week-<to>.md), gitignored.
 */
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.JUDGE_WORKER_URL || "https://jacob-gg-leaderboard.jacob-gg-leaderboard-worker.workers.dev";
const TOKEN = process.env.JUDGE_ADMIN_TOKEN;
if (!TOKEN) {
  console.error("JUDGE_ADMIN_TOKEN is not set (put it in .env.judge)");
  process.exit(1);
}
const OUT = path.join(process.cwd(), "logs");
fs.mkdirSync(OUT, { recursive: true });

async function get(p) {
  const res = await fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

const arg = process.argv[2];
if (arg === "--week") {
  const s = await get(`/api/judge/summary?days=7`);
  const lines = [
    `# Judge, ${s.from} to ${s.to}`,
    "",
    `Model calls: ${s.callsPerProvider.map((r) => `${r.provider} ${r.calls}`).join(", ") || "none"}`,
    `Verdicts by source: ${Object.entries(s.verdictsBySource).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`,
    `Cache hit rate: ${s.cacheHitRate ?? "n/a"}%`,
    `Paused: ${s.pausedByDay.map((d) => `${d.day} ${d.n} answers (${d.first.slice(11, 16)} to ${d.last.slice(11, 16)} UTC)`).join("; ") || "never"}`,
    `Still queued: ${s.stillQueued}`,
    `Flagged verdicts: ${s.flaggedAnswers} (${s.flagPresses} presses)`,
    "",
    "## Most common 'close' answers (clue lists to look at)",
    "",
    "| Riddle | Answer | Times | Hint shown |",
    "| --- | --- | --- | --- |",
    ...s.commonCloseAnswers.map((r) => `| ${r.slug} | ${r.normalized_answer} | ${r.n} | ${r.hint ?? ""} |`),
    "",
  ];
  const file = path.join(OUT, `judge-week-${s.to}.md`);
  fs.writeFileSync(file, lines.join("\n"));
  fs.writeFileSync(path.join(OUT, `judge-week-${s.to}.json`), JSON.stringify(s, null, 1));
  console.log(lines.join("\n"));
  console.log(`\nwritten ${path.relative(process.cwd(), file)}`);
} else {
  const day = arg || new Date().toISOString().slice(0, 10);
  const log = await get(`/api/judge/log?day=${day}`);
  const lines = [
    `# Judge log, ${day}`,
    "",
    `Model calls: ${log.quota.map((r) => `${r.provider} ${r.calls}`).join(", ") || "none"}`,
    `Verdicts served: ${log.entries.length}`,
    "",
    "## Every verdict",
    "",
    "| Time | Riddle | Answer | Verdict | Source | Hint |",
    "| --- | --- | --- | --- | --- | --- |",
    ...log.entries.map((e) => `| ${e.created_at.slice(11, 19)} | ${e.slug} | ${e.answer.replace(/\|/g, "/")} | ${e.verdict} | ${e.source} | ${e.hint ?? ""} |`),
    "",
    "## Flagged verdicts (all time, most flagged first)",
    "",
    "| Flags | Riddle | Answer | Verdict | Override | Cache key |",
    "| --- | --- | --- | --- | --- | --- |",
    ...log.flagged.map((f) => `| ${f.flagged} | ${f.slug} | ${f.normalized_answer} | ${f.verdict} | ${f.override_verdict ?? ""} | ${f.cache_key} |`),
    "",
    "To overrule one:",
    "```",
    `curl -X POST ${BASE}/api/judge/override -H "Authorization: Bearer $JUDGE_ADMIN_TOKEN" -H "Content-Type: application/json" \\`,
    `  -d '{"cacheKey":"<cache key>","verdict":"correct|close|wrong","hint":"optional hint for close/wrong"}'`,
    "```",
    "",
  ];
  const file = path.join(OUT, `judge-${day}.md`);
  fs.writeFileSync(file, lines.join("\n"));
  fs.writeFileSync(path.join(OUT, `judge-${day}.json`), JSON.stringify(log, null, 1));
  console.log(`${log.entries.length} verdicts, ${log.flagged.length} flagged answers`);
  console.log(`written ${path.relative(process.cwd(), file)}`);
}
