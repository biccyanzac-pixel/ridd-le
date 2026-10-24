/**
 * The local layer of the judge: what happens to an answer before any model
 * sees it. Pure, isomorphic, no network. The browser and the worker both run
 * it, so they agree on the cache key and on what counts as junk.
 *
 *   normalizeForJudge(text)  the cache key half: lowercase, trim, strip
 *                            punctuation, drop a leading article, singularise
 *                            simple plurals, collapse whitespace.
 *   junkReason(answer, prompt)  null, or why the answer is refused without
 *                            judging: empty, too long, or words copied from
 *                            the riddle with nothing of its own added.
 *
 * This is deliberately NOT shared/normalize.js (duplicate detection, keeps
 * wording) or shared/judge-canonicalize.js (the old in-browser judge's input).
 * The cache key has to merge spellings of the same answer aggressively, so
 * "The hedges" and "hedge" are judged once; those two are not allowed to.
 */

const ARTICLES = new Set(["a", "an", "the"]);
const MAX_WORDS = 6;

/** Singularise one lowercase word, simple English plurals only. Leaves
 * words that end in "ss", "us", "is" (glass, bus, crisis) alone, and
 * anything under four letters (gas, bus, yes, its). */
const SINGULAR_S = new Set([
  "news", "series", "species", "means", "chess", "lens", "physics", "politics", "economics", "mathematics",
  "ethics", "athletics", "clothes", "darkness", "kindness", "happiness", "sadness", "illness", "business",
  "progress", "success", "stress", "chaos", "bias", "canvas", "atlas", "alias", "always", "perhaps", "thus",
  "campus", "virus", "status", "focus", "bonus", "census", "surplus", "trellis", "tennis", "basis", "crisis",
  "analysis", "thesis", "oasis", "emphasis", "hypothesis", "axis", "iris", "pelvis", "diagnosis", "prognosis",
  "mess", "loss", "kiss", "glass", "grass", "class", "pass", "mass", "boss", "cross", "dress", "guess", "less",
  "miss", "process", "witness", "address", "princess", "goddess", "yes", "gas", "bus", "us", "is", "has", "its",
  "this", "was", "does", "goes",
]);

export function singularize(word) {
  if (word.length < 4) return word;
  if (SINGULAR_S.has(word)) return word;
  if (/(ss|us|is)$/.test(word)) return word;
  if (/ies$/.test(word) && word.length > 4) return word.slice(0, -3) + "y";
  if (/(ches|shes|xes|sses|zes)$/.test(word)) return word.slice(0, -2);
  if (/oes$/.test(word) && word.length > 4) return word.slice(0, -2);
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

/** The normalised text used as the cache key (with the riddle slug). */
export function normalizeForJudge(text) {
  let s = String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[‐-―−]/g, "-")
    // Hyphens join words; every other punctuation mark is dropped. An
    // apostrophe inside a word is dropped too ("don't" -> "dont"), so the
    // key never depends on whether the player typed it.
    .replace(/-/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  let words = s.split(" ").filter(Boolean);
  if (words.length > 1 && ARTICLES.has(words[0])) words = words.slice(1);
  words = words.map(singularize);
  return words.join(" ");
}

/** The cache key for a (riddle, answer) pair. */
export function judgeCacheKey(slug, answer) {
  return `${slug}:${normalizeForJudge(answer)}`;
}

// Words that carry no content for the "copied from the riddle" check.
const STOPWORDS = new Set(
  ("a an the you your can be what it is are was were without has have had i he she they we my its this that " +
    "at all of to for on by with from as and or but not no any some only just more most than then there here when " +
    "while which who whom whose does do did done being been very too also even still yet so if because about into " +
    "over under again once each both ever never always something anything nothing one thing things")
    .split(" "),
);

function stems(word) {
  const base = word.replace(/(ings|ing|edly|ed|ly|es|s)$/, "");
  return new Set([word, base, base.replace(/e$/, ""), singularize(word)].filter((f) => f.length > 1));
}

function contentWords(text) {
  return normalizeForJudge(text)
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w));
}

/**
 * Why an answer is refused before judging, or null if it should be judged.
 * These verdicts are "wrong" with a fixed hint and are never cached, so a
 * change to this filter takes effect at once.
 */
export function junkReason(answer, prompt) {
  const words = normalizeForJudge(answer).split(" ").filter(Boolean);
  if (words.length === 0) return { reason: "empty", hint: "Write an answer first." };
  if (words.length > MAX_WORDS) {
    return { reason: "too_long", hint: `Keep it to ${MAX_WORDS} words: name the thing, don't explain it.` };
  }
  if (!words.some((w) => /\p{L}/u.test(w))) {
    return { reason: "no_words", hint: "Write an actual answer, in words." };
  }
  const own = contentWords(answer);
  if (own.length === 0) {
    return { reason: "no_content", hint: "That doesn't name anything. What is the thing?" };
  }
  const riddle = new Set(contentWords(prompt).flatMap((w) => [...stems(w)]));
  const copied = own.every((w) => [...stems(w)].some((f) => riddle.has(f)));
  if (copied) {
    return { reason: "parrot", hint: "That's the riddle's own words. Name a thing that fits them." };
  }
  return null;
}

export { MAX_WORDS as JUDGE_MAX_WORDS };
