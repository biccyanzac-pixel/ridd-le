import http from "node:http";

// Explicit agent with no keep-alive and no socket cap, so these 6 requests
// use 6 genuinely independent TCP connections dispatched in the same tick -
// plain fetch() reuses/pools connections to the same origin, which was
// silently serializing the previous attempt at this test.
const agent = new http.Agent({ keepAlive: false, maxSockets: Infinity });

function post(body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const t0 = Date.now();
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: 8788,
        path: "/api/judge",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
        agent,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body, ms: Date.now() - t0 }));
      },
    );
    req.on("error", (err) => resolve({ status: "ERR", body: String(err), ms: Date.now() - t0 }));
    req.write(data);
    req.end();
  });
}

const prompt = "What can you enter without going in?";
console.log("firing 6 truly independent requests simultaneously ...");
const results = await Promise.all(Array.from({ length: 6 }, (_, i) => post({ prompt, answer: `variant ${i}` })));
results.forEach((r, i) => console.log(`  req ${i}: status=${r.status} ms=${r.ms} ${r.body.slice(0, 90)}`));
const count503 = results.filter((r) => r.status === 503).length;
const count200 = results.filter((r) => r.status === 200).length;
console.log(`\n200 count: ${count200}, 503 (queue full) count: ${count503}`);
console.log("DONE");
