/**
 * Runs inside a single, persistent worker_threads Worker. All actual model
 * loading and WASM inference happens here, never on the main thread - this
 * is the fix for the confirmed event-loop-blocking problem: onnxruntime-
 * web's WASM session.run() blocks whatever thread calls it for the full
 * ~3-4s of inference, with no cooperative yielding. Running it in a worker
 * keeps the main thread (HTTP accept, queue admission, /health) responsive
 * at all times, so a bounded queue's "reject when full" logic can actually
 * be reached and a slow/stuck request cannot freeze the whole process.
 *
 * One worker, one session - this doesn't spawn a pool. Multiple workers
 * would mean multiple ~1.4GB sessions, which the measurements in this
 * directory already showed is expensive; "start with one worker/session"
 * per the brief.
 */
import { parentPort } from "node:worker_threads";
import { ensureLoaded, judgeAnswer } from "./judge-wasm-server.mjs";

parentPort.postMessage({ type: "status", ready: false, loading: true });

ensureLoaded()
  .then(() => parentPort.postMessage({ type: "status", ready: true, loading: false }))
  .catch((err) => parentPort.postMessage({ type: "status", ready: false, loading: false, error: String(err?.message || err) }));

parentPort.on("message", async (msg) => {
  if (msg.type !== "judge") return;
  const { id, answer, prompt } = msg;
  try {
    const result = await judgeAnswer(answer, prompt);
    parentPort.postMessage({ type: "result", id, result });
  } catch (err) {
    parentPort.postMessage({ type: "result", id, error: String(err?.message || err) });
  }
});
