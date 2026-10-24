/**
 * The clue checklists line up with the riddle list, and verdicts derive
 * from per-clue results the way the rules say. No model, no network.
 *
 *   node shared/test/clues.test.mjs
 */
import assert from "node:assert/strict";
import { CHALLENGES } from "../challenges.js";
import { CLUES, SPECIFICITY_CLUE, cluesFor, verdictFrom } from "../clues.js";

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures += 1;
}

// --- every riddle has a checklist, and nothing else does ---------------------
const slugs = CHALLENGES.map((c) => c.slug);
const missing = slugs.filter((s) => !CLUES[s]);
check("every riddle has a clue checklist", missing.length === 0, missing.join(", "));
const extra = Object.keys(CLUES).filter((s) => !slugs.includes(s));
check("no checklist for a riddle that doesn't exist", extra.length === 0, extra.join(", "));

// --- each checklist is well formed ------------------------------------------
let shapeOk = true;
const problems = [];
for (const c of CHALLENGES) {
  const list = CLUES[c.slug]?.clues ?? [];
  const ids = new Set(list.map((x) => x.id));
  if (list.length < 2) problems.push(`${c.slug}: fewer than 2 clues`);
  if (ids.size !== list.length) problems.push(`${c.slug}: duplicate clue ids`);
  if (ids.has(SPECIFICITY_CLUE.id)) problems.push(`${c.slug}: reuses the specificity clue id`);
  if (!list.some((x) => x.required)) problems.push(`${c.slug}: no required clue`);
  if (list.filter((x) => !x.required).length > 1) problems.push(`${c.slug}: more than one soft clue`);
  for (const x of list) {
    if (typeof x.q !== "string" || !x.q.includes("X") || !x.q.trim().endsWith("?")) {
      problems.push(`${c.slug}/${x.id}: question must mention X and end with ?`);
    }
    if (typeof x.hint !== "string" || x.hint.length < 8) problems.push(`${c.slug}/${x.id}: missing hint`);
    if (typeof x.required !== "boolean") problems.push(`${c.slug}/${x.id}: required must be boolean`);
    // The checklist judges the answer; it must never contain one.
    const ex = String(c.example).toLowerCase().replace(/^(a|an|the)\s+/, "");
    if (ex.length > 3 && (x.q.toLowerCase().includes(ex) || x.hint.toLowerCase().includes(ex))) {
      problems.push(`${c.slug}/${x.id}: mentions the example answer`);
    }
  }
}
if (problems.length) shapeOk = false;
check("every checklist is well formed and names no answer", shapeOk, problems.join("; "));

// --- cluesFor appends the specificity clue last -----------------------------
const first = cluesFor(slugs[0]);
check("cluesFor ends with the specificity clue", first[first.length - 1] === SPECIFICITY_CLUE);
check("cluesFor throws for an unknown slug", (() => { try { cluesFor("nope"); return false; } catch { return true; } })());

// --- verdict derivation -----------------------------------------------------
const clues = [
  { id: "a", required: true, hint: "hint a" },
  { id: "b", required: true, hint: "hint b" },
  { id: "s", required: false, hint: "hint s" },
  SPECIFICITY_CLUE,
];
const r = (...passes) => passes.map((pass) => ({ pass }));
assert.deepEqual(verdictFrom(clues, r(true, true, true, true)).verdict, "correct");
check("all pass is correct", true);
check("one soft fail is still correct", verdictFrom(clues, r(true, true, false, true)).verdict === "correct");
const oneReq = verdictFrom(clues, r(true, false, true, true));
check("one required fail is close, with that clue's hint", oneReq.verdict === "close" && oneReq.hint === "hint b");
check("one required plus the soft fail is close", verdictFrom(clues, r(true, false, false, true)).verdict === "close");
check("two required fails is wrong", verdictFrom(clues, r(false, false, true, true)).verdict === "wrong");
const vague = verdictFrom(clues, r(true, true, true, false));
check("failing only specificity is close with the specificity hint", vague.verdict === "close" && vague.hint === SPECIFICITY_CLUE.hint);
check("the hint names the first failed required clue", verdictFrom(clues, r(false, false, true, true)).hint === "hint a");
check("a soft-only fail still carries a hint", verdictFrom(clues, r(true, true, false, true)).hint === "hint s");
check("result count must match clue count", (() => { try { verdictFrom(clues, r(true)); return false; } catch { return true; } })());

console.log(failures ? `\n${failures} FAILED` : "\nALL CLUE CHECKS PASSED");
process.exit(failures ? 1 : 0);
