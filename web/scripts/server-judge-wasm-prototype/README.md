# jacob.gg server-WASM judge

Server-side fallback for devices where the local in-browser WASM judge
cannot run (confirmed cause on at least one real iPhone: a
`RangeError: Out of memory` during `onnxruntime-web`'s WASM
`session.run()`, stemming from iOS WebKit's growable-shared-memory
ceiling - see the investigation notes in `web/scripts/kev-wasm-export/`
and this directory's git history for the full trail).

Runs the **exact** production `kev-0.6b` q4 model
(`model_q4.onnx` + `model_q4.onnx_data`, unmodified) through the
**exact** browser `onnxruntime-web/wasm` backend - not `onnxruntime-node`,
not a different quantization, not a converted model. Confirmed
numerically identical to the browser's own WASM path (see
`PARITY.md`... actually see the project's commit history for the
58-case parity measurements this was validated against before
deployment).

## Architecture

- `judge-wasm-server.mjs` - loads the tokenizer and one persistent ORT
  WASM session once; `judgeAnswer(answer, prompt)` scores one answer.
  `todaysPrompt()` derives the current riddle from the *same*
  `challengeForDay()` the browser and the Cloudflare leaderboard worker
  use - the server is the authority on "today's riddle"; a client
  cannot supply or influence it.
- `judge-worker.mjs` - runs inside a single persistent `worker_threads`
  Worker. Required, not optional: a direct test proved
  `onnxruntime-web`'s WASM inference blocks whatever thread calls it
  for the full multi-second duration with no cooperative yielding, so
  running it on the main thread made `/health` and queue admission
  unresponsive during every request.
- `queue.mjs` - bounded admission queue in front of that one worker.
  Rejects immediately (503) past `maxQueueLength`; `taskTimeoutMs`
  bounds how long a caller waits (it cannot cancel in-flight WASM
  compute - the worker still finishes that call before starting the
  next queued one).
- `server.mjs` - `POST /api/judge` (`{answer}` in, `{score, noul}` out -
  client can send neither a score/noul nor a prompt) and `GET /health`.
  Graceful shutdown on SIGINT/SIGTERM.

## Running it

```sh
npm install        # also fetches the ~375MB model files (postinstall)
npm start           # or: node server.mjs
```

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8788` | HTTP port |
| `JUDGE_ALLOWED_ORIGIN` | `http://localhost:5173` | CORS origin - **must** be set to the real production origin (e.g. `https://biccyanzac-pixel.github.io`) in any real deployment |
| `JUDGE_TEST_DAY_KEY` | unset | Operator-only override to replay a specific historical day's riddle for benchmarking. Never read from any request; only ever set by whoever launches the process. Leave unset in production. |

## Deploying

A `Dockerfile` is included for container-based hosts (Cloud Run,
Cloudflare Containers, etc.). For a plain VM (e.g. Oracle Always Free),
just `npm install && npm start` with `JUDGE_ALLOWED_ORIGIN` and `PORT`
set appropriately, ideally under a process manager (systemd, pm2) so it
restarts on crash/reboot.

## Verifying a deployment

```sh
curl https://<host>/health
curl -X POST https://<host>/api/judge -H "Content-Type: application/json" -d '{"answer":"a keyboard"}'
```

Compare against a local reference run before trusting a new deployment
- see the project's test scripts (`test-phase7-http-full.mjs` etc.) for
  the parity methodology.
