/**
 * Server-WASM judge fallback. POST /api/judge computes and returns the
 * score itself - the client supplies only {answer}. The prompt/riddle is
 * NEVER accepted from the client: the worker derives "today's riddle"
 * itself via the same shared challengeForDay() the browser and the
 * Cloudflare leaderboard worker already use (see judge-wasm-server.mjs's
 * todaysPrompt()), so a client can never choose or influence what its
 * answer is actually judged against.
 *
 * Queue sizing rationale (not an arbitrary guess - see the earlier
 * measurements in this directory): a single warm request takes ~2.9-4.4s
 * on a quiet machine. With one strictly-sequential worker (queue.mjs), a
 * queue of 3 waiting requests means the unluckiest caller waits up to
 * ~3 x 4.4s ≈ 13s before their own request even starts, plus its own run -
 * bounded, and still "a few seconds" territory for a low-traffic game,
 * without letting an unbounded pile-up blow past that. taskTimeoutMs is
 * set well above the observed worst-case single-request latency with
 * headroom for slower/loaded hardware; queueTimeoutMs covers worst-case
 * queued wait. See TIMEOUT_RATIONALE.md in this directory for the full
 * measurement history behind these two numbers.
 */
import http from "node:http";
// Deliberately NOT importing judge-wasm-server.mjs here - that module pulls
// in onnxruntime-web/@huggingface/transformers, which this (the main)
// thread never needs now that inference runs entirely inside the worker
// (judge-worker.mjs). MAX_ANSWER comes from the real shared module.
import { MAX_ANSWER } from "../../../shared/challenges.js";
import { JudgeWorkerQueue, QueueFullError, QueueTimeoutError } from "./queue.mjs";

const PORT = Number(process.env.PORT) || 8788;
const ALLOWED_ORIGIN = process.env.JUDGE_ALLOWED_ORIGIN || "http://localhost:5173";
const MAX_BODY_BYTES = 8 * 1024;

const QUEUE_MAX_LENGTH = 3;
const QUEUE_TIMEOUT_MS = 20_000;
const TASK_TIMEOUT_MS = 15_000;

const queue = new JudgeWorkerQueue({
  maxQueueLength: QUEUE_MAX_LENGTH,
  queueTimeoutMs: QUEUE_TIMEOUT_MS,
  taskTimeoutMs: TASK_TIMEOUT_MS,
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let rejected = false;
    const chunks = [];
    req.on("data", (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        // Deliberately NOT calling req.destroy() here - that tears down
        // the socket before the 413 response below can be written to it.
        // The client's error response matters more than cutting the
        // connection early; the stream is simply ignored from here.
        reject(Object.assign(new Error("Request body too large."), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => {
      if (!rejected) reject(err);
    });
  });
}

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

// Known-safe field set - just the answer. Anything else (score, noul,
// logits, model, prompt, ...) is rejected outright rather than silently
// ignored, so a client can never smuggle a result through disguised as
// an unrelated field, and can never supply its own prompt/riddle.
const ALLOWED_FIELDS = new Set(["answer"]);

async function handleJudge(req, res) {
  let raw;
  try {
    raw = await readBody(req);
  } catch (err) {
    send(res, err.statusCode ?? 400, { error: err.message });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    send(res, 400, { error: "Body must be valid JSON." });
    return;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    send(res, 400, { error: "Body must be a JSON object." });
    return;
  }

  const unexpectedFields = Object.keys(payload).filter((k) => !ALLOWED_FIELDS.has(k));
  if (unexpectedFields.length > 0) {
    send(res, 400, { error: `Unexpected field(s): ${unexpectedFields.join(", ")}. Only prompt and answer are accepted.` });
    return;
  }

  const { answer } = payload;
  if (typeof answer !== "string" || answer.trim() === "" || answer.length > MAX_ANSWER) {
    send(res, 400, { error: `\`answer\` must be a non-empty string of at most ${MAX_ANSWER} characters.` });
    return;
  }

  try {
    // Logged only as a length, never the full text - players' answers
    // aren't logged in full unnecessarily.
    console.log(`[judge] request: answerLen=${answer.length} queueDepth=${queue.waitingCount}`);
    // Matches judge.js's scoreAnswer() contract exactly: score is 0-100
    // (scoreFromNoul(noul)), noul is the raw 0-1 probability - NOT the
    // same number twice.
    const result = await queue.run({ answer });
    send(res, 200, { score: result.score, noul: result.noul });
  } catch (err) {
    if (err instanceof QueueFullError) {
      send(res, err.statusCode, { error: err.message });
      return;
    }
    if (err instanceof QueueTimeoutError) {
      send(res, err.statusCode, { error: err.message });
      return;
    }
    console.error("[judge] inference failed:", err);
    send(res, 500, { error: "Judging failed." });
  }
}

function handleHealth(req, res) {
  const status = queue.judgeStatus();
  send(res, status.ready ? 200 : 503, status);
}

const server = http.createServer(async (req, res) => {
  withCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    handleHealth(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/judge") {
    await handleJudge(req, res);
    return;
  }
  send(res, 404, { error: "Not found." });
});

// The worker starts loading the model itself as soon as it spawns (see
// judge-worker.mjs) - nothing to kick off here; /health reflects its
// status messages as they arrive.

server.listen(PORT, () => {
  console.log(`SERVER LISTENING on http://127.0.0.1:${PORT} (allowed origin: ${ALLOWED_ORIGIN})`);
});

let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[judge] received ${signal}, shutting down gracefully ...`);
  queue.drainWaiting(new Error("Server is shutting down."));
  server.close(() => {
    console.log("[judge] closed HTTP listener.");
  });
  await queue.close();
  console.log("[judge] worker terminated; exiting.");
  process.exit(0);
}
function onSignal(signal) {
  // If something in-flight never settles, don't hang forever.
  setTimeout(() => process.exit(1), 30_000).unref();
  gracefulShutdown(signal);
}
process.on("SIGINT", () => onSignal("SIGINT"));
process.on("SIGTERM", () => onSignal("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
