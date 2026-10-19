/**
 * The sandbox: judge any riddle, any number of times, and see why each answer
 * scored what it did.
 *
 * Deliberately isolated from the game. It never imports api.js, so it cannot
 * create a session, cannot submit, and cannot touch a leaderboard - which is
 * what makes unlimited attempts safe. Results are kept in this browser only.
 *
 * It shows both model calls separately as well as the combined score, because
 * a single number does not say whether an answer scored badly for being a
 * poor answer or for restating the riddle, and that distinction is the whole
 * reason the second call exists.
 */
import "./style.css";
import {
  CHALLENGES,
  MAX_ANSWER,
  challengeForDay,
  combineNoul,
  formatScore,
  statementsForVersion,
  todayKey,
} from "@shared/challenges.js";
import { looksLikeOwnInterpretation, looksLikeRealText } from "@shared/gibberish.js";
import { canonicalizeForJudge } from "@shared/judge-canonicalize.js";
import { PHASE, UnsupportedDeviceError, judgeRuntime, loadJudge } from "./judge.js";
import { noul } from "open-jev";

const $ = (id) => document.getElementById(id);
const el = {
  backend: $("sandbox-backend"),
  preparing: $("preparing"),
  preparingText: $("preparing-text"),
  preparingBar: $("preparing-bar"),
  preparingNote: $("preparing-note"),
  body: $("sandbox-body"),
  riddleSelect: $("riddle-select"),
  customField: $("custom-field"),
  customRiddle: $("custom-riddle"),
  versionSelect: $("version-select"),
  q1: $("q1"),
  q2: $("q2"),
  play: $("sandbox-play"),
  answer: $("sandbox-answer"),
  counter: $("sandbox-counter"),
  error: $("sandbox-error"),
  submit: $("sandbox-submit"),
  resultsCard: $("results-card"),
  resultsNote: $("results-note"),
  rows: $("sandbox-rows"),
  clear: $("sandbox-clear"),
};

const STORE_KEY = "jgg.sandbox.results.v1";
const CUSTOM = "__custom__";
/** Longer than the game's 80, because testing often means trying the long
 * winding restatements that the game would reject anyway. */
const SANDBOX_MAX_ANSWER = 200;

let results = [];
try {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) results = JSON.parse(raw) ?? [];
} catch {
  results = [];
}
const save = () => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(results.slice(-300)));
  } catch {
    // Private browsing: results just will not survive a reload.
  }
};

// --- riddle picker -------------------------------------------------------
const today = challengeForDay(todayKey());
{
  const todayOpt = document.createElement("option");
  todayOpt.value = today.prompt;
  todayOpt.textContent = `Today — ${today.prompt}`;
  el.riddleSelect.append(todayOpt);
  for (const c of CHALLENGES) {
    if (c.prompt === today.prompt) continue;
    const o = document.createElement("option");
    o.value = c.prompt;
    o.textContent = c.prompt;
    el.riddleSelect.append(o);
  }
  const custom = document.createElement("option");
  custom.value = CUSTOM;
  custom.textContent = "Write my own riddle…";
  el.riddleSelect.append(custom);
}

function currentPrompt() {
  if (el.riddleSelect.value !== CUSTOM) return el.riddleSelect.value;
  return el.customRiddle.value.trim();
}

function currentStatements() {
  const prompt = currentPrompt();
  if (!prompt) return null;
  return statementsForVersion(Number(el.versionSelect.value), prompt);
}

function renderQuestions() {
  const s = currentStatements();
  el.q1.textContent = s ? `1. ${s.noulStatement}` : "1. (choose or write a riddle)";
  el.q2.textContent = s?.penaltyStatement
    ? `2. ${s.penaltyStatement}   — the score is question 1 scaled by (1 − question 2)^${s.penaltyExponent}`
    : "2. (none — v4 asks a single question)";
}

el.riddleSelect.addEventListener("change", () => {
  el.customField.hidden = el.riddleSelect.value !== CUSTOM;
  if (!el.customField.hidden) el.customRiddle.focus();
  renderQuestions();
  renderResults();
});
el.customRiddle.addEventListener("input", () => {
  renderQuestions();
  renderResults();
});
el.versionSelect.addEventListener("change", () => {
  renderQuestions();
  renderResults();
});

// --- answer input --------------------------------------------------------
el.answer.maxLength = SANDBOX_MAX_ANSWER;
function updateCounter() {
  const used = [...el.answer.value].length;
  el.counter.textContent = `${used} / ${SANDBOX_MAX_ANSWER}`;
  el.counter.classList.toggle("near", used > SANDBOX_MAX_ANSWER - 20);
}
el.answer.addEventListener("input", updateCounter);
el.answer.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    el.play.requestSubmit();
  }
});
const showError = (m) => {
  el.error.textContent = m ?? "";
  el.error.hidden = !m;
};

// --- results -------------------------------------------------------------
function renderResults() {
  const prompt = currentPrompt();
  const version = Number(el.versionSelect.value);
  const mine = results.filter((r) => r.prompt === prompt && r.version === version);
  el.resultsCard.hidden = mine.length === 0;
  el.resultsNote.textContent = mine.length
    ? `${mine.length} answer${mine.length === 1 ? "" : "s"} for this riddle on v${version}. The game's own limits (3 attempts, no duplicates, ${MAX_ANSWER} characters) are not applied here.`
    : "";
  el.rows.replaceChildren();
  for (const [i, r] of mine.sort((a, b) => b.score - a.score).entries()) {
    const li = document.createElement("li");
    li.className = "row";

    const rank = document.createElement("span");
    rank.className = "row-rank";
    rank.textContent = String(i + 1);

    const main = document.createElement("div");
    main.className = "row-main";
    const ans = document.createElement("div");
    ans.className = "row-name";
    ans.textContent = r.answer;
    main.append(ans);

    const detail = document.createElement("div");
    detail.className = "sandbox-detail";
    const parts = [`answer-quality ${formatScore(r.quality)}`];
    if (r.penalty != null) parts.push(`rewording ${formatScore(r.penalty)}`);
    if (r.gate) parts.push(r.gate);
    detail.textContent = parts.join(" · ");
    main.append(detail);

    const score = document.createElement("span");
    score.className = "row-score";
    score.textContent = formatScore(r.score);

    li.append(rank, main, score);
    el.rows.append(li);
  }
}

el.clear.addEventListener("click", () => {
  const prompt = currentPrompt();
  const version = Number(el.versionSelect.value);
  results = results.filter((r) => !(r.prompt === prompt && r.version === version));
  save();
  renderResults();
});

// --- scoring -------------------------------------------------------------
let busy = false;
el.play.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  showError(null);

  const prompt = currentPrompt();
  if (!prompt) return showError("Choose a riddle, or write one of your own.");
  const answer = el.answer.value.trim();
  if (!answer) return showError("Type an answer first.");

  const statements = currentStatements();
  busy = true;
  el.submit.disabled = true;
  el.submit.classList.add("busy");
  el.submit.querySelector(".submit-label").textContent = "Judging…";

  try {
    const jev = await loadJudge();
    if (jev.runtime?.device === "server-wasm") {
      throw new Error(
        "This device is using the server judge, which derives the riddle itself and cannot score a sandbox riddle.",
      );
    }
    const state = canonicalizeForJudge(answer);
    const [qv] = await jev.decide(state, [noul(statements.noulStatement)]);
    const quality = qv.probability * 100;
    let penalty = null;
    if (statements.penaltyStatement) {
      const [pv] = await jev.decide(state, [noul(statements.penaltyStatement)]);
      penalty = pv.probability * 100;
    }
    const combined = combineNoul(
      qv.probability,
      penalty == null ? 0 : penalty / 100,
      statements.penaltyExponent,
    );

    // What the real game's gates would have done with this answer, shown but
    // never enforced - the point of the sandbox is to see past them.
    const gates = [];
    if (!looksLikeRealText(answer)) gates.push("the game would reject: gibberish");
    else if (!looksLikeOwnInterpretation(answer, prompt)) gates.push("the game would reject: repeats the riddle");
    if ([...answer].length > MAX_ANSWER) gates.push(`too long for the game (${MAX_ANSWER} max)`);

    results.push({
      prompt,
      version: Number(el.versionSelect.value),
      answer,
      quality,
      penalty,
      score: combined * 100,
      gate: gates.join(" · ") || null,
      at: new Date().toISOString(),
    });
    save();
    renderResults();
    el.answer.value = "";
    updateCounter();
  } catch (err) {
    showError(err?.message || "Something went wrong scoring that.");
  } finally {
    busy = false;
    el.submit.disabled = false;
    el.submit.classList.remove("busy");
    el.submit.querySelector(".submit-label").textContent = "Score it";
  }
});

// --- boot ----------------------------------------------------------------
renderQuestions();
renderResults();
const bytes = (b) => (b ? `${Math.round(b / 1024 / 1024)} MB` : null);
try {
  await loadJudge({
    onPhase: ({ phase, progress, loaded, total }) => {
      if (phase === PHASE.DOWNLOADING) {
        const pct = Math.round((progress ?? 0) * 100);
        el.preparingBar.style.transform = `translateX(${pct - 100}%)`; // a transform: no relayout
        el.preparingBar.classList.remove("indeterminate");
        const note = bytes(loaded) && bytes(total) ? ` (${bytes(loaded)} / ${bytes(total)})` : "";
        el.preparingText.textContent = `Downloading judge… ${pct}%${note}`;
      } else if (phase === PHASE.INITIALIZING) {
        el.preparingBar.style.transform = "none";
        el.preparingBar.classList.add("indeterminate");
        el.preparingText.textContent = "Initializing judge…";
      }
    },
  });
  el.preparing.hidden = true;
  el.body.hidden = false;
  const rt = judgeRuntime();
  el.backend.textContent = rt ? `${rt.device}/${rt.dtype}` : "";
  el.answer.focus();
} catch (err) {
  console.error("[sandbox] judge failed to load:", err);
  el.preparing.querySelector(".spinner-ring").hidden = true;
  el.preparingBar.classList.remove("indeterminate");
  el.preparingText.textContent =
    err instanceof UnsupportedDeviceError
      ? "This device can't run the judge."
      : "The judge could not load.";
  el.preparingNote.textContent = err?.message ?? "Check your connection and refresh.";
}
