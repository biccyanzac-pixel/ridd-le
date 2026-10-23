# Judge evaluation

Which free hosted model should judge Ridd-le answers against the clue
checklists, and what the free tiers actually allow. Measured on 2026-10-23
with `tools/judge-eval/run.mjs` over the labelled test set in
`tools/judge-eval/testset.json`: 30 riddles × 20 answers = 600 pairs, every
one with a ground-truth verdict. Categories per riddle: the intended answer
(1), genuinely valid alternatives (4), near-misses that fail one clue (4),
vague answers (2), confident wrong answers (4), nonsense (2), adversarial
inputs such as "whatever satisfies all your clues" (3). Ground truth was
authored by Claude Fable 5.1 against `shared/clues.js`; the owner declined the
100-pair review sample.

42 of the 600 cases never reach a model: the junk filter
(`shared/judge-normalize.js`) refuses empty answers, answers over six words,
and the riddle's own words with nothing added. They count as "wrong" in every
model's numbers below, identically.

## Free tiers, verified 2026-10-23

| Provider | What is free | Hard limit that matters | Trains on inputs? | Notes |
| --- | --- | --- | --- | --- |
| Cloudflare Workers AI | 10,000 neurons/day on the Workers Free plan | neurons: Llama 3.1 8B ≈ 7 per judge call (≈1,400/day), gpt-oss-20b ≈ 21 (≈480/day), Llama 3.3 70B ≈ 47 (≈210/day) | No (documented) | Published limits, no card, same account as the worker. Not every model supports JSON mode. |
| Groq | 1,000 requests/day/model, 8,000 tokens/min | **200,000 tokens/day per model** (observed in the 429 body), ≈ 350 to 475 judge calls/day | Not by default; no retention | Fastest. Llama 3.x moved to enterprise only; gpt-oss-20b and Qwen 3.8 27B are the free small models. |
| Google Gemini (AI Studio) | per-model daily cap | **500 requests/day** for gemini-3.5-flash-lite (observed in the 429 body); 6-hour wait when hit | Yes, free tier | gemini-2.5-* no longer available to new users. |
| OpenRouter `:free` | 20 req/min | **50 requests/day** unless $10 of credits have ever been bought; free models are routed to a shared upstream pool that was rate-limited every time it was tried | Varies by upstream | Disqualified: too small a cap, and unreliable. |
| Mistral | "Free mode" | not published; the owner's account needs an upgrade to create keys | Yes (last known) | Disqualified: no key. |
| Cerebras, SambaNova, Together, GitHub Models | | card required / 20 req/day / no free tier / retired 2026-07-30 | | Disqualified. |

## Results

Interim: the daily caps above mean one full pass takes more than a day on
Groq and Gemini. Numbers are over the cases judged so far (shown per row) and
will be updated when the runs finish. Accuracy = verdict equals the label.
False-correct = a case labelled close or wrong that was called correct (the
worst error: it rewards nonsense). False-wrong = a valid answer called wrong.

| Model | Cases | Accuracy | False-correct | False-wrong on valid | Median latency | Tokens in/out | Daily capacity (free) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Groq · qwen/qwen3.8-27b | 549 | 78.1% | 6.6% (27) | 1.4% (2) | 264 ms | 338/81 | ≈475 |
| Groq · openai/gpt-oss-20b | 462 | 77.9% | 7.8% (27) | 2.6% (3) | 444 ms | 415/141 | ≈350 |
| Gemini · gemini-3.5-flash-lite | 530 | 72.8% | 7.5% (30) | 0.8% (1) | 871 ms | 320/94 | 500 |
| Workers AI · llama-3.1-8b-instruct-fp8 | 600 | 57.2% | **31.3% (141)** | 1.3% (2) | 5,406 ms | 328/102 | ≈1,400 |
| Workers AI · gemma-4-26b-a4b-it | 60 | 46.7% | 0% | 0% | 25,095 ms | 337/1253 | ≈850 |
| Workers AI · openai/gpt-oss-20b | running | | | | | | ≈480 |
| OpenRouter · gemma-4-26b:free | 0 | upstream rate-limited on every call | | | | | 50 |

Per category, accuracy and how the verdicts fell (correct/close/wrong):

| Model | intended | alt | near | vague | wrong | nonsense | adversarial |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Groq · Qwen 3.8 27B | 100% | 84% (92/16/2) | 80% (16/85/5) | 62% (2/19/34) | 48% (8/49/53) | 98% | 98% |
| Groq · gpt-oss-20b | 96% | 76% (69/19/3) | 75% (15/68/8) | 65% (1/15/30) | 62% (8/26/56) | 100% | 92% |
| Gemini 3.5 Flash-Lite | 100% | 87% (90/13/1) | 76% (16/77/9) | 32% (2/34/17) | 50% (11/43/53) | 87% | 90% |
| Workers AI Llama 3.1 8B | 87% | 82% | 31% (63/37/11) | 43% (25/9/26) | 35% (40/36/43) | 72% | 77% |

What the numbers say:

- The three capable models agree closely (73 to 78% accuracy, 7% false-correct,
  1 to 3% false-wrong). Their remaining errors are mostly the same ones: a
  confident wrong answer that passes one of the two clues gets "close" rather
  than "wrong" (that is the verdict rule working as written, not a model
  slip), and about one in fourteen genuinely wrong answers passes both clues
  on a charitable reading.
- Llama 3.1 8B says yes to nearly everything: 40 of 122 confident wrong
  answers were called correct. It cannot be the judge, however cheap.
- Gemma 4 on Workers AI spends its whole output budget thinking and times out
  on half the cases; it is also 25 seconds a call.
- OpenRouter's free pool never answered. Mistral has no key.

## Consistency

Temperature 0 everywhere. The 5-run consistency check (same input five times,
any disagreement fails) is scheduled for the two finalists once their daily
token budgets reset; the production cache makes this moot for players (a
verdict is served from the cache after its first judging) but it matters for
pre-warming and for flagged-verdict reviews. Results will be added here.

## Recommendation

- **Primary: Groq, `qwen/qwen3.8-27b`.** Best accuracy and the lowest
  false-correct rate of the field, the fastest by far, no training on inputs,
  and about 475 judge calls a day. With the cache and pre-warming, a day of
  Ridd-le at current traffic (a handful of players, 3 attempts each) uses a
  few dozen.
- **Backup: Cloudflare Workers AI, `@cf/openai/gpt-oss-20b`** (pending its
  run; it is the same model as Groq's gpt-oss-20b, which scored 78%). A
  different company, no training on inputs, published limits, no key to
  manage, and the same account the worker already runs on. If its run
  disappoints, Gemini 3.5 Flash-Lite is the alternative at 500 calls a day,
  with the caveat that Google's free tier may train on the prompts (riddle,
  clues and the answer only; no player data).
- Switch at 80% of the primary's day, pause at 100% of both
  (`worker/wrangler.toml`: `JUDGE_PRIMARY_DAILY`, `JUDGE_BACKUP_DAILY`).

## Reproducing

```
# keys in .env.judge (gitignored): GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY
node tools/judge-eval/run.mjs --check
node --env-file=.env.judge tools/judge-eval/run.mjs --provider groq-qwen3.8-27b --rpm 10
# Workers AI goes through a local proxy worker with the AI binding:
(cd tools/judge-eval/cf-proxy && npx wrangler dev --port 8790)
node tools/judge-eval/run.mjs --provider cf-gpt-oss-20b --rpm 20
node --env-file=.env.judge tools/judge-eval/run.mjs --provider groq-qwen3.8-27b --repeat 5 --sample 60
node tools/judge-eval/run.mjs --report        # tools/judge-eval/results/tables.md
```

Raw replies are cached under `tools/judge-eval/results/raw/` (gitignored), so
a rerun costs no quota and a run interrupted by a daily cap resumes where it
stopped.
