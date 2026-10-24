/**
 * The judge prompt and its result parser, shared by the evaluation harness
 * and the worker so the model is asked the same thing in both places.
 *
 * The model sees only: the riddle, its clue checklist, one example of a
 * correct answer (labelled as such, never as "the" answer) and the candidate
 * answer. No player identifiers, ever.
 *
 * It must reply with strict JSON: one 0 to 100 rating per clue with a short
 * reason. The answer's score is NOT asked of the model; it is derived from
 * the per-clue ratings by shared/clues.js's scoreFrom (a weighted mean), so
 * the rule is deterministic and testable, and the model's only job is to
 * rate small, specific questions.
 */
import { FACETS, cluesFor, scoreFrom } from "./clues.js";

export const JUDGE_PROMPT_VERSION = 4;

export function systemPrompt() {
  return [
    "You judge answers to lateral-thinking riddles. A riddle has no single right answer:",
    "any answer that genuinely satisfies the riddle's clues deserves a high rating, however",
    "unexpected. Judge the candidate answer on its own merits, charitably but honestly, the way",
    "a thoughtful quizmaster would. Rate each clue from 0 (not at all) to 100 (perfectly) for how",
    "well the candidate satisfies it, then rate four facets of the answer as a whole: overall,",
    "precision, wit, naturalness. Use precise integers (73, 88, 41), never round multiples of 5",
    "or 10, and spread them: a clean but ordinary fit is around 75 to 88, only a perfect and",
    "surprising fit reaches 95 or more, a stretch sits in the 40s to 60s. Two different answers",
    "should almost never get identical ratings. Rate low an",
    "answer that merely restates the riddle, names a vague category, or talks to you instead",
    "of answering. Never penalise an answer for differing from the example. Give a reason of",
    "at most 15 words per clue. Reply with JSON only, no prose, no markdown fences.",
  ].join(" ");
}

export function userPrompt({ prompt, slug, example, answer }) {
  const clues = cluesFor(slug);
  const lines = clues.map((c, i) => `${i + 1}. [${c.id}] ${c.q}`);
  return [
    `Riddle: "${prompt}"`,
    ...(example ? [`One example of a strong answer (not the only one): "${example}"`] : []),
    `Candidate answer X: "${answer}"`,
    "",
    "Clues. For each, how well does X satisfy it, 0 to 100?",
    ...lines,
    "",
    "Then the answer as a whole, 0 to 100 each:",
    ...FACETS.map((f) => `- ${f.id}: ${f.q}`),
    "",
    "Reply with exactly this JSON shape:",
    `{"clues":[${clues.map((c) => `{"id":"${c.id}","score":0,"reason":"..."}`).join(",")}],${FACETS.map((f) => `"${f.id}":0`).join(",")}}`,
  ].join("\n");
}

/** JSON schema for providers that support structured output. */
export function responseSchema(slug) {
  const ids = cluesFor(slug).map((c) => c.id);
  return {
    type: "object",
    properties: {
      clues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", enum: ids },
            score: { type: "integer" },
            reason: { type: "string" },
          },
          required: ["id", "score", "reason"],
        },
      },
      ...Object.fromEntries(FACETS.map((f) => [f.id, { type: "integer" }])),
    },
    required: ["clues", ...FACETS.map((f) => f.id)],
  };
}

/**
 * Parse the model's text into a score. Tolerates a markdown fence or leading
 * prose, matches clues by id (order-independent), treats a missing clue as
 * 0, and accepts a legacy yes/no "pass" as 100/0. Throws if nothing
 * parseable comes back, so the caller can treat it as a provider error.
 */
export function parseJudgeReply(slug, text) {
  const clues = cluesFor(slug);
  const raw = String(text ?? "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("judge reply had no JSON object");
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    throw new Error(`judge reply was not valid JSON: ${err.message}`);
  }
  const list = Array.isArray(parsed?.clues) ? parsed.clues : null;
  if (!list) throw new Error("judge reply had no clues array");
  const byId = new Map();
  for (const item of list) {
    if (item && typeof item.id === "string") byId.set(item.id, item);
  }
  // A reply cut short by a token limit can still be valid JSON (Groq's JSON
  // mode closes it), with clues missing. That is not a score, it is a
  // failed call: throw, so the caller retries instead of caching zeros.
  const missing = clues.filter((c) => !byId.has(c.id)).map((c) => c.id);
  if (missing.length) throw new Error(`judge reply was incomplete: no rating for ${missing.join(", ")}`);
  const perClue = clues.map((c) => {
    const item = byId.get(c.id);
    let score = Number(item?.score);
    if (!Number.isFinite(score)) {
      if (typeof item?.pass !== "boolean" && item?.pass == null) {
        throw new Error(`judge reply was incomplete: no score for ${c.id}`);
      }
      const pass = typeof item.pass === "boolean" ? item.pass : String(item.pass).toLowerCase() === "yes";
      score = pass ? 100 : 0;
    }
    score = Math.min(100, Math.max(0, Math.round(score)));
    return { id: c.id, score, reason: String(item?.reason ?? "").slice(0, 160) };
  });
  const facets = {};
  for (const f of FACETS) {
    const v = Number(parsed?.[f.id]);
    if (!Number.isFinite(v)) throw new Error(`judge reply was incomplete: no ${f.id} rating`);
    facets[f.id] = Math.min(100, Math.max(0, Math.round(v)));
  }
  const { score, hint, bucket } = scoreFrom(clues, perClue, facets);
  return { score, hint, verdict: bucket, perClue, facets };
}
