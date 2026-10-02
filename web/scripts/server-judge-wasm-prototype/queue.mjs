/**
 * Bounded admission queue in front of a single persistent worker_threads
 * Worker (judge-worker.mjs). The actual ~3-4s blocking WASM inference runs
 * entirely inside that worker, never on this (the main) thread - confirmed
 * necessary: a direct test showed onnxruntime-web's WASM session.run()
 * blocks the calling thread completely (even /health became unresponsive
 * for the full inference duration when run in-process), which made a
 * same-thread bounded queue's "reject when full" logic unreachable in
 * practice - nothing else could even run long enough to be counted as
 * "waiting" before the blocking call began. Moving inference into a worker
 * keeps this thread free to accept connections and enforce the queue limit
 * in real time.
 *
 * Still only one task in flight at a time (one worker, one session, one
 * ~1.4GB model) - this is admission control, not parallelism.
 */
import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export class QueueFullError extends Error {
  constructor() {
    super("The judge is busy right now - too many requests waiting.");
    this.name = "QueueFullError";
    this.statusCode = 503;
  }
}

export class QueueTimeoutError extends Error {
  constructor(stage) {
    super(`Judging timed out while ${stage}.`);
    this.name = "QueueTimeoutError";
    this.statusCode = 504;
  }
}

export class JudgeWorkerQueue {
  constructor({ maxQueueLength, queueTimeoutMs, taskTimeoutMs }) {
    this.maxQueueLength = maxQueueLength;
    this.queueTimeoutMs = queueTimeoutMs;
    this.taskTimeoutMs = taskTimeoutMs;
    this.waiting = [];
    this.running = false;
    this.closed = false;
    this.nextId = 1;
    this.pending = new Map(); // id -> item, while the worker is processing it
    this.status = { ready: false, loading: true, error: null };

    this.worker = new Worker(path.join(here, "judge-worker.mjs"));
    this.worker.on("message", (msg) => this._onWorkerMessage(msg));
    this.worker.on("error", (err) => this._onWorkerFatalError(err));
    this.worker.on("exit", (code) => {
      if (!this.closed) this._onWorkerFatalError(new Error(`worker exited unexpectedly (code ${code})`));
    });
  }

  get waitingCount() {
    return this.waiting.length;
  }

  judgeStatus() {
    return { ...this.status, queueDepth: this.waiting.length };
  }

  _onWorkerMessage(msg) {
    if (msg.type === "status") {
      this.status = { ready: msg.ready, loading: msg.loading, error: msg.error ?? null };
      return;
    }
    if (msg.type === "result") {
      const item = this.pending.get(msg.id);
      if (!item) return; // already timed out / settled for the caller
      this.pending.delete(msg.id);
      clearTimeout(item.taskTimeoutHandle);
      if (!item.settledForCaller) {
        item.settledForCaller = true;
        if (msg.error) item.reject(new Error(msg.error));
        else item.resolve(msg.result);
      }
      this.running = false;
      this._pump();
    }
  }

  /** The worker crashed outright - a single failed/timed-out judge call
   * must not permanently corrupt scoring, so this restarts it. In-flight
   * and queued requests at the time of the crash are failed cleanly
   * rather than left hanging forever. */
  _onWorkerFatalError(err) {
    console.error("[queue] worker fatal error, restarting:", err);
    this.status = { ready: false, loading: true, error: String(err?.message || err) };
    for (const item of this.pending.values()) {
      if (!item.settledForCaller) {
        item.settledForCaller = true;
        clearTimeout(item.taskTimeoutHandle);
        item.reject(new Error("Judge worker crashed."));
      }
    }
    this.pending.clear();
    this.running = false;
    try {
      this.worker.terminate();
    } catch {
      // already gone
    }
    this.worker = new Worker(path.join(here, "judge-worker.mjs"));
    this.worker.on("message", (msg) => this._onWorkerMessage(msg));
    this.worker.on("error", (e) => this._onWorkerFatalError(e));
    this.worker.on("exit", (code) => {
      if (!this.closed) this._onWorkerFatalError(new Error(`worker exited unexpectedly (code ${code})`));
    });
    this._pump();
  }

  drainWaiting(err) {
    const waiting = this.waiting;
    this.waiting = [];
    for (const item of waiting) {
      clearTimeout(item.queueTimeoutHandle);
      item.reject(err);
    }
  }

  async close() {
    this.closed = true;
    await this.worker.terminate();
  }

  run(taskArgs) {
    if (this.closed) {
      return Promise.reject(new Error("Server is shutting down; not accepting new work."));
    }
    if (this.waiting.length >= this.maxQueueLength) {
      return Promise.reject(new QueueFullError());
    }
    return new Promise((resolve, reject) => {
      const item = { taskArgs, resolve, reject, settledForCaller: false };
      item.queueTimeoutHandle = setTimeout(() => {
        const idx = this.waiting.indexOf(item);
        if (idx !== -1) {
          this.waiting.splice(idx, 1);
          item.settledForCaller = true;
          reject(new QueueTimeoutError("waiting in the queue"));
        }
      }, this.queueTimeoutMs);
      this.waiting.push(item);
      this._pump();
    });
  }

  _pump() {
    if (this.running || this.waiting.length === 0) return;
    const item = this.waiting.shift();
    clearTimeout(item.queueTimeoutHandle);
    this.running = true;

    const id = this.nextId++;
    this.pending.set(id, item);
    item.taskTimeoutHandle = setTimeout(() => {
      // The caller gets an answer now; the worker is still free to finish
      // this message and move on to the next on its own - we just stop
      // waiting for it here. The worker remains single-flight regardless.
      if (!item.settledForCaller) {
        item.settledForCaller = true;
        item.reject(new QueueTimeoutError("running inference"));
      }
    }, this.taskTimeoutMs);

    this.worker.postMessage({ type: "judge", id, ...item.taskArgs });
  }
}
