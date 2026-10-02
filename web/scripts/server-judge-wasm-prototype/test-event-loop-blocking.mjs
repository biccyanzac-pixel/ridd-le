// Fires one /api/judge request, then immediately (and repeatedly) polls
// /health to see whether the server can respond to ANYTHING else while
// inference is running, or whether the whole process is frozen.
const prompt = "What can you enter without going in?";

const judgeStart = Date.now();
const judgePromise = fetch("http://127.0.0.1:8788/api/judge", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt, answer: "a stalling test answer" }),
}).then(async (r) => ({ status: r.status, ms: Date.now() - judgeStart, body: await r.text() }));

const healthPings = [];
const pingInterval = setInterval(async () => {
  const t0 = Date.now();
  try {
    const r = await fetch("http://127.0.0.1:8788/health");
    healthPings.push({ t: t0 - judgeStart, healthMs: Date.now() - t0, status: r.status });
  } catch (err) {
    healthPings.push({ t: t0 - judgeStart, healthMs: Date.now() - t0, status: "ERR" });
  }
}, 200);

const judgeResult = await judgePromise;
clearInterval(pingInterval);
await new Promise((r) => setTimeout(r, 300)); // let any trailing ping finish

console.log("judge result:", judgeResult);
console.log("\nhealth pings during that window:");
for (const p of healthPings) console.log(`  t=${p.t}ms status=${p.status} (took ${p.healthMs}ms to respond)`);
console.log("DONE");
