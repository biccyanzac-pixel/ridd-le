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
const full = { clues: [{ id: "breakable", score: 91, reason: "" }, { id: "no-touch", score: 84, reason: "" }, { id: "specific", score: 88, reason: "" }], overall: 79 };
const r = parseJudgeReply(slug, JSON.stringify(full));
check("a complete reply scores the weighted mean with the overall", Math.abs(r.score - 85.5) < 0.01 && r.overall === 79, String(r.score));
check("a fenced reply is accepted", Math.abs(parseJudgeReply(slug, "```json\n" + JSON.stringify(full) + "\n```").score - 85.5) < 0.01);
check("clue order does not matter", Math.abs(parseJudgeReply(slug, JSON.stringify({ ...full, clues: [...full.clues].reverse() })).score - 85.5) < 0.01);
const throws = (text) => { try { parseJudgeReply(slug, text); return false; } catch { return true; } };
check("a reply missing a clue is refused", throws(JSON.stringify({ clues: full.clues.slice(0, 1), overall: 79 })));
check("a reply missing the overall rating is refused", throws(JSON.stringify({ clues: full.clues })));
check("a reply with no JSON is refused", throws("I cannot judge this."));
check("a legacy yes/no reply is still accepted", parseJudgeReply(slug, JSON.stringify({ clues: full.clues.map((c) => ({ id: c.id, pass: true })), overall: 90 })).score === 97.5);
check("the prompt asks for the overall rating", userPrompt({ prompt: "x?", slug, example: "e", answer: "a" }).includes('"overall":0'));
check("the schema requires the overall rating", responseSchema(slug).required.includes("overall"));
console.log(failures ? `\n${failures} FAILED` : "\nALL JUDGE-PROMPT CHECKS PASSED");
process.exit(failures ? 1 : 0);
