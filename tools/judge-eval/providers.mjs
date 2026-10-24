/**
 * Provider adapters for the judge evaluation. Each returns the same shape:
 *   { text, usage: { input, output }, latencyMs, raw }
 * and throws on transport errors (HTTP status attached as err.status), so
 * run.mjs can back off on 429 and count failures separately from verdicts.
 *
 * Keys come from ridd-le/.env.judge (gitignored); run with
 *   node --env-file=.env.judge tools/judge-eval/run.mjs ...
 *
 * Cloudflare Workers AI has no key here: it is reached through the tiny
 * proxy worker in ./cf-proxy, run locally with `npx wrangler dev` (which
 * uses the machine's wrangler login and the real account's AI quota, the
 * same binding the production worker will use). Start it first:
 *   cd tools/judge-eval/cf-proxy && npx wrangler dev --port 8790
 */

const CF_PROXY = process.env.CF_PROXY_URL || "http://127.0.0.1:8790";

async function post(url, headers, body) {
  const t0 = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const latencyMs = Math.round(performance.now() - t0);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keep text
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.retryAfter = Number(res.headers.get("retry-after")) || null;
    throw err;
  }
  return { json, text, latencyMs, headers: res.headers };
}

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (see .env.judge)`);
  return v;
}

export const gemini = (model) => ({
  name: `gemini/${model}`,
  async complete({ system, user, schema }) {
    const { json, latencyMs } = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { "x-goog-api-key": need("GEMINI_API_KEY") },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      },
    );
    const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const u = json?.usageMetadata ?? {};
    return { text, usage: { input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0 }, latencyMs, raw: json };
  },
});

function openaiStyle(name, url, keyName, model, extra = {}) {
  return {
    name: `${name}/${model}`,
    async complete({ system, user, schema }) {
      const { json, latencyMs } = await post(
        url,
        { Authorization: `Bearer ${need(keyName)}`, ...(extra.headers ?? {}) },
        {
          model,
          temperature: 0,
          max_tokens: 1500,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: extra.jsonSchema
            ? { type: "json_schema", json_schema: { name: "judge", schema, strict: true } }
            : { type: "json_object" },
          ...(extra.body ?? {}),
        },
      );
      const text = json?.choices?.[0]?.message?.content ?? "";
      const u = json?.usage ?? {};
      return { text, usage: { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0 }, latencyMs, raw: json };
    },
  };
}

export const groq = (model, extra) =>
  openaiStyle("groq", "https://api.groq.com/openai/v1/chat/completions", "GROQ_API_KEY", model, {
    body: { reasoning_effort: "low" },
    ...extra,
  });

export const openrouter = (model, extra) =>
  openaiStyle("openrouter", "https://openrouter.ai/api/v1/chat/completions", "OPENROUTER_API_KEY", model, {
    headers: { "HTTP-Referer": "https://biccyanzac-pixel.github.io/ridd-le/", "X-Title": "ridd-le judge eval" },
    ...extra,
  });

export const cloudflare = (model) => ({
  name: `cloudflare/${model.replace(/^@cf\//, "")}`,
  async complete({ system, user }) {
    if (/gpt-oss/.test(model)) {
      // The gpt-oss models on Workers AI take the Responses API shape.
      const { json, latencyMs } = await post(`${CF_PROXY}/run`, {}, { model, instructions: system, input: user, reasoning: { effort: "low" } });
      const out = json?.output ?? [];
      const msg = out.find((o) => o.type === "message");
      const text = msg?.content?.map((c) => c.text ?? "").join("") ?? JSON.stringify(json);
      const u = json?.usage ?? {};
      return { text, usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0 }, latencyMs, raw: json };
    }
    const body = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      // Room for models that think before answering (Gemma 4 spends its
      // budget on reasoning_content first); the JSON itself is ~100 tokens.
      max_tokens: 1500,
    };
    // JSON mode where the model supports it; otherwise plain text, which
    // parseJudgeReply tolerates (it strips fences and prose). Workers AI
    // reports "doesn't support JSON Schema" / JSON mode as a 5025 error.
    let res;
    try {
      res = await post(`${CF_PROXY}/run`, {}, { ...body, response_format: { type: "json_object" } });
    } catch (err) {
      if (!/5025|JSON/i.test(err.message)) throw err;
      res = await post(`${CF_PROXY}/run`, {}, body);
    }
    const { json, latencyMs } = res;
    const r = json ?? {};
    // Two result shapes: { response: string|object } for most models, and an
    // OpenAI-style { choices: [{ message: { content } }] } for some newer ones.
    let text;
    if (Array.isArray(r.choices)) text = r.choices[0]?.message?.content ?? "";
    else if (typeof r.response === "string") text = r.response;
    else text = JSON.stringify(r.response ?? r);
    const u = r.usage ?? {};
    return {
      text,
      usage: { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, neurons: u.neurons ?? null },
      latencyMs,
      raw: json,
    };
  },
});

/** The candidate list. Keys are what --provider takes. */
export const CANDIDATES = {
  "gemini-3.5-flash-lite": () => gemini("gemini-3.5-flash-lite"),
  "gemini-3.8-flash": () => gemini("gemini-3.8-flash"),
  "groq-gpt-oss-20b": () => groq("openai/gpt-oss-20b"),
  "groq-qwen3.8-27b": () => groq("qwen/qwen3.8-27b", { body: {} }),
  "openrouter-gemma-4-26b": () => openrouter("google/gemma-4-26b-a4b-it:free"),
  "cf-llama-3.1-8b-fp8": () => cloudflare("@cf/meta/llama-3.1-8b-instruct-fp8"),
  "cf-gemma-4-26b": () => cloudflare("@cf/google/gemma-4-26b-a4b-it"),
  "cf-gpt-oss-20b": () => cloudflare("@cf/openai/gpt-oss-20b"),
  "cf-llama-3.3-70b": () => cloudflare("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
};
