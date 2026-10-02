/**
 * Phase 7, full-coverage half: all 58 existing benchmark cases + the
 * worst-case + canonicalization/semantic cases, run directly against the
 * HTTP server (POST /api/judge). Fast and has no browser-memory risk.
 * This isolates whether the HTTP/queue/worker layer introduces ANY
 * discrepancy vs calling judgeAnswer() directly - the module-level
 * parity (server WASM vs browser WASM, bit-exact across 58 cases) was
 * already proven earlier in this session; what's new here is the
 * HTTP/queue/worker wrapper around it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHALLENGES } from "../../../shared/challenges.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_URL = "http://127.0.0.1:8788";

const benchPath = path.join(here, "..", "kev-wasm-export", "q4_webgpu_vs_wasm.json");
const bench = JSON.parse(fs.readFileSync(benchPath, "utf8"));
const promptByRiddle = new Map(CHALLENGES.map((c) => [c.slug, c.prompt]));
promptByRiddle.set("leave-without-going-anywhere", "What can you leave without going anywhere?");
promptByRiddle.set("found-only-after-lost", "What can be found only after it is lost?");

const fixedPrompt = "What can you enter without going in?";
const extraCases = [
  { label: "cosmetic: case", answer: "A KEYBOARD" },
  { label: "cosmetic: leading/trailing ws", answer: "  a keyboard  " },
  { label: "cosmetic: internal ws", answer: "a    keyboard" },
  { label: "cosmetic: wrapping quotes", answer: '"a keyboard"' },
  { label: "cosmetic: trailing period", answer: "a keyboard." },
  { label: "semantic: a competition", answer: "a competition" },
  { label: "semantic: competition", answer: "competition" },
  { label: "semantic: an exit", answer: "an exit" },
  { label: "semantic: exit", answer: "exit" },
  { label: "semantic: dead-end", answer: "dead-end" },
  { label: "semantic: dead end", answer: "dead end" },
  { label: "semantic: don't", answer: "don't" },
  { label: "semantic: dont", answer: "dont" },
].map((c) => ({ riddle: "enter-without-going-in", answer: c.answer, prompt: fixedPrompt, label: c.label }));

const allCases = [
  ...bench.map((c) => ({ riddle: c.riddle, answer: c.answer, prompt: promptByRiddle.get(c.riddle) })),
  { riddle: "enter-without-going-in", answer: "Purple elephant toaster", prompt: fixedPrompt, label: "worst-case from native-ORT investigation" },
  ...extraCases,
];

console.log(`running ${allCases.length} cases directly against the HTTP server ...`);
const results = [];
for (const c of allCases) {
  const res = await fetch(`${SERVER_URL}/api/judge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: c.prompt, answer: c.answer }),
  });
  const body = await res.json();
  results.push({ ...c, server_score: body.score, server_noul: body.noul });
}

fs.writeFileSync(path.join(here, "phase7_http_results.json"), JSON.stringify(results, null, 2));

console.log("\nsample of results:");
for (const r of results.slice(0, 5)) console.log(`  ${r.riddle} "${r.answer}": score=${r.server_score}`);
for (const r of results.filter((r) => r.label)) console.log(`  [${r.label}] "${r.answer}": score=${r.server_score}`);

const semanticPairs = [
  ["a competition", "competition"],
  ["an exit", "exit"],
  ["dead-end", "dead end"],
  ["don't", "dont"],
];
console.log("\nsemantic-distinction check (must be DIFFERENT scores):");
let semanticOk = true;
for (const [a, b] of semanticPairs) {
  const ra = results.find((r) => r.answer === a)?.server_score;
  const rb = results.find((r) => r.answer === b)?.server_score;
  const distinct = ra !== rb;
  semanticOk &&= distinct;
  console.log(`  "${a}"(${ra}) vs "${b}"(${rb}): DISTINCT=${distinct}`);
}

const cosmeticGroup = ["a keyboard", "A KEYBOARD", "  a keyboard  ", "a    keyboard", '"a keyboard"', "a keyboard."];
console.log("\ncosmetic-collapse check (must be IDENTICAL scores) - scoring fresh since 'a keyboard' baseline wasn't in the main list:");
const cosmeticScores = [];
for (const answer of cosmeticGroup) {
  const res = await fetch(`${SERVER_URL}/api/judge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: fixedPrompt, answer }),
  });
  const body = await res.json();
  cosmeticScores.push(body.score);
  console.log(`  "${answer}" -> ${body.score}`);
}
const cosmeticOk = cosmeticScores.every((s) => s === cosmeticScores[0]);
console.log(`ALL IDENTICAL: ${cosmeticOk}`);

console.log(`\nn = ${results.length}`);
console.log(semanticOk && cosmeticOk ? "RESULT: PASS" : "RESULT: FAIL");
console.log("DONE");
