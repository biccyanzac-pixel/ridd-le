/**
 * Server-side judge module. Loads the tokenizer and creates ONE persistent
 * onnxruntime-web "wasm" session once (lazily, on first call), then reuses
 * it for every subsequent judgeAnswer() call - never reloads the ~375MB
 * model per request.
 *
 * Uses import * as ort from "onnxruntime-web/wasm" - the exact same
 * package/version/bundle the browser's web/src/judge-wasm.js loads, not
 * onnxruntime-node. DELIMS/OPTIONS/tok/markerId/buildInputs below are
 * copied verbatim from the production web/src/judge-wasm.js (same
 * source as the prototype's judge-core.mjs) - not rewritten from memory.
 * canonicalizeForJudge, riddleStatement, scoreFromNoul, and assertNoul are
 * imported directly from the real shared modules used by the production
 * browser judge, not reimplemented.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AutoTokenizer } from "@huggingface/transformers";
import * as ort from "onnxruntime-web/wasm";
import { canonicalizeForJudge } from "../../../shared/judge-canonicalize.js";
import { scoreFromNoul, assertNoul, riddleStatement, MAX_ANSWER } from "../../../shared/challenges.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL_REPO = "onnx-community/kev-0.6b-ONNX";
const MODEL_PATH = path.join(here, "model_q4.onnx");
const EXTERNAL_DATA_PATH = path.join(here, "model_q4.onnx_data");

export { MAX_ANSWER };
export const MAX_PROMPT_LEN = 300; // generous upper bound on riddle prompt length; today's prompts are <100 chars

// --- copied verbatim from web/src/judge-wasm.js ---
const DELIMS = {
  state: "<|fim_prefix|>",
  question: "<|fim_middle|>",
  option_start: "<|box_start|>",
  option_end: "<|box_end|>",
  decide: "<|fim_suffix|>",
};
const OPTIONS = ["no", "yes"];

function tok(tokenizer, text) {
  return Array.from(tokenizer(text, { add_special_tokens: false }).input_ids.data, Number);
}

function markerId(tokenizer, text) {
  const ids = tok(tokenizer, text);
  if (ids.length !== 1) throw new Error(`[judge-wasm-server] "${text}" is not a single token: ${ids}`);
  return ids[0];
}

function buildInputs(tokenizer, stateText, instructionsText) {
  const markers = {};
  for (const [k, v] of Object.entries(DELIMS)) markers[k] = markerId(tokenizer, v);
  const instrIds = tok(tokenizer, instructionsText);
  const branch = [markers.question, ...instrIds];
  const ends = [];
  for (const opt of OPTIONS) {
    const optIds = tok(tokenizer, opt);
    branch.push(markers.option_start, ...optIds, markers.option_end);
    ends.push(branch.length - 1);
  }
  branch.push(markers.decide);
  const stateIds = tok(tokenizer, stateText);
  const inputIds = [markers.state, ...stateIds, ...branch];
  const base = 1 + stateIds.length;
  const optionPositions = ends.map((e) => base + e);
  return { inputIds, optionPositions };
}
// --- end verbatim copy ---

let readyState = { tokenizer: null, session: null, loadingPromise: null, error: null };

export function judgeStatus() {
  return {
    ready: Boolean(readyState.tokenizer && readyState.session),
    loading: Boolean(readyState.loadingPromise) && !readyState.tokenizer,
    error: readyState.error ? String(readyState.error.message || readyState.error) : null,
  };
}

async function doInit() {
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_REPO);
  ort.env.wasm.numThreads = 1;
  const modelBuf = new Uint8Array(fs.readFileSync(MODEL_PATH));
  const externalDataBuf = new Uint8Array(fs.readFileSync(EXTERNAL_DATA_PATH));
  const session = await ort.InferenceSession.create(modelBuf, {
    executionProviders: ["wasm"],
    externalData: [{ path: "model_q4.onnx_data", data: externalDataBuf }],
  });
  readyState.tokenizer = tokenizer;
  readyState.session = session;
  return { tokenizer, session };
}

/** Loads the tokenizer + creates the one persistent session, exactly once.
 * Safe to call from multiple concurrent requests before it resolves - they
 * all share the same in-flight promise. */
export async function ensureLoaded() {
  if (readyState.tokenizer && readyState.session) return readyState;
  if (!readyState.loadingPromise) {
    readyState.loadingPromise = doInit().catch((err) => {
      readyState.error = err;
      readyState.loadingPromise = null; // allow a retry on next call
      throw err;
    });
  }
  await readyState.loadingPromise;
  return readyState;
}

/**
 * Score one answer against one riddle prompt. Mirrors production's
 * judge.js scoreAnswer() + WasmJev.decide() exactly: canonicalize the
 * answer, build the statement via riddleStatement(prompt) (same shared
 * function used client-side), run inference, softmax over the two option
 * logits, P(yes) is the noul.
 *
 * Returns the same shape judge.js's scoreAnswer() returns (minus `ms`,
 * added by the caller) so a server response can be consumed identically.
 */
export async function judgeAnswer(answer, prompt) {
  const { tokenizer, session } = await ensureLoaded();

  const statement = riddleStatement(prompt);
  const state = canonicalizeForJudge(answer);
  const { inputIds, optionPositions } = buildInputs(tokenizer, state, statement);

  const results = await session.run({
    input_ids: new ort.Tensor("int64", BigInt64Array.from(inputIds.map(BigInt)), [1, inputIds.length]),
    attention_mask: new ort.Tensor("int64", BigInt64Array.from(inputIds.map(() => 1n)), [1, inputIds.length]),
  });

  const flat = results.logits.data;
  const optLogits = optionPositions.map((p) => Number(flat[p]));
  const max = Math.max(...optLogits);
  const exps = optLogits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map((v) => v / sum);
  const probability = assertNoul(probs[OPTIONS.indexOf("yes")]);

  return {
    noul: probability,
    score: scoreFromNoul(probability),
    model: `${MODEL_REPO}/q4`,
    device: "server-wasm",
  };
}
