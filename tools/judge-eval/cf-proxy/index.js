// POST /run { model, messages, temperature, max_tokens, response_format }
// -> the raw Workers AI result. Local evaluation only; see wrangler.toml.
export default {
  async fetch(request, env) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/run") {
      return new Response("POST /run", { status: 404 });
    }
    const { model, ...input } = await request.json();
    try {
      const result = await env.AI.run(model, input);
      return Response.json(result);
    } catch (err) {
      const message = String(err?.message ?? err);
      const status = /429|rate|quota|limit/i.test(message) ? 429 : 502;
      return new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json" } });
    }
  },
};
