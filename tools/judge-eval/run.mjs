/**
 * Judge evaluation: run one candidate model over the labelled test set and
 * report accuracy by category, false-correct rate, false-wrong rate on valid
 * answers, consistency, latency and tokens per call.
 *
 *   node --env-file=.env.judge tools/judge-eval/run.mjs --provider groq-gpt-oss-20b [--limit 40] [--rpm 25]
 *   node --env-file=.env.judge tools/judge-eval/run.mjs --provider groq-gpt-oss-20b --repeat 5 --sample 60
 *   node tools/judge-eval/run.mjs --report            # docs/judge-eval.md from all summaries
 *   node tools/judge-eval/run.mjs --check             # validate the test set only
 *
 * Every raw reply is cached under tools/judge-eval/results/raw/<provider>/,
 * so a rerun costs nothing and a quota-interrupted run resumes where it
 * stopped. Summaries go to tools/judge-eval/results/<provider>.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { CHALLENGES } from "../../shared/challenges.js";
import { cluesFor } from "../../shared/clues.js";
import { junkReason } from "../../shared/judge-normalize.js";
import { parseJudgeReply, responseSchema, systemPrompt, userPrompt, JUDGE_PROMPT_VERSION } from "../../shared/judge-prompt.js";
import { CANDIDATES } from "./providers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(here, "results");
const RAW = path.join(RESULTS, "raw");
const args = parseArgs(process.argv.slice(2));

const testset = JSON.parse(fs.readFileSync(path.join(here, "testset.json"), "utf8"));
const bySlug = new Map(CHALLENGES.map((c) => [c.slug, c]));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    out[k] = v;
  }
  return out;
}

// --- the test set, flattened and validated -----------------------------------
function cases() {
  const list = [];
  const problems = [];
  for (const r of testset.riddles) {
    const c = bySlug.get(r.slug);
    if (!c) problems.push(`unknown slug ${r.slug}`);
    if (r.answers.length !== 20) problems.push(`${r.slug}: ${r.answers.length} answers, want 20`);
    const seen = new Set();
    for (const a of r.answers) {
      if (!["correct", "close", "wrong"].includes(a.label)) problems.push(`${r.slug}: bad label ${a.label}`);
      if (seen.has(a.a.toLowerCase())) problems.push(`${r.slug}: duplicate answer ${a.a}`);
      seen.add(a.a.toLowerCase());
      list.push({ slug: r.slug, prompt: c?.prompt, example: c?.example, answer: a.a, label: a.label, cat: a.cat });
    }
  }
  if (testset.riddles.length !== 30) problems.push(`${testset.riddles.length} riddles, want 30`);
  if (problems.length) {
    console.error("TEST SET PROBLEMS:\n  " + problems.join("\n  "));
    process.exit(1);
  }
  return list;
}

// --- running one candidate ---------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rawPath(provider, key) {
  const h = crypto.createHash("sha1").update(key).digest("hex").slice(0, 20);
  return path.join(RAW, provider.replace(/[^\w.-]/g, "_"), `${h}.json`);
}

async function judgeOnce(model, providerKey, c, rep) {
  // The junk filter runs first, exactly as it will in production; its cases
  // never reach the model and are counted as "wrong" with hint.
  const junk = junkReason(c.answer, c.prompt);
  if (junk) return { verdict: "wrong", hint: junk.hint, junk: junk.reason, latencyMs: 0, usage: { input: 0, output: 0 }, cached: true };

  const key = JSON.stringify([JUDGE_PROMPT_VERSION, c.slug, c.answer, rep]);
  const file = rawPath(providerKey, key);
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    return { ...interpret(c.slug, saved.text), latencyMs: saved.latencyMs, usage: saved.usage, cached: true };
  }
  const req = { system: systemPrompt(), user: userPrompt(c), schema: responseSchema(c.slug), slug: c.slug };
  let attempt = 0;
  for (;;) {
    try {
      const res = await model.complete(req);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ text: res.text, usage: res.usage, latencyMs: res.latencyMs, at: new Date().toISOString() }));
      return { ...interpret(c.slug, res.text), latencyMs: res.latencyMs, usage: res.usage, cached: false };
    } catch (err) {
      attempt += 1;
      const status = err.status ?? 0;
      if (status === 429 || status >= 500) {
        if (attempt > 6) throw err;
        const wait = err.retryAfter ? err.retryAfter * 1000 : Math.min(60_000, 2000 * 2 ** attempt);
        process.stderr.write(`\n  ${status} from ${model.name}, waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
}

function interpret(slug, text) {
  try {
    return parseJudgeReply(slug, text);
  } catch (err) {
    return { verdict: "unparseable", hint: null, perClue: null, parseError: err.message };
  }
}

async function runCandidate(providerKey) {
  const make = CANDIDATES[providerKey];
  if (!make) {
    console.error(`unknown provider ${providerKey}; one of: ${Object.keys(CANDIDATES).join(", ")}`);
    process.exit(1);
  }
  const model = make();
  let list = cases();
  const repeat = Number(args.repeat ?? 1);
  if (args.sample) list = sampleCases(list, Number(args.sample));
  if (args.limit) list = list.slice(0, Number(args.limit));
  const rpm = Number(args.rpm ?? 20);
  const gap = 60_000 / rpm;

  const rows = [];
  let lastCall = 0;
  let n = 0;
  for (const c of list) {
    const reps = [];
    for (let rep = 0; rep < repeat; rep += 1) {
      const wait = lastCall + gap - Date.now();
      let r;
      try {
        r = await judgeOnce(model, providerKey, c, rep);
      } catch (err) {
        r = { verdict: "error", hint: null, error: String(err.message).slice(0, 200), latencyMs: 0, usage: { input: 0, output: 0 } };
      }
      if (!r.cached) lastCall = Date.now();
      if (!r.cached && wait > 0) await sleep(wait);
      reps.push(r);
      n += 1;
      process.stderr.write(`\r${model.name}: ${n}/${list.length * repeat}  ${c.slug} / "${c.answer}" -> ${r.verdict}${r.cached ? " (cached)" : ""}      `);
    }
    rows.push({ ...c, reps });
  }
  process.stderr.write("\n");
  const summary = summarise(providerKey, model.name, rows, repeat);
  fs.mkdirSync(RESULTS, { recursive: true });
  const outFile = path.join(RESULTS, `${providerKey}${repeat > 1 ? ".consistency" : ""}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ summary, rows }, null, 1));
  printSummary(summary);
  console.log(`\nwritten ${path.relative(process.cwd(), outFile)}`);
}

/** A fixed, category-balanced sample: the same cases for every provider. */
function sampleCases(list, n) {
  const perCat = {};
  for (const c of list) (perCat[c.cat] ??= []).push(c);
  const cats = Object.keys(perCat);
  const out = [];
  let i = 0;
  while (out.length < n && out.length < list.length) {
    const cat = cats[i % cats.length];
    const bucket = perCat[cat];
    const pick = bucket[Math.floor(i / cats.length) % bucket.length];
    if (pick && !out.includes(pick)) out.push(pick);
    i += 1;
    if (i > list.length * 2) break;
  }
  return out;
}

// --- metrics -----------------------------------------------------------------
function summarise(providerKey, modelName, rows, repeat) {
  const cats = {};
  let total = 0;
  let right = 0;
  let falseCorrect = 0;
  let notCorrectTotal = 0;
  let falseWrong = 0;
  let validTotal = 0;
  let errors = 0;
  let unparseable = 0;
  let latencies = [];
  let tokIn = 0;
  let tokOut = 0;
  let modelCalls = 0;
  let inconsistent = 0;
  let consistencyCases = 0;

  for (const row of rows) {
    const first = row.reps[0];
    const v = first.verdict;
    total += 1;
    const cat = (cats[row.cat] ??= { n: 0, right: 0, verdicts: { correct: 0, close: 0, wrong: 0, other: 0 } });
    cat.n += 1;
    cat.verdicts[["correct", "close", "wrong"].includes(v) ? v : "other"] += 1;
    if (v === row.label) {
      right += 1;
      cat.right += 1;
    }
    if (v === "error") errors += 1;
    if (v === "unparseable") unparseable += 1;
    if (row.label !== "correct") {
      notCorrectTotal += 1;
      if (v === "correct") falseCorrect += 1;
    }
    if (row.label === "correct") {
      validTotal += 1;
      if (v === "wrong") falseWrong += 1;
    }
    for (const r of row.reps) {
      if (r.junk) continue;
      modelCalls += 1;
      if (r.latencyMs) latencies.push(r.latencyMs);
      tokIn += r.usage?.input ?? 0;
      tokOut += r.usage?.output ?? 0;
    }
    if (repeat > 1 && !first.junk) {
      consistencyCases += 1;
      const set = new Set(row.reps.map((r) => r.verdict));
      if (set.size > 1) inconsistent += 1;
    }
  }
  latencies.sort((a, b) => a - b);
  const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
  return {
    provider: providerKey,
    model: modelName,
    promptVersion: JUDGE_PROMPT_VERSION,
    at: new Date().toISOString(),
    cases: total,
    repeat,
    accuracy: pct(right, total),
    byCategory: Object.fromEntries(
      Object.entries(cats).map(([k, c]) => [k, { n: c.n, accuracy: pct(c.right, c.n), verdicts: c.verdicts }]),
    ),
    falseCorrectRate: pct(falseCorrect, notCorrectTotal),
    falseCorrect,
    falseWrongRate: pct(falseWrong, validTotal),
    falseWrong,
    errors,
    unparseable,
    consistency: repeat > 1 ? { cases: consistencyCases, disagreeing: inconsistent, rate: pct(consistencyCases - inconsistent, consistencyCases) } : null,
    latencyMs: latencies.length
      ? { median: latencies[Math.floor(latencies.length / 2)], p90: latencies[Math.floor(latencies.length * 0.9)] }
      : null,
    tokensPerCall: modelCalls ? { input: Math.round(tokIn / modelCalls), output: Math.round(tokOut / modelCalls) } : null,
    modelCalls,
  };
}

function printSummary(s) {
  console.log(`\n== ${s.model}  (${s.cases} cases, prompt v${s.promptVersion})`);
  console.log(`accuracy ${s.accuracy}%   false-correct ${s.falseCorrectRate}% (${s.falseCorrect})   false-wrong on valid ${s.falseWrongRate}% (${s.falseWrong})   errors ${s.errors}  unparseable ${s.unparseable}`);
  for (const [cat, c] of Object.entries(s.byCategory)) {
    console.log(`  ${cat.padEnd(12)} n=${String(c.n).padStart(3)}  acc ${String(c.accuracy).padStart(5)}%   correct/close/wrong/other = ${c.verdicts.correct}/${c.verdicts.close}/${c.verdicts.wrong}/${c.verdicts.other}`);
  }
  if (s.consistency) console.log(`consistency: ${s.consistency.rate}% of ${s.consistency.cases} cases agreed across ${s.repeat} runs (${s.consistency.disagreeing} disagreed)`);
  if (s.latencyMs) console.log(`latency median ${s.latencyMs.median} ms, p90 ${s.latencyMs.p90} ms;  tokens/call in ${s.tokensPerCall.input} out ${s.tokensPerCall.output}`);
}

// --- report ------------------------------------------------------------------
function report() {
  const files = fs.existsSync(RESULTS) ? fs.readdirSync(RESULTS).filter((f) => f.endsWith(".json")) : [];
  const runs = files.map((f) => JSON.parse(fs.readFileSync(path.join(RESULTS, f), "utf8")).summary);
  const full = runs.filter((r) => r.repeat === 1).sort((a, b) => a.falseCorrectRate - b.falseCorrectRate || b.accuracy - a.accuracy);
  const cons = new Map(runs.filter((r) => r.repeat > 1).map((r) => [r.provider, r]));
  const lines = [];
  lines.push("| Model | Cases | Accuracy | False-correct | False-wrong on valid | Consistency (5 runs) | Median latency | Tokens in/out | Errors |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of full) {
    const c = cons.get(r.provider);
    lines.push(
      `| ${r.model} | ${r.cases} | ${r.accuracy}% | ${r.falseCorrectRate}% (${r.falseCorrect}) | ${r.falseWrongRate}% (${r.falseWrong}) | ${c ? `${c.consistency.rate}% of ${c.consistency.cases}` : "not run"} | ${r.latencyMs?.median ?? "-"} ms | ${r.tokensPerCall?.input ?? "-"}/${r.tokensPerCall?.output ?? "-"} | ${r.errors + r.unparseable} |`,
    );
  }
  lines.push("");
  lines.push("Per category (accuracy, and how verdicts fell as correct/close/wrong/other):");
  lines.push("");
  const catNames = ["intended", "alt", "near", "vague", "wrong", "nonsense", "adversarial"];
  lines.push(`| Model | ${catNames.join(" | ")} |`);
  lines.push(`| --- | ${catNames.map(() => "---").join(" | ")} |`);
  for (const r of full) {
    lines.push(
      `| ${r.model} | ${catNames
        .map((k) => {
          const c = r.byCategory[k];
          return c ? `${c.accuracy}% (${c.verdicts.correct}/${c.verdicts.close}/${c.verdicts.wrong}/${c.verdicts.other})` : "-";
        })
        .join(" | ")} |`,
    );
  }
  const out = lines.join("\n");
  console.log(out);
  const target = path.join(here, "results", "tables.md");
  fs.writeFileSync(target, out + "\n");
  console.log(`\nwritten ${path.relative(process.cwd(), target)} (paste into docs/judge-eval.md)`);
}

if (args.check) {
  const list = cases();
  const counts = {};
  for (const c of list) counts[c.cat] = (counts[c.cat] ?? 0) + 1;
  const junk = list.filter((c) => junkReason(c.answer, c.prompt));
  console.log(`${list.length} cases over ${testset.riddles.length} riddles`, counts);
  console.log(`${junk.length} cases are caught by the junk filter before the model:`);
  for (const c of junk) console.log(`  [${c.cat}] ${c.slug}: "${c.answer}" -> ${junkReason(c.answer, c.prompt).reason} (label ${c.label})`);
  const clueCount = testset.riddles.reduce((s, r) => s + cluesFor(r.slug).length, 0);
  console.log(`${clueCount} clue questions across the 30 riddles`);
} else if (args.report) {
  report();
} else if (args.provider) {
  await runCandidate(args.provider);
} else {
  console.log("usage: run.mjs --provider <name> [--limit N] [--sample N] [--repeat K] [--rpm N] | --check | --report");
  console.log("providers: " + Object.keys(CANDIDATES).join(", "));
}
