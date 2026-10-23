/**
 * Generate shared/prewarm.json: for every riddle, the ~100 answers players
 * are most likely to give (good, near-miss and common wrong ones alike), so
 * the cron can judge them ahead of the day and launch day costs nothing.
 *
 *   node --env-file=.env.judge tools/judge-eval/gen-prewarm.mjs [--only slug] [--provider gemini|groq]
 *
 * Offline, once. Re-run for a riddle if its answers look thin. The output is
 * de-duplicated through the judge's own normalisation so no two entries
 * share a cache key.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHALLENGES } from "../../shared/challenges.js";
import { normalizeForJudge, junkReason } from "../../shared/judge-normalize.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "..", "..", "shared", "prewarm.json");
const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true] : [])).filter((x) => x.length),
);
const provider = args.provider || "gemini";

const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};

function prompt(c) {
  return [
    `A daily lateral-thinking riddle game asks: "${c.prompt}"`,
    `Players type a short answer (1 to 6 words). One good answer is "${c.example}", but any answer that`,
    `genuinely satisfies the riddle counts. List the 110 answers real players are MOST LIKELY to type,`,
    `in rough order of likelihood. Mix them: the obvious good answers, plausible alternatives, common`,
    `near-misses that only half fit, and the common wrong guesses people make. Lowercase, no numbering,`,
    `no explanations, each answer on its own line, nothing else.`,
  ].join(" ");
}

async function gemini(text) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text }] }], generationConfig: { temperature: 0.7 } }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

async function groq(text) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: "openai/gpt-oss-120b", temperature: 0.7, max_tokens: 1500, messages: [{ role: "user", content: text }] }),
  });
  if (!res.ok) throw new Error(`groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return json?.choices?.[0]?.message?.content ?? "";
}

const ask = provider === "groq" ? groq : gemini;

for (const c of CHALLENGES) {
  if (args.only && c.slug !== args.only) continue;
  if (existing[c.slug]?.length >= 80 && !args.only) continue;
  let text;
  try {
    text = await ask(prompt(c));
  } catch (err) {
    console.error(`${c.slug}: ${err.message}`);
    await new Promise((r) => setTimeout(r, 20_000));
    continue;
  }
  const seen = new Set();
  const answers = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/^[\s\-*\d.)]+/, "").replace(/["“”]/g, "").trim();
    if (!line || line.length > 60) continue;
    if (junkReason(line, c.prompt)) continue;
    const key = normalizeForJudge(line);
    if (seen.has(key)) continue;
    seen.add(key);
    answers.push(line);
    if (answers.length >= 100) break;
  }
  existing[c.slug] = answers;
  fs.writeFileSync(OUT, JSON.stringify(existing, null, 1) + "\n");
  console.log(`${c.slug}: ${answers.length}`);
  await new Promise((r) => setTimeout(r, 7_000));
}
console.log(`written ${path.relative(process.cwd(), OUT)}: ${Object.keys(existing).length} riddles`);
