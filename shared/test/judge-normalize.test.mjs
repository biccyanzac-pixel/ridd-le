/**
 * Normalisation, cache keys and the junk filter. Pure, no model.
 *
 *   node shared/test/judge-normalize.test.mjs
 */
import { CHALLENGES } from "../challenges.js";
import { judgeCacheKey, junkReason, normalizeForJudge, singularize } from "../judge-normalize.js";

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures += 1;
}
function eq(label, got, want) {
  check(label, got === want, got === want ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// --- normalisation ------------------------------------------------------------
eq("lowercase + trim", normalizeForJudge("  A Hedge  "), "hedge");
eq("leading article dropped", normalizeForJudge("the horizon"), "horizon");
eq("'an' dropped", normalizeForJudge("An Egg"), "egg");
eq("article alone is kept (not emptied)", normalizeForJudge("a"), "a");
eq("article mid-phrase kept", normalizeForJudge("fear of the dark"), "fear of dark".replace("of dark", "of the dark"));
eq("punctuation stripped", normalizeForJudge("a promise!!"), "promise");
eq("wrapping quotes stripped", normalizeForJudge("\"a secret.\""), "secret");
eq("curly apostrophe dropped inside a word", normalizeForJudge("one’s name"), "one name");
eq("hyphen becomes a space", normalizeForJudge("dead-end"), "dead end");
eq("whitespace collapsed", normalizeForJudge("bad \n  news"), "bad news");
eq("plural -s", normalizeForJudge("hedges"), "hedge");
eq("plural -ies", normalizeForJudge("memories"), "memory");
eq("plural -ches", normalizeForJudge("matches"), "match");
eq("plural -oes", normalizeForJudge("echoes"), "echo");
eq("'glass' untouched", normalizeForJudge("glass"), "glass");
eq("'bus' untouched", normalizeForJudge("bus"), "bus");
eq("'yes' untouched", normalizeForJudge("yes"), "yes");
eq("'crisis' untouched", normalizeForJudge("a crisis"), "crisis");
eq("every word singularised", normalizeForJudge("the keys to the doors"), "key to the door");
eq("NFKC applied", normalizeForJudge("ﬁre"), "fire");
eq("singularize('gas')", singularize("gas"), "gas");

// Spellings a player would call the same answer collapse to one key.
const same = ["The Hedge", "hedge", "hedges", "a hedge.", "\"A hedge\"", "  HEDGE  "];
const keys = new Set(same.map((s) => judgeCacheKey("grows-by-being-cut", s)));
check("six spellings of one answer share a cache key", keys.size === 1, [...keys].join(" | "));
eq("cache key shape", judgeCacheKey("grows-by-being-cut", "The hedges"), "grows-by-being-cut:hedge");

// --- junk filter --------------------------------------------------------------
const keysPrompt = "What has keys but can't open locks?";
eq("empty is junk", junkReason("", keysPrompt)?.reason, "empty");
eq("whitespace is junk", junkReason("   ", keysPrompt)?.reason, "empty");
eq("over 6 words is junk", junkReason("a thing that has keys but cannot open any locks", keysPrompt)?.reason, "too_long");
check("exactly 6 words is allowed", junkReason("a piano in a quiet room", keysPrompt) === null);
eq("digits only is junk", junkReason("12345", keysPrompt)?.reason, "no_words");
eq("riddle word alone is junk (parrot)", junkReason("keys", keysPrompt)?.reason, "parrot");
eq("riddle words with inflection are still parrot", junkReason("the locks", keysPrompt)?.reason, "parrot");
eq("only stopwords is junk", junkReason("the one", keysPrompt)?.reason, "no_content");
check("riddle word plus something of its own is judged", junkReason("a piano's keys", keysPrompt) === null);
check("a real answer is judged", junkReason("a piano", keysPrompt) === null);
check("a wrong but genuine answer is judged", junkReason("a banana", keysPrompt) === null);

// Against the actual riddles: each example answer must pass the filter, and
// the riddle's own wording must not.
let examplesOk = true;
let parrotOk = true;
const bad = [];
for (const c of CHALLENGES) {
  if (junkReason(c.example, c.prompt) !== null) {
    examplesOk = false;
    bad.push(`${c.slug}: example "${c.example}" -> ${junkReason(c.example, c.prompt).reason}`);
  }
  const restated = c.prompt.replace(/^what\s+/i, "").replace(/\?$/, "").split(" ").slice(0, 6).join(" ");
  const r = junkReason(restated, c.prompt);
  if (!r || !["parrot", "no_content"].includes(r.reason)) {
    parrotOk = false;
    bad.push(`${c.slug}: restatement "${restated}" -> ${r?.reason ?? "judged"}`);
  }
}
check("every riddle's example passes the junk filter", examplesOk, bad.join("; "));
check("every riddle's own wording is refused as a parrot", parrotOk, bad.join("; "));

console.log(failures ? `\n${failures} FAILED` : "\nALL JUDGE-NORMALISE CHECKS PASSED");
process.exit(failures ? 1 : 0);
