/**
 * Server-WASM judge fallback client. Used ONLY when WebGPU is confirmed
 * unusable AND the local WASM fallback (judge-wasm.js) itself failed to
 * load (e.g. the real-device session-create OOM this fallback exists for -
 * see web/scripts/kev-wasm-export and web/scripts/server-judge-wasm-
 * prototype for the investigation). Never attempted merely because WebGPU
 * is unavailable, and never attempted if local WASM already works.
 *
 * This client sends nothing but { prompt, answer } and reads back
 * { score, noul } - the server computes everything itself using the exact
 * same onnxruntime-web "wasm" backend and the exact same q4 model file as
 * the browser's own WASM fallback (see judge-wasm-server.mjs in the
 * prototype directory this is validated against). No score is ever
 * computed client-side on this path; no model is ever downloaded to the
 * browser on this path.
 *
 * SERVER_JUDGE_BASE_URL has no production value yet - this fallback is
 * not deployed. It is only exercised in local testing against the
 * server prototype (web/scripts/server-judge-wasm-prototype/server.mjs).
 */
const SERVER_JUDGE_BASE_URL = import.meta.env?.VITE_SERVER_JUDGE_BASE_URL || "http://127.0.0.1:8788";
const HEALTH_PATH = "/health";
const JUDGE_PATH = "/api/judge";
const HEALTH_TIMEOUT_MS = 3000;
const JUDGE_TIMEOUT_MS = 30_000;

export class ServerJudgeUnavailableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "ServerJudgeUnavailableError";
    this.cause = cause;
  }
}

/** Cheap reachability probe - does NOT download or run anything. Used by
 * judge.js to decide whether the server fallback is worth attempting at
 * all, before any player answer is involved. */
export async function isServerJudgeReachable() {
  try {
    const res = await fetch(`${SERVER_JUDGE_BASE_URL}${HEALTH_PATH}`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.ready === true;
  } catch {
    return false;
  }
}

/** A minimal object matching the { runtime, decide-like } shape judge.js
 * expects from a loaded judge, but scoreAnswer() in judge.js branches on
 * `runtime.device === "server-wasm"` to call judgeViaServer() directly
 * instead of the usual decide() - the server needs the bare prompt (to
 * build its own statement itself, server-side), not the pre-built
 * statement string the local paths use, so this intentionally does not
 * try to reuse decide()'s (state, questions) signature. */
export function createServerJev() {
  return {
    runtime: { model: "onnx-community/kev-0.6b-ONNX", family: "kev", device: "server-wasm", dtype: "q4" },
    disposed: false,
    async dispose() {
      this.disposed = true;
    },
  };
}

/** The actual scoring call. `answer` should be the RAW (not yet
 * canonicalised) answer text - the server canonicalises it itself, the
 * same way judge-wasm.js's local path does, so this must not canonicalise
 * twice with different inputs than what the server receives. */
export async function judgeViaServer({ answer, prompt }) {
  let response;
  try {
    response = await fetch(`${SERVER_JUDGE_BASE_URL}${JUDGE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, answer }),
      signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ServerJudgeUnavailableError(`Could not reach the server judge: ${err.message}`, err);
  }
  if (!response.ok) {
    let text = "";
    try {
      text = await response.text();
    } catch {
      // status alone is enough
    }
    throw new ServerJudgeUnavailableError(`Server judge returned HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new ServerJudgeUnavailableError("Server judge returned a body that is not JSON.");
  }
  if (typeof body?.noul !== "number") {
    throw new ServerJudgeUnavailableError("Server judge response has no numeric noul.");
  }
  return body.noul;
}
