/**
 * Feasibility probe for using kev-4b as a reference judge.
 *
 * open-jev ships kev-4b alongside the kev-0.6b the game runs - roughly 6.7x
 * the parameters. Two things that would be worth having:
 *
 *   - if the big model agrees with the hand-assigned tiers much better than
 *     the small one, it can label answers in bulk, which is the way out of
 *     every "58 invented cases is too small" caveat in this whole exercise
 *   - the correlation between the two tells us WHY the small model is weak:
 *     if the big model handles the same question well, the framing is fine
 *     and 0.6b is simply too small for it; if the big model fails too, the
 *     question itself is wrong
 *
 * This only measures download size, load time and per-call latency first,
 * because a 4B model on a CPU may be far too slow to be useful and that
 * should be known before committing to a long run.
 *
 *   node scripts/riddle-bench/big-model-probe.mjs
 */
import { OpenJev, noul } from "open-jev";

const fmt = (b) => (b ? `${(b / 1024 / 1024).toFixed(0)} MB` : "unknown");

console.log("--- what kev-4b would cost to use ---");
try {
  const info = await OpenJev.info({ model: "kev-4b", dtype: "q4" });
  console.log(`download: ${fmt(info.downloadBytes)}   cached already: ${info.isCached === true}`);
} catch (err) {
  console.log(`info() failed: ${err.message}`);
}

console.log("\nloading kev-4b (this is the slow part)…");
const t0 = Date.now();
let jev;
try {
  jev = await OpenJev.load({
    model: "kev-4b",
    dtype: "q4",
    onProgress: ({ progress }) => {
      if (typeof progress === "number") {
        const pct = Math.round(progress * 100);
        if (pct % 20 === 0) process.stdout.write(`  ${pct}%\r`);
      }
    },
  });
} catch (err) {
  console.error(`\nFAILED to load kev-4b: ${err.name}: ${err.message}`);
  console.error("If this is memory or an unsupported op, the big-model reference is not available here.");
  process.exit(1);
}
console.log(`\nloaded in ${((Date.now() - t0) / 1000).toFixed(0)}s on ${jev.runtime.device}/${jev.runtime.dtype}`);

// A handful of answers with obvious expected ordering, to check it is
// behaving sensibly at all before spending an hour on a full run.
const RIDDLE = "What can you enter without going in?";
const STATEMENT = `Is the answer a plausible interpretation of the riddle "${RIDDLE}" that resolves its apparent contradiction?`;
const PLAIN = `Does this answer make the riddle "${RIDDLE}" true?`;
const CASES = [
  ["a competition", "should be high"],
  ["a password", "should be high"],
  ["you enter it without going in", "PARROT - should be low"],
  ["purple elephant toaster", "nonsense - should be low"],
  ["a sandwich", "irrelevant - should be low"],
];

for (const [label, statement] of [["shipped framing", STATEMENT], ["plain 'make it true'", PLAIN]]) {
  console.log(`\n--- ${label} ---`);
  for (const [answer, note] of CASES) {
    const t = Date.now();
    const [v] = await jev.decide(answer, [noul(statement)]);
    console.log(
      `  ${(v.probability * 100).toFixed(1).padStart(5)}  ${((Date.now() - t) / 1000).toFixed(1)}s  "${answer}"  (${note})`,
    );
  }
}

console.log(
  `\nIf each call is only a second or two, a full reference run over ~120 answers is practical.`,
);
await jev.dispose?.();
