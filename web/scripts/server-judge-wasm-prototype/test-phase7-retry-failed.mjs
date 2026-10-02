/**
 * Retries exactly the cases that got a 504 timeout in the first Phase 7
 * HTTP run (confirmed via direct retest: it was host-load-induced
 * timeouts, not a scoring bug - the same case succeeded with the correct
 * canonicalized score once retried in isolation). Surfaces real errors
 * this time instead of silently reading undefined.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_URL = "http://127.0.0.1:8788";

const all = JSON.parse(fs.readFileSync(path.join(here, "phase7_http_results.json"), "utf8"));
const failed = all.filter((r) => typeof r.server_score !== "number");
console.log(`retrying ${failed.length} previously-timed-out cases ...`);

const retried = [];
for (const c of failed) {
  const res = await fetch(`${SERVER_URL}/api/judge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: c.prompt, answer: c.answer }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.log(`  STILL FAILING: ${c.label ?? c.riddle} "${c.answer}" -> HTTP ${res.status} ${JSON.stringify(body)}`);
    retried.push({ ...c, server_score: undefined, error: body.error });
  } else {
    console.log(`  ok: ${c.label ?? c.riddle} "${c.answer}" -> score=${body.score}`);
    retried.push({ ...c, server_score: body.score, server_noul: body.noul });
  }
}

// Merge back into the full result set.
const merged = all.map((r) => {
  const updated = retried.find((x) => x.answer === r.answer && (x.label ?? x.riddle) === (r.label ?? r.riddle));
  return updated ?? r;
});
fs.writeFileSync(path.join(here, "phase7_http_results.json"), JSON.stringify(merged, null, 2));

const stillFailed = merged.filter((r) => typeof r.server_score !== "number");
console.log(`\nstill failed: ${stillFailed.length}`);
console.log(stillFailed.length === 0 ? "RESULT: ALL RESOLVED" : "RESULT: SOME STILL FAILING");
console.log("DONE");
