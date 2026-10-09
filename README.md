# ridd-le — Daily

**▶ [Play today's riddle](https://biccyanzac-pixel.github.io/ridd-le/)**

A daily riddle with deliberately no official answer. You propose an
interpretation, a language model judges whether it makes the riddle true, and
the leaderboard discovers the strongest readings after the fact.

Three things define it:

1. **The score is a probability, not an opinion.** The judge is asked yes/no
   questions and returns probabilities; the score is a probability × 100, at
   full precision. Nothing generates a 0–100 judgement directly and nothing
   rescales it; rounding to two decimals happens only at display time.

   From 5 October the riddle is judged by **two** questions, both answered in
   the browser:

   | | |
   | --- | --- |
   | is it an answer | *This is a real answer to the riddle "…", not a rewording of it.* |
   | is it a rewording | *The answer describes the riddle "…" instead of naming a thing that answers it.* |

   The score is the first scaled down by the second: `first × (1 − second)^1.5`.
   Multiplying rather than subtracting matters — subtracting a penalty lowers
   every answer including the good ones, while scaling leaves an answer that
   earns no penalty untouched.

   Before 5 October a single question was asked, and days up to then keep it
   (see `SCORING_VERSIONS`). That question could be farmed: an answer that
   restated the riddle in synonyms scored 98.77 while genuine answers scored
   around 41, because word-overlap filtering cannot see that "people" and
   "individuals" mean the same thing. Twenty-seven single-question phrasings
   were measured and none fixed it, including compound ones — telling this
   model "and not a rewording" merely raises every score, since it does not
   check the negative half of an instruction. Two questions do fix it:
   measured against real submissions, genuine answers went from 41 to 50 and
   reworded ones from 83 to 28.
2. **The model runs in your browser.** open-jev's `kev-0.6b` via WebGPU (with
   a same-model WASM fallback). No API key, no inference bill, no answer
   leaving your device to be scored. The trade-off is honest and documented
   under [Known limitations](#known-limitations).
3. **Three attempts, scored as their average.** Not best-of-three — all three
   count, so a weak first guess can't be discarded. That's enforced in the
   database, not promised by the client.

## How a day works

| | |
| --- | --- |
| **The riddle** | One per day, rotating, the same for everyone. Changes at 00:00 UTC. |
| **Attempts** | 3 per player per day. Your daily score is their average. |
| **Duplicates** | The same answer can't be submitted twice — rejected before it costs you an attempt. |
| **Today's board** | Other players' answer text stays hidden until you've used all 3 of your own attempts, so nobody can crib a strong reading. Ranks and averages are always visible. |
| **Past days** | Never redacted. Yesterday's strongest interpretations and best average are shown on the page. |
| **Bonus round** | Unlocks once the riddle is finished: *what's the opposite of X?* Its own 3 guesses, its own leaderboard. |
| **Archive** | Browse and replay any past day. Replays are tagged and shown on a separate "late" board, so a day's original result can never be rewritten. |

There is intentionally no answer key anywhere in this repository. The riddle's
own wording is the only thing the judge is given.

## Architecture

Two deployed pieces, plus a shared core both of them read.

```
web/      Vite app -> GitHub Pages. Runs the judge in the browser.
worker/   Cloudflare Worker + D1. The shared leaderboard. Never runs a model.
shared/   Isomorphic core: challenge rotation, normalisation, hashing.
```

`shared/` is the reason the two sides can't disagree. The browser derives
today's challenge from the UTC date; the worker independently recomputes it
from its own clock and rejects any submission whose challenge id doesn't
match. Neither side is trusted to *choose* a challenge.

A challenge id looks like `enter-without-going-in@v4:2026-10-03` —
slug, scoring version, UTC day. It is the leaderboard's partition key: a new
day, or a bumped scoring version, is simply a different board. The bonus round
uses the same shape (`bonus-opposite@v1:2026-10-03`), which is why it gets its
own leaderboard for free.

### Why the worker exists

Scoring is client-side, so the worker's job is narrower than it looks: be the
one thing every player's browser agrees on. It makes "3 attempts, averaged" a
database fact instead of a client promise, and makes the leaderboard real
shared state instead of per-device storage.

Because inference happens in the browser, a determined player could alter
their own score before it reaches the worker. The worker doesn't re-run the
model (that would need paid server inference and defeat the whole design). It
closes every cheaper hole instead: challenge ids are recomputed server-side,
the answer hash must match an independent recompute of the same
normalise-and-hash the browser did, the score must equal probability × 100,
attempt numbers are assigned from an actual row count, sessions are
server-issued, and submissions are insert-only — nothing is ever updated or
deleted after the fact.

### Scoring version

`SCORING_VERSION` is the contract between how a score was produced and the
scores stored under it. It's folded into the challenge id and the answer hash,
so evaluations never carry across a bump — a bump starts a fresh board rather
than silently mixing incomparable numbers.

v1 hosted judge · v2 in-browser open weights · v3 full-precision scores and
three attempts · **v4** open-ended riddles, daily score becomes the average.

## Running it locally

```bash
cd web && npm install && npm run dev      # http://localhost:5173
```

That's enough to play. For the leaderboard, run the worker too — **don't point
local development at production**: its `ALLOWED_ORIGIN` rightly refuses
localhost (every call fails with "Failed to fetch"), and submissions would
write real rows.

```bash
cd worker && npm install
npm run db:init:local        # create the local D1 schema
npm run db:migrate:local     # apply migrations/
npm run dev:local            # localhost:8787, CORS open to localhost:5173
```

Then point the dev server at it by creating `web/.env.local` (gitignored):

```
VITE_LEADERBOARD_URL=http://localhost:8787
```

With that unset — as in any real build — the app uses `web/public/config.json`
instead, so production is unaffected.

### Deploying

Order matters. The worker's insert references a column that a migration adds,
so a worker deployed ahead of its migration breaks every submission:

1. `cd worker && npx wrangler d1 execute jacob-gg-leaderboard --remote --file=migrations/<n>.sql`
2. `cd worker && npm run deploy`
3. push to `main` — `web/**` or `shared/**` changes trigger the Pages build

## Known limitations

Honest list; none of these are secretly handled.

- **A browser that runs the model but lies about the result.** There is no
  server-side model run to catch it. That is the accepted cost of free,
  local inference.
- **Devices without working WebGPU can't play.** There is a WASM fallback and,
  behind it, a server-judge fallback — but the server judge's URL isn't
  configured in the Pages build, so in production it resolves to localhost and
  can never answer. On such a device the judge simply fails to load.
- **The riddle and bonus-word lists are public.** They're in this repository
  and in the deployed JavaScript bundle, so anyone can read ahead. Fixing it
  properly means serving one day at a time from D1 and keeping the content out
  of git entirely.
- **The bonus round's scoring is weak.** The riddle statement was chosen by
  measuring ten candidate phrasings against a hand-scored benchmark
  (`web/scripts/riddle-bench/`). The bonus round's "opposite of X" statement
  was not, and measurement shows it barely separates a sensible answer from
  nonsense — scores land in a narrow band near zero regardless of effort.
  `web/scripts/riddle-bench/bonus-sweep.mjs` reproduces this.
- **A well-formed but irrelevant answer still scores middling.** The two-
  question scoring suppresses rewording, not irrelevance: nothing the model
  was asked distinguishes a good answer from a fluent unrelated one. On
  5 October's riddle "purple elephant toaster" scores 54.8 against 52.3 for
  genuine answers. It is not a regression - one question gave it 77.6 against
  72.5 - but it is not solved either, and no detector tried could tell the two
  apart (asking whether an answer is "meaningful English" rates nonsense 89.6
  and good answers 89.8).
- **Rate limiting is per-isolate and in-memory.** Enough to blunt a burst, not
  a real distributed limiter.

## Repository layout

| Path | What it is |
| --- | --- |
| `web/` | The game. Vite + the in-browser judge. Deployed to Pages. |
| `worker/` | Leaderboard API. Cloudflare Worker + D1, with `schema.sql` and `migrations/`. |
| `shared/` | Challenge rotation, answer normalisation, hashing — read by both sides. |
| `web/scripts/riddle-bench/` | The measurements behind the judge's question phrasing. |
| `server.js`, `lib/`, `start-game.cmd` | Legacy v1: a local Express + SQLite server from before scoring moved into the browser. Not deployed, not how the game runs now. |

## Credits

Judge: [open-jev](https://github.com/nico-martin/open-jev) running
`onnx-community/kev-0.6b-ONNX`, an open reproduction of the shape of a typed
decision model. Not a hosted API.

Optional background music: Mozart's *Lacrimosa* (Requiem, K. 626) — Bruno
Walter / Wiener Philharmoniker, 1956, public domain.
