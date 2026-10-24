/**
 * The judge reply parser: complete replies become scores, incomplete ones
 * are refused (never silently scored as zeros). Pure, no model.
 *
 *   node shared/test/judge-prompt.test.mjs
 */
import { parseJudgeReply, userPrompt, responseSchema } from "../judge-prompt.js";

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures += 1;
}
const slug = "break-without-touching";
const facets = { overall: 79, precision: 81, wit: 64, natural: 90 };
const full = { clues: [{ id: "breakable", score: 91, reason: "" }, { id: "no-touch", score: 84, reason: "" }, { id: "specific", score: 88, reason: "" }], ...facets };
// (91 + 84 + 88 + 79 + 0.5*81 + 0.5*64 + 0.25*90 + 0.4*50) / (3 + 1 + 0.5 + 0.5 + 0.25 + 0.4)
const expected = Math.round(((91 + 84 + 88 + 79 + 40.5 + 32 + 22.5 + 20) / 5.65) * 100) / 100;
const r = parseJudgeReply(slug, JSON.stringify(full));
check("a complete reply scores the shrunk weighted mean", Math.abs(r.score - expected) < 0.01 && r.facets.wit === 64, `${r.score} vs ${expected}`);
check("a fenced reply is accepted", Math.abs(parseJudgeReply(slug, "```json\n" + JSON.stringify(full) + "\n```").score - expected) < 0.01);
check("clue order does not matter", Math.abs(parseJudgeReply(slug, JSON.stringify({ ...full, clues: [...full.clues].reverse() })).score - expected) < 0.01);
const throws = (text) => { try { parseJudgeReply(slug, text); return false; } catch { return true; } };
check("a reply missing a clue is refused", throws(JSON.stringify({ ...full, clues: full.clues.slice(0, 1) })));
check("a reply missing a facet is refused", throws(JSON.stringify({ clues: full.clues, overall: 79, precision: 81, wit: 64 })));
check("a reply with no JSON is refused", throws("I cannot judge this."));
const perfect = parseJudgeReply(slug, JSON.stringify({ clues: full.clues.map((c) => ({ id: c.id, score: 100 })), overall: 100, precision: 100, wit: 100, natural: 100 }));
check("even a perfect reply stays under 100", perfect.score < 100 && perfect.score > 96, String(perfect.score));
check("the prompt asks for the four facets", ["overall", "precision", "wit", "natural"].every((f) => userPrompt({ prompt: "x?", slug, example: "e", answer: "a" }).includes(`"${f}":0`)));
check("a bonus slug gets the opposite clues and no example line", userPrompt({ prompt: "What's the opposite of \"warm\"?", slug: "bonus-opposite/warm", example: null, answer: "cold" }).includes("[opposite]") && !userPrompt({ prompt: "x", slug: "bonus-opposite/warm", example: null, answer: "cold" }).includes("example"));
check("the schema requires the facets", responseSchema(slug).required.includes("natural"));
console.log(failures ? `\n${failures} FAILED` : "\nALL JUDGE-PROMPT CHECKS PASSED");
process.exit(failures ? 1 : 0);
