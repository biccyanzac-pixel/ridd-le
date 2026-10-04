/**
 * Drives framing-v2.html and reports each framing against every requirement:
 * does it rank genuine answers, does it keep parroting and nonsense below
 * good answers, and does a good answer actually score high.
 *
 *   node scripts/riddle-bench/run-framing-v2.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import { pairwiseAccuracy, spearman, mean } from "./metrics.mjs";

const exe = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const b = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"],
});
const p = await (await b.newContext()).newPage();
p.on("console", (m) => {
  if (/backend|DONE|FAILED/.test(m.text())) console.log(`  ${m.text()}`);
});
await p.goto("http://localhost:5173/scripts/riddle-bench/framing-v2.html", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.__FV2_DONE__ === true, null, { timeout: 120 * 60 * 1000 });
const d = await p.evaluate(() => window.__FV2__);
await b.close();
if (d.error) {
  console.error(d.error);
  process.exit(1);
}
fs.writeFileSync("framing-v2-scores.json", JSON.stringify(d, null, 2));
console.log(`\nbackend ${d.device}/${d.dtype}\n`);

function report(label, rows, bands) {
  const framings = [...new Set(rows.map((r) => r.framing))];
  console.log(`### ${label}\n`);
  console.log(
    `  ${"framing".padEnd(22)}${"order".padStart(7)}${"rho".padStart(7)}${"good".padStart(7)}${"parrot".padStart(8)}${"junk".padStart(7)}${"top".padStart(7)}   verdict`,
  );
  const out = [];
  for (const f of framings) {
    const rs = rows.filter((r) => r.framing === f);
    // ordering among genuine answers only
    const genuine = rs.filter((r) => !bands.parrot(r.tier) && !bands.junk(r.tier));
    const order = pairwiseAccuracy(genuine.map((r) => ({ tier: r.tier, score: r.score })));
    const rho = spearman(rs.map((r) => r.tier), rs.map((r) => r.score));
    const good = mean(rs.filter((r) => bands.good(r.tier)).map((r) => r.score));
    const par = rs.filter((r) => bands.parrot(r.tier)).map((r) => r.score);
    const jk = rs.filter((r) => bands.junk(r.tier)).map((r) => r.score);
    const top = Math.max(...rs.filter((r) => bands.good(r.tier)).map((r) => r.score));
    const parrotBad = par.length ? mean(par) > good : false;
    const junkBad = jk.length ? mean(jk) > good : false;
    const verdict = parrotBad
      ? "parroting outscores good answers"
      : junkBad
        ? "nonsense outscores good answers"
        : order >= 60
          ? "ranks AND keeps bad answers down"
          : "bad answers kept down, ranking weak";
    out.push({ f, order, rho, good, par: par.length ? mean(par) : NaN, jk: jk.length ? mean(jk) : NaN, top, verdict });
    console.log(
      `  ${f.padEnd(22)}${order.toFixed(0).padStart(6)}%${rho.toFixed(2).padStart(7)}${good.toFixed(0).padStart(7)}${(par.length ? mean(par).toFixed(0) : "n/a").padStart(8)}${(jk.length ? mean(jk).toFixed(0) : "n/a").padStart(7)}${top.toFixed(0).padStart(7)}   ${verdict}`,
    );
  }
  const clean = out.filter((o) => !(o.par > o.good) && !(o.jk > o.good)).sort((a, b) => b.order - a.order);
  console.log(
    `\n  best that keeps parroting AND nonsense below good answers: ${clean.length ? `${clean[0].f} (order ${clean[0].order.toFixed(0)}%, good ${clean[0].good.toFixed(0)}, parrot ${Number.isNaN(clean[0].par) ? "n/a" : clean[0].par.toFixed(0)})` : "NONE"}\n`,
  );
  return out;
}

report("MAIN RIDDLE", d.riddle, { good: (t) => t <= 4, parrot: (t) => t === 8, junk: (t) => t >= 9 });
report("BONUS", d.bonus, { good: (t) => t <= 3, parrot: (t) => t === 5, junk: (t) => t === 6 });

// the specific head-to-head jacob asked about
console.log("=== shipped vs 'does this make the riddle true' ===");
for (const f of ["shipped", "makesTrue", "makesTrueDecl", "makesTrueQualified"]) {
  const rs = d.riddle.filter((r) => r.framing === f);
  if (!rs.length) continue;
  const par = mean(rs.filter((r) => r.tier === 8).map((r) => r.score));
  const good = mean(rs.filter((r) => r.tier <= 4).map((r) => r.score));
  console.log(
    `  ${f.padEnd(22)} good ${good.toFixed(1).padStart(5)}  parroting ${par.toFixed(1).padStart(5)}  ${par > good ? `INVERTED by ${(par - good).toFixed(0)} points` : `correct order (+${(good - par).toFixed(0)})`}`,
  );
}
