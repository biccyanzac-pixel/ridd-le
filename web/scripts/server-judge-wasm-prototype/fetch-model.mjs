/**
 * Fetches the exact production model files this server judges with.
 * Not committed to git (750MB x2 across both files is inappropriate for
 * a repo) - run once after install, on first boot, or in a container
 * build step. Idempotent: skips any file already present.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = "https://huggingface.co/onnx-community/kev-0.6b-ONNX/resolve/main/onnx";
const files = ["model_q4.onnx", "model_q4.onnx_data"];

for (const name of files) {
  const dest = path.join(here, name);
  if (fs.existsSync(dest)) {
    console.log(`[fetch-model] skip (exists): ${name} (${fs.statSync(dest).size} bytes)`);
    continue;
  }
  console.log(`[fetch-model] downloading ${name} ...`);
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) throw new Error(`[fetch-model] ${name}: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const out = fs.createWriteStream(dest);
  let loaded = 0;
  let lastPct = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.write(value);
    loaded += value.length;
    const pct = total ? Math.floor((loaded / total) * 100) : 0;
    if (pct !== lastPct && pct % 20 === 0) {
      lastPct = pct;
      console.log(`[fetch-model]   ${name}: ${pct}%`);
    }
  }
  await new Promise((resolve) => out.end(resolve));
  console.log(`[fetch-model] done: ${name} (${loaded} bytes)`);
}
console.log("[fetch-model] all model files present.");
