import "./style.css";
import {
  LAUNCH_DAY,
  MAX_ANSWER,
  MAX_ATTEMPTS,
  averageScore,
  bonusChallengeForDay,
  challengeForDay,
  formatScore,
  msUntilNextDay,
  previousDayKey,
  serverJudged,
  statementsForVersion,
  todayKey,
  validateAnswer,
  validateName,
} from "@shared/challenges.js";
import { answerHash, normalizeAnswer } from "@shared/normalize.js";
import { looksLikeRealText } from "@shared/gibberish.js";
import { PHASE, UnsupportedDeviceError, judgeInfo, judgeRuntime, loadJudge, scoreAnswer } from "./judge.js";
import { fetchAttempts, fetchLeaderboard, flagVerdict, leaderboardEnabled, loadConfig, submit } from "./api.js";
import {
  addLocalAttempt,
  addToLocalBoard,
  localAttempts,
  localBoard,
  rememberName,
  savedName,
  setLocalAttempts,
} from "./store.js";

const $ = (id) => document.getElementById(id);
const el = {
  daynum: $("daynum"),
  countdown: $("countdown"),
  prompt: $("prompt"),
  attemptsNote: $("attempts-note"),
  bonusTeaser: $("bonus-teaser"),
  playBonusButton: $("play-bonus-button"),
  nameField: $("name-field"),
  playingAs: $("playing-as"),
  preparing: $("preparing"),
  preparingText: $("preparing-text"),
  preparingBar: $("preparing-bar"),
  preparingNote: $("preparing-note"),
  play: $("play"),
  name: $("name"),
  answer: $("answer"),
  counter: $("counter"),
  error: $("error"),
  submit: $("submit"),
  attemptNumber: $("attempt-number"),
  attempts: $("attempts"),
  dailyScore: $("daily-score"),
  dailyScoreCaption: $("daily-score-caption"),
  attemptList: $("attempt-list"),
  attemptsDone: $("attempts-done"),
  board: $("board"),
  rows: $("rows"),
  players: $("players"),
  boardEmpty: $("board-empty"),
  boardLocked: $("board-locked"),
  boardNote: $("board-note"),
  yesterday: $("yesterday"),
  yesterdayPrompt: $("yesterday-prompt"),
  yesterdayRows: $("yesterday-rows"),
  yesterdayEmpty: $("yesterday-empty"),
  yesterdayBonus: $("yesterday-bonus"),
  yesterdayBonusPrompt: $("yesterday-bonus-prompt"),
  yesterdayBonusRows: $("yesterday-bonus-rows"),
  yesterdayBonusEmpty: $("yesterday-bonus-empty"),
  yesterdayBonusBest: $("yesterday-bonus-best"),
  yesterdayBonusBestName: $("yesterday-bonus-best-name"),
  yesterdayBonusBestAvg: $("yesterday-bonus-best-avg"),
  yesterdayBonusBestRows: $("yesterday-bonus-best-rows"),
  yesterdayBest: $("yesterday-best"),
  yesterdayBestName: $("yesterday-best-name"),
  yesterdayBestAvg: $("yesterday-best-avg"),
  yesterdayBestRows: $("yesterday-best-rows"),
  musicToggle: $("music-toggle"),
  music: $("music"),
  musicHint: $("music-hint"),
  archive: $("archive"),
  archiveBrowse: $("archive-browse"),
  archiveList: $("archive-list"),
  archiveChallenge: $("archive-challenge"),
  archiveDaynum: $("archive-daynum"),
  archivePrompt: $("archive-prompt"),
  archivePlay: $("archive-play"),
  archiveName: $("archive-name"),
  archiveAnswer: $("archive-answer"),
  archiveCounter: $("archive-counter"),
  archiveError: $("archive-error"),
  archiveSubmit: $("archive-submit"),
  archiveAttemptNumber: $("archive-attempt-number"),
  archiveAttempts: $("archive-attempts"),
  archiveDailyScore: $("archive-daily-score"),
  archiveAttemptList: $("archive-attempt-list"),
  archiveAttemptsDone: $("archive-attempts-done"),
  archiveRealRows: $("archive-real-rows"),
  archiveRealEmpty: $("archive-real-empty"),
  archiveLateRows: $("archive-late-rows"),
  archiveLateEmpty: $("archive-late-empty"),
  bonus: $("bonus"),
  bonusLocked: $("bonus-locked"),
  bonusUnlocked: $("bonus-unlocked"),
  bonusPrompt: $("bonus-prompt"),
  bonusPlay: $("bonus-play"),
  bonusName: $("bonus-name"),
  bonusNameField: $("bonus-name-field"),
  bonusPlayingAs: $("bonus-playing-as"),
  bonusAnswer: $("bonus-answer"),
  bonusCounter: $("bonus-counter"),
  bonusError: $("bonus-error"),
  bonusSubmit: $("bonus-submit"),
  bonusSubmitLabel: $("bonus-submit-label"),
  bonusAttempts: $("bonus-attempts"),
  bonusScore: $("bonus-score"),
  bonusScoreCaption: $("bonus-score-caption"),
  bonusAttemptList: $("bonus-attempt-list"),
  bonusAttemptsDone: $("bonus-attempts-done"),
  bonusRows: $("bonus-rows"),
  bonusBoardEmpty: $("bonus-board-empty"),
};

// --- optional background music ----------------------------------------------
//
// Off by default - never autoplays (browsers block that anyway, but this is
// also just the right default for a page visitor didn't ask for audio on).
// Mozart's Lacrimosa, 1956 Bruno Walter/Wiener Philharmoniker recording -
// public domain in the EU (performer/producer rights expired after 70
// years). See index.html's title attribute on the toggle for attribution.
{
  const MUSIC_PREF_KEY = "jgg_music_on";
  el.music.volume = 0.35;
  if (localStorage.getItem(MUSIC_PREF_KEY) === "1") {
    // Browsers will block this until a real user gesture happens anyway;
    // this just means music resumes on the first click/tap/keypress
    // instead of needing a second explicit toggle.
    const resume = () => {
      el.music.play().catch(() => {});
      document.removeEventListener("pointerdown", resume);
      document.removeEventListener("keydown", resume);
    };
    document.addEventListener("pointerdown", resume, { once: true });
    document.addEventListener("keydown", resume, { once: true });
    el.musicToggle.setAttribute("aria-pressed", "true");
  }

  // A quiet nudge toward the music toggle, not a permanent decoration: shown
  // briefly, then hidden, with one single repeat later in case the first
  // flash was missed - but never at all once the player has clicked the
  // toggle even once (play OR pause; the point is "they now know it's
  // there", not "they left it on"). That's a separate, permanent flag from
  // MUSIC_PREF_KEY, which only tracks the on/off choice.
  const MUSIC_HINT_SEEN_KEY = "jgg_music_hint_seen";
  const hasSeenMusicHint = () => {
    try {
      return localStorage.getItem(MUSIC_HINT_SEEN_KEY) === "1";
    } catch {
      return false;
    }
  };
  const markMusicHintSeen = () => {
    try {
      localStorage.setItem(MUSIC_HINT_SEEN_KEY, "1");
    } catch {
      // Private browsing: it'll just show again next load, harmless.
    }
  };
  let hintHideTimer = null;
  function flashMusicHint() {
    if (hasSeenMusicHint()) return;
    el.musicHint.hidden = false;
    void el.musicHint.offsetWidth; // commit the hidden state first, or the fade-in is skipped
    el.musicHint.classList.add("visible");
    clearTimeout(hintHideTimer);
    hintHideTimer = setTimeout(fadeOutMusicHint, 6000);
  }
  // Hidden once its CSS fade has actually finished (transitionend), so the
  // stylesheet's duration is the only one; the timeout only covers a
  // transition that never runs (display changes, a background tab).
  function fadeOutMusicHint() {
    const hint = el.musicHint;
    hint.classList.remove("visible");
    let fallback = 0;
    const finish = (event) => {
      if (event && (event.target !== hint || event.propertyName !== "opacity")) return;
      hint.removeEventListener("transitionend", finish);
      clearTimeout(fallback);
      if (!hint.classList.contains("visible")) hint.hidden = true;
    };
    hint.addEventListener("transitionend", finish);
    fallback = setTimeout(finish, 600);
  }
  if (!hasSeenMusicHint()) {
    flashMusicHint();
    setTimeout(flashMusicHint, 45_000); // one brief reminder, then stops for this load
  }

  el.musicToggle.addEventListener("click", () => {
    markMusicHintSeen();
    clearTimeout(hintHideTimer);
    el.musicHint.classList.remove("visible");
    el.musicHint.hidden = true;

    if (el.music.paused) {
      el.music.play().catch(() => {});
      el.musicToggle.setAttribute("aria-pressed", "true");
      localStorage.setItem(MUSIC_PREF_KEY, "1");
    } else {
      el.music.pause();
      el.musicToggle.setAttribute("aria-pressed", "false");
      localStorage.setItem(MUSIC_PREF_KEY, "0");
    }
  });
}

const challenge = challengeForDay(todayKey());

// Local development only: VITE_SCORING_VERSION tries a scoring version before
// its date arrives, so a change can be played against today's riddle instead
// of waiting for midnight UTC. It swaps only the QUESTIONS - the challenge id
// and the version in the answer hash still come from the day, so the worker
// accepts the submission exactly as it would any other. Unset in a real
// build, which is why production can never take this path.
{
  const forced = Number(import.meta.env?.VITE_SCORING_VERSION);
  if (forced >= 6 && forced !== challenge.scoringVersion) {
    // v6 is judged by the worker, so there are no questions to swap in; the
    // whole challenge moves to v6 instead, to line up with a local worker
    // started with `--var SCORING_V6_FROM:<day>` (see worker/test/judge.e2e.mjs).
    challenge.scoringVersion = forced;
    challenge.id = `${challenge.slug}@v${forced}:${challenge.dayKey}`;
    challenge.noulStatement = null;
    challenge.penaltyStatement = null;
    console.warn(`[dev] playing today as scoring v${forced} against a local worker with the same override.`);
  } else if (forced && forced !== challenge.scoringVersion) {
    const s = statementsForVersion(forced, challenge.prompt);
    challenge.noulStatement = s.noulStatement;
    challenge.penaltyStatement = s.penaltyStatement;
    challenge.penaltyExponent = s.penaltyExponent;
    console.warn(
      `[dev] scoring with v${forced} questions (${s.penaltyStatement ? 2 : 1} model call(s)); ` +
        `the board is still v${challenge.scoringVersion}, so scores here are not comparable with production.`,
    );
  }
}

// The player's attempts at today's riddle, authoritative copy once a backend
// is configured (reconciled from the server on load and after every submit),
// otherwise the local-only record.
let attempts = [];

// From scoring v6 the worker judges every answer (see shared/clues.js and
// worker/src/judge.js): the browser loads no model, and an attempt comes back
// as correct / close / wrong with a hint, or as pending while judging is
// paused. Everything below branches on this once, never on the date.
const SERVER_JUDGED = serverJudged(challenge.scoringVersion);

/** The score text for an attempt: the number, or "Judging paused" while it waits. */
function verdictText(attempt) {
  if (attempt?.verdict === "pending" || attempt?.pending) return "Judging paused";
  return formatScore(attempt.score);
}

function verdictClass(attempt) {
  if (attempt?.verdict === "pending" || attempt?.pending) return "pending";
  return scoreClass(attempt.score);
}

function anyPending(list) {
  return (list ?? []).some((a) => a?.pending || a?.verdict === "pending");
}

// --- small helpers ---------------------------------------------------------

function showError(message) {
  el.error.textContent = message ?? "";
  el.error.hidden = !message;
}

// --- motion (docs/motion-system.md in the jacob.gg hub) ----------------------
// The kit loads with `defer` and may fail, so every JGG.motion call has a plain
// fallback with the same end state and no animation.

function reducedMotion() {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Show `node`. With `animate`, and only if it was hidden, it plays the kit's
 * entrance (`kind: "reveal"` for results); otherwise it simply appears. */
function showEl(node, animate = false, kind) {
  const m = window.JGG?.motion;
  if (animate && node.hidden && m) m.enter(node, kind ? { kind } : undefined);
  else node.hidden = false;
}

/** Put a score on screen. With `from`, it counts up (tap or key to skip, never
 * awaited); without, the final value shows at once and any count-up still
 * running on that element is finished first. */
function setScore(node, value, from) {
  const m = window.JGG?.motion;
  if (m?.settle) m.settle(node, value, { from: from ?? value, format: formatScore });
  else node.textContent = formatScore(value);
}

/** A user-chosen name as a node: isolated direction (Arabic/Hebrew names don't
 * reorder the text around them) and the full name on hover when it truncates. */
function nameNode(name, tag = "bdi") {
  const n = document.createElement(tag);
  n.textContent = name;
  n.title = name;
  return n;
}

/** Leaderboard scores: a missing one reads "—", not "NaN". */
function boardScore(score) {
  return Number.isFinite(score) ? formatScore(score) : "—";
}

function pad(n) {
  return String(n).padStart(2, "0");
}

// Display only - every dayKey used for ids, comparisons, and <input
// type="date"> stays ISO (YYYY-MM-DD) throughout; this only changes what a
// human reads on screen.
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function formatDayKey(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

let resetsAt = Date.now() + msUntilNextDay();
function tickCountdown() {
  const remaining = resetsAt - Date.now();
  if (remaining <= 0) {
    el.countdown.textContent = "new riddle ready — refresh";
    return;
  }
  const total = Math.floor(remaining / 1000);
  el.countdown.textContent = `next in ${pad(Math.floor(total / 3600))}:${pad(
    Math.floor((total % 3600) / 60),
  )}:${pad(total % 60)}`;
}
setInterval(tickCountdown, 1000);

function hasCompletedToday() {
  return attempts.length >= MAX_ATTEMPTS;
}

// The single highest-scoring individual attempt's text - shown as the
// representative answer on the local-only fallback board, matching how the
// worker picks a representative answer for the shared leaderboard.
function bestAnswerOf(list) {
  return list.reduce((best, a) => (a.score > best.score ? a : best), list[0]).answer;
}

/**
 * Has this player already used this answer (ignoring case/spacing) for this
 * round? The worker enforces this too and is the real authority - but it only
 * gets the chance when the submission actually reaches it, and an attempt
 * that falls back to device-only storage (offline, or a backend that can't be
 * reached) would otherwise accept the same answer twice. Checked before the
 * judge runs, so a duplicate also doesn't waste a scoring pass.
 */
function isDuplicateAnswer(list, answer) {
  const normalized = normalizeAnswer(answer);
  return list.some((a) => normalizeAnswer(a.answer) === normalized);
}

// --- rendering: challenge ----------------------------------------------

function renderChallenge() {
  el.daynum.textContent = `Daily #${challenge.dayNumber}`;
  el.prompt.textContent = challenge.prompt;
  el.answer.maxLength = MAX_ANSWER;
  el.answer.placeholder = challenge.example ? `e.g. ${challenge.example}` : "e.g. your interpretation";
  tickCountdown();
}

// --- rendering: attempts -------------------------------------------------

function scoreClass(score) {
  if (score >= 70) return "good";
  if (score < 35) return "bad";
  return "";
}

// Two-line row: "Attempt N — score" then the player's own answer text below
// it, so they can see whether a reinterpretation actually improved things.
function attemptRow(attempt) {
  const li = document.createElement("li");
  li.className = "attempt-row";

  const head = document.createElement("div");
  head.className = "attempt-head";
  const label = document.createElement("span");
  label.className = "attempt-label";
  label.textContent = `Attempt ${attempt.attemptNumber}`;
  const score = document.createElement("span");
  score.className = `attempt-score ${verdictClass(attempt)}`;
  score.textContent = verdictText(attempt);
  head.append(label, score);

  const answer = document.createElement("blockquote");
  answer.className = "attempt-answer";
  answer.textContent = attempt.answer;

  li.append(head, answer);

  if (attempt.verdict === "pending") {
    const note = document.createElement("p");
    note.className = "attempt-hint";
    note.textContent = "Saved. The judge is taking a break; your result will appear on your next visit.";
    li.append(note);
  } else if (attempt.hint && attempt.score < 70) {
    const hint = document.createElement("p");
    hint.className = "attempt-hint";
    hint.textContent = attempt.hint;
    li.append(hint);
  }

  if (attempt.verdict && attempt.verdict !== "pending" && attempt.cacheKey && leaderboardEnabled()) {
    const flag = document.createElement("button");
    flag.type = "button";
    flag.className = "attempt-flag";
    flag.textContent = "Unfair score?";
    flag.addEventListener("click", async () => {
      flag.disabled = true;
      try {
        await flagVerdict(attempt.cacheKey);
        flag.textContent = "Flagged, thanks";
      } catch {
        flag.textContent = "Couldn't flag";
      }
    });
    li.append(flag);
  }
  return li;
}

/** The name is asked for once (or reused from another jacob.gg game) and shown
 * as "Playing as … · change". After the first attempt it is settled for the
 * day: a player's name is already fixed on every row they've submitted, so
 * the "change" link goes away. */
let changingName = false;
function renderNameField() {
  const chosen = savedName();
  const settled = attempts.length > 0;
  if (!chosen || (changingName && !settled)) {
    el.nameField.hidden = false;
    el.playingAs.hidden = true;
    return;
  }
  el.nameField.hidden = true;
  el.name.value = chosen;
  el.playingAs.hidden = false;
  el.playingAs.replaceChildren("Playing as ", nameNode(chosen));
  if (!settled) {
    const change = document.createElement("button");
    change.type = "button";
    change.className = "jgg-change";
    change.textContent = "change";
    change.addEventListener("click", () => {
      changingName = true;
      renderNameField();
      el.name.focus();
      el.name.select();
    });
    el.playingAs.append(" · ", change);
  }
}

/** The inline nudge next to the riddle, alongside (not instead of) the
 * always-visible locked bonus panel further down the page. */
function updateBonusTeaser() {
  el.bonusTeaser.hidden = SERVER_JUDGED || !leaderboardEnabled() || hasCompletedToday();
}

// What the attempts panel last showed, so a newly landed attempt can animate
// from there. Null until the first render.
let shownAttempts = null;
let shownDaily = 0;

/** Render the attempts panel and the running/final daily average.
 * `landed: true` only right after this player's new attempt was accepted: then
 * (and only then) the newest row reveals, the score counts up from the old
 * average, and finishing swaps the form for the done panel. Every other render
 * (load, restore, a refetch) shows the final state at once. */
function renderAttempts({ landed = false } = {}) {
  const attemptsTop = el.attempts.getBoundingClientRect().top; // before anything above it changes (FLIP below)
  updateBonusTeaser();
  renderNameField();
  const fresh = landed && shownAttempts !== null && attempts.length > shownAttempts;
  const fromDaily = shownAttempts ? shownDaily : 0;
  shownAttempts = attempts.length;
  if (attempts.length === 0) {
    el.attempts.hidden = true;
    shownDaily = 0;
    return;
  }

  el.preparing.hidden = true;
  showEl(el.attempts, fresh);

  // Pending attempts (judging paused) join the average once scored, as on the server.
  const daily = averageScore(attempts.filter((a) => !a.pending)) ?? 0;
  shownDaily = daily;
  setScore(el.dailyScore, daily, fresh ? fromDaily : undefined);
  el.dailyScore.className = `score ${scoreClass(daily)}`;
  el.dailyScoreCaption.textContent = hasCompletedToday()
    ? "Daily score — average of all 3 attempts"
    : `Daily score so far — average of ${attempts.length} of ${MAX_ATTEMPTS}`;
  if (anyPending(attempts)) {
    el.dailyScoreCaption.textContent += " · judging paused, one attempt still to be scored";
  }

  // The list is rebuilt, so only the newest row is marked to reveal.
  const rows = attempts.map(attemptRow);
  el.attemptList.replaceChildren(...rows);
  if (fresh && attempts.length > 1) { // the first attempt arrives with the panel's own entrance
    const newest = rows[rows.length - 1];
    newest.hidden = true;
    showEl(newest, true, "reveal");
  }

  const done = hasCompletedToday();
  const rate = $("rate");
  if (done) window.JGG?.rate({ game: "ridd-le", day: challenge.dayKey, mount: rate });
  if (done && fresh && !el.play.hidden && window.JGG?.motion) {
    // Finishing: the form gives way to the done panel (one 220 ms swap), and the attempts panel glides up into
    // the form's place (FLIP, 220 ms) instead of jumping under the counting score.
    window.JGG.motion.swap(el.play, el.attemptsDone);
    const dy = attemptsTop - el.attempts.getBoundingClientRect().top;
    if (dy && !window.JGG.motion.reduced()) {
      el.attempts.animate?.([{ transform: `translateY(${dy}px)` }, { transform: "none" }],
        { duration: 220, easing: "cubic-bezier(0.23, 1, 0.32, 1)", composite: "add" });
    }
  } else {
    el.play.hidden = done;
    el.attemptsDone.hidden = !done;
  }
  if (done) showEl(rate, fresh);
  else rate.hidden = true;
  if (!done) el.attemptNumber.textContent = String(attempts.length + 1);
  updatePlayBonusButton(fresh);
}

/** The shortcut down to the bonus round, which only makes sense while there
 * is still a guess left to make: shown once today's riddle is finished, gone
 * again once all 3 bonus guesses are used. */
function updatePlayBonusButton(animate = false) {
  const show = !SERVER_JUDGED && hasCompletedToday() && leaderboardEnabled() && !hasCompletedBonus();
  if (show) showEl(el.playBonusButton, animate);
  else el.playBonusButton.hidden = true;
}

// --- rendering: today's leaderboard ----------------------------------------
//
// Full attempt data (every attempt's answer AND individual score) for today's
// board only ever arrives from the server once this player has completed all
// 3 of their own attempts - see api.js/worker: the worker itself sends
// `attempts: null` for every other row until the requesting player's own
// attempt count reaches MAX_ATTEMPTS, so there is nothing to redact here
// client-side and no attempt data to accidentally render even by mistake.
// `entry.score` is always the player's average (the ranking score) and is
// shown regardless of redaction.

function todayRowNode(entry, rank) {
  const li = document.createElement("li");
  li.className = entry.you ? "row me" : "row";

  const rankEl = document.createElement("span");
  rankEl.className = "row-rank";
  rankEl.textContent = String(entry.rank ?? rank);

  const main = document.createElement("div");
  main.className = "row-main";
  // The name truncates on its own; "(you)" sits outside it so it is never cut.
  const name = document.createElement("div");
  name.className = "row-name";
  const nameText = nameNode(entry.name || "Someone", "span");
  nameText.className = "row-name-text";
  nameText.dir = "auto";
  name.append(nameText);
  if (entry.you) {
    const you = document.createElement("span");
    you.className = "row-you";
    you.textContent = "(you)";
    name.append(you);
  }
  main.append(name);

  if (Array.isArray(entry.attempts)) {
    const list = document.createElement("ol");
    list.className = "row-attempts";
    for (const attempt of entry.attempts) {
      const item = document.createElement("li");
      item.className = "row-attempt";
      const label = document.createElement("span");
      label.className = "row-attempt-label";
      label.textContent = `${attempt.attemptNumber}.`;
      const answer = document.createElement("span");
      answer.className = "row-attempt-answer";
      answer.dir = "auto";
      answer.textContent = attempt.answer;
      answer.title = attempt.answer ?? "";
      const score = document.createElement("span");
      score.className = "row-attempt-score";
      score.textContent = attempt.pending ? verdictText(attempt) : boardScore(attempt.score);
      item.append(label, answer, score);
      list.append(item);
    }
    main.append(list);
  }

  const score = document.createElement("span");
  score.className = "row-score";
  score.textContent = boardScore(entry.score);

  li.append(rankEl, main, score);
  return li;
}

function renderBoard(board, note) {
  el.board.hidden = false;
  el.rows.replaceChildren();
  const rows = board?.top ?? [];
  const players = board?.players ?? rows.length;
  el.players.textContent = players === 1 ? "1 player" : `${players.toLocaleString("en")} players`;
  el.boardEmpty.hidden = rows.length > 0;
  el.boardLocked.hidden = hasCompletedToday() || !leaderboardEnabled();
  rows.forEach((entry, index) => el.rows.append(todayRowNode(entry, index + 1)));
  if (board?.you) {
    const gap = document.createElement("li");
    gap.className = "row-gap";
    gap.textContent = "···";
    el.rows.append(gap, todayRowNode(board.you, board.you.rank));
  }
  el.boardNote.textContent = note ?? "";
  el.boardNote.hidden = !note;
}

function renderLocalBoard() {
  const rows = localBoard(challenge.id).map((row, index) => ({ ...row, rank: index + 1 }));
  renderBoard(
    { players: rows.length, top: rows.slice(0, 10), you: null },
    "Showing only this device — the shared leaderboard is not switched on yet.",
  );
}

async function refreshBoard() {
  if (!leaderboardEnabled()) return renderLocalBoard();
  try {
    const board = await fetchLeaderboard(challenge.id);
    renderBoard(board);
  } catch {
    renderLocalBoard();
  }
}

// Live updates: everyone already on the page sees new scores without
// reloading. 7s sits inside the "5-10s polling is fine" range; paused while
// the tab is hidden, with an immediate refresh when it becomes visible again.
let pollTimer = null;
function startPolling() {
  if (!leaderboardEnabled() || pollTimer) return;
  pollTimer = setInterval(() => {
    if (document.hidden) return;
    refreshBoard();
    if (anyPending(attempts)) refreshPendingAttempts();
  }, 7000);
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshBoard();
});

/** While an attempt is pending, pick up its verdict as soon as the cron has
 * scored it, so the player sees it without reloading. */
async function refreshPendingAttempts() {
  try {
    const server = await fetchAttempts(challenge.id);
    if (!Array.isArray(server?.attempts)) return;
    const before = anyPending(attempts);
    attempts = server.attempts;
    setLocalAttempts(challenge.id, attempts);
    if (before && !anyPending(attempts)) renderAttempts({ landed: true });
    else renderAttempts();
  } catch {
    // Try again on the next tick.
  }
}

// --- rendering: yesterday's strongest interpretations -----------------------
//
// Reuses the same leaderboard endpoint against yesterday's challenge id - no
// new route. Past-day answers are never redacted (see worker), so this always
// shows real text once there is a previous day to show. Deliberately no
// names and no rank numbers in the top-3 list: this is "discovery", not a
// leaderboard. The board entry's answer text lives at entry.attempts[n].answer,
// not a flat entry.answer - there is no flat field.

function buildAnswerRow(score, answerText) {
  const li = document.createElement("li");
  li.className = "yesterday-row";
  const scoreEl = document.createElement("span");
  scoreEl.className = "yesterday-score";
  scoreEl.textContent = boardScore(score);
  const answerEl = document.createElement("span");
  answerEl.className = "yesterday-answer";
  answerEl.dir = "auto";
  answerEl.textContent = answerText;
  li.append(scoreEl, answerEl);
  return li;
}

/** The 3 best individual answers on a board, flattened across every player's
 * attempts (not just each player's best) - this is about the strongest
 * interpretations, not the strongest players. */
function topAnswers(rows, count = 3) {
  const all = rows.flatMap((entry) => (entry.attempts ?? []).filter((a) => a?.answer != null));
  all.sort((a, b) => b.score - a.score);
  return all.slice(0, count);
}

/** The top-ranked player plus their own attempts - the "best average" block.
 * Shared by yesterday's riddle and yesterday's bonus round, which present it
 * identically. */
function renderBestAverage(rows, { container, nameEl, avgEl, rowsEl }) {
  const best = rows[0];
  rowsEl.replaceChildren();
  if (!best?.attempts?.length) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  nameEl.textContent = best.name || "Someone";
  nameEl.title = nameEl.textContent;
  avgEl.textContent = boardScore(best.score);
  for (const attempt of best.attempts) {
    rowsEl.append(buildAnswerRow(attempt.score, attempt.answer));
  }
}

async function renderYesterday() {
  if (!leaderboardEnabled()) {
    el.yesterday.hidden = true;
    return;
  }

  const yesterdayKey = previousDayKey(challenge.dayKey);
  const yesterdayChallenge = challengeForDay(yesterdayKey);
  const yesterdayBonus = bonusChallengeForDay(yesterdayKey);

  // Deliberately NOT hidden on failure: a silently vanishing section is how a
  // broken backend went unnoticed before. An empty state is honest; a missing
  // section looks like the feature was never there.
  el.yesterday.hidden = false;
  el.yesterdayPrompt.textContent = `${formatDayKey(yesterdayKey)} — “${yesterdayChallenge.prompt}”`;

  let rows = [];
  try {
    const board = await fetchLeaderboard(yesterdayChallenge.id);
    rows = board?.top ?? [];
  } catch {
    rows = [];
  }

  el.yesterdayRows.replaceChildren();
  el.yesterdayEmpty.hidden = rows.length > 0;
  for (const attempt of topAnswers(rows)) {
    el.yesterdayRows.append(buildAnswerRow(attempt.score, attempt.answer));
  }

  // The single best-average player and their own 3 attempts.
  renderBestAverage(rows, {
    container: el.yesterdayBest,
    nameEl: el.yesterdayBestName,
    avgEl: el.yesterdayBestAvg,
    rowsEl: el.yesterdayBestRows,
  });

  // Yesterday's bonus round. Its word is no longer a secret once the day is
  // over, so it's named here - that's the whole point of showing it.
  let bonusRows = [];
  try {
    const board = await fetchLeaderboard(yesterdayBonus.id);
    bonusRows = board?.top ?? [];
  } catch {
    bonusRows = [];
  }
  // Hidden entirely when nobody played it, rather than showing an empty
  // panel for a round that may not have existed yet on that day.
  if (bonusRows.length === 0) {
    el.yesterdayBonus.hidden = true;
    return;
  }
  el.yesterdayBonus.hidden = false;
  el.yesterdayBonusEmpty.hidden = true;
  el.yesterdayBonusPrompt.textContent = `“${yesterdayBonus.prompt}”`;
  el.yesterdayBonusRows.replaceChildren();
  for (const attempt of topAnswers(bonusRows)) {
    el.yesterdayBonusRows.append(buildAnswerRow(attempt.score, attempt.answer));
  }
  renderBestAverage(bonusRows, {
    container: el.yesterdayBonusBest,
    nameEl: el.yesterdayBonusBestName,
    avgEl: el.yesterdayBonusBestAvg,
    rowsEl: el.yesterdayBonusBestRows,
  });
}

// --- archive: replaying a past day's riddle --------------------------------
//
// Archive play never touches the day's real leaderboard - the worker tags
// every archive submission is_late=1 and serves it back only from a
// separate, clearly-labeled "late leaderboard" (see fetchLeaderboard's
// `late` option and worker/src/index.js's fetchBoard). Requires the shared
// leaderboard backend; with no backend there is nothing durable to replay
// against, so the whole section stays hidden.

let archiveChallenge = null;
let archiveAttemptsList = [];

function hasCompletedArchive() {
  return archiveAttemptsList.length >= MAX_ATTEMPTS;
}

function renderArchiveAttempts() {
  if (archiveAttemptsList.length === 0) {
    el.archiveAttempts.hidden = true;
    el.archivePlay.hidden = false;
    el.archiveAttemptNumber.textContent = "1";
    return;
  }
  el.archiveAttempts.hidden = false;
  const daily = averageScore(archiveAttemptsList);
  el.archiveDailyScore.textContent = formatScore(daily);
  el.archiveDailyScore.className = `score ${scoreClass(daily)}`;
  el.archiveAttemptList.replaceChildren();
  for (const attempt of archiveAttemptsList) el.archiveAttemptList.append(attemptRow(attempt));
  const done = hasCompletedArchive();
  el.archiveAttemptsDone.hidden = !done;
  el.archivePlay.hidden = done;
  if (!done) el.archiveAttemptNumber.textContent = String(archiveAttemptsList.length + 1);
}

async function refreshArchiveBoards() {
  if (!archiveChallenge) return;
  try {
    const real = await fetchLeaderboard(archiveChallenge.id);
    const rows = real?.top ?? [];
    el.archiveRealRows.replaceChildren();
    rows.forEach((entry, index) => el.archiveRealRows.append(todayRowNode(entry, index + 1)));
    el.archiveRealEmpty.hidden = rows.length > 0;
  } catch {
    el.archiveRealRows.replaceChildren();
    el.archiveRealEmpty.hidden = false;
  }
  try {
    const late = await fetchLeaderboard(archiveChallenge.id, { late: true });
    const rows = late?.top ?? [];
    el.archiveLateRows.replaceChildren();
    rows.forEach((entry, index) => el.archiveLateRows.append(todayRowNode(entry, index + 1)));
    el.archiveLateEmpty.hidden = rows.length > 0;
  } catch {
    el.archiveLateRows.replaceChildren();
    el.archiveLateEmpty.hidden = false;
  }
}

/** Every past day there's an archive for, newest first: from yesterday back
 * to LAUNCH_DAY. Finite and short by construction (the game is only a few
 * days old) - no pagination needed yet. Empty on launch day itself, before
 * there's been a single past day. */
function listArchiveDays() {
  const start = Date.parse(`${LAUNCH_DAY}T00:00:00Z`);
  const end = Date.parse(`${previousDayKey(todayKey())}T00:00:00Z`);
  const days = [];
  for (let t = end; t >= start; t -= 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

function archiveListItem(dayKey) {
  const day = challengeForDay(dayKey);
  const li = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "archive-list-item";

  const dayLabel = document.createElement("span");
  dayLabel.className = "archive-list-day";
  dayLabel.textContent = `Daily #${day.dayNumber} — ${formatDayKey(dayKey)}`;

  const promptLabel = document.createElement("span");
  promptLabel.className = "archive-list-prompt";
  promptLabel.textContent = day.prompt;

  button.append(dayLabel, promptLabel);
  button.addEventListener("click", () => {
    el.archiveList.hidden = true;
    loadArchiveDay(dayKey);
  });
  li.append(button);
  return li;
}

function renderArchiveList() {
  const days = listArchiveDays();
  el.archiveList.replaceChildren();
  if (days.length === 0) {
    const li = document.createElement("li");
    li.className = "archive-list-empty";
    li.textContent = "No past days yet — check back tomorrow.";
    el.archiveList.append(li);
    return;
  }
  for (const dayKey of days) el.archiveList.append(archiveListItem(dayKey));
}

el.archiveBrowse.addEventListener("click", () => {
  if (el.archiveList.hidden) {
    renderArchiveList();
    showEl(el.archiveList, true); // one entrance for the whole list, no per-item stagger
  } else {
    el.archiveList.hidden = true;
  }
});

async function loadArchiveDay(dayKey) {
  archiveChallenge = challengeForDay(dayKey);
  archiveAttemptsList = [];
  showEl(el.archiveChallenge, true);
  el.archiveDaynum.textContent = `Daily #${archiveChallenge.dayNumber} — ${formatDayKey(dayKey)}`;
  el.archivePrompt.textContent = archiveChallenge.prompt;
  el.archiveAnswer.maxLength = MAX_ANSWER;
  el.archiveAnswer.placeholder = archiveChallenge.example
    ? `e.g. ${archiveChallenge.example}`
    : "e.g. your interpretation";
  showArchiveError(null);
  updateArchiveCounter();

  try {
    const server = await fetchAttempts(archiveChallenge.id);
    archiveAttemptsList = Array.isArray(server?.attempts) ? server.attempts : [];
  } catch {
    archiveAttemptsList = [];
  }
  renderArchiveAttempts();
  await refreshArchiveBoards();
}

function showArchiveError(message) {
  el.archiveError.textContent = message ?? "";
  el.archiveError.hidden = !message;
}

function updateArchiveCounter() {
  const used = [...el.archiveAnswer.value].length;
  el.archiveCounter.textContent = `${used} / ${MAX_ANSWER}`;
  el.archiveCounter.classList.toggle("near", used > MAX_ANSWER - 15);
}
el.archiveAnswer.addEventListener("input", updateArchiveCounter);
el.archiveAnswer.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    el.archivePlay.requestSubmit();
  }
});

let archiveBusy = false;

el.archivePlay.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (archiveBusy || !archiveChallenge) return;
  showArchiveError(null);

  if (hasCompletedArchive()) {
    return showArchiveError("All 3 archive attempts are used for this day.");
  }

  let name;
  let answer;
  try {
    name = validateName(el.archiveName.value);
    answer = validateAnswer(el.archiveAnswer.value);
  } catch (err) {
    return showArchiveError(err.message);
  }
  if (!looksLikeRealText(answer)) {
    return showArchiveError("Write an actual interpretation, not random characters.");
  }
  if (isDuplicateAnswer(archiveAttemptsList, answer)) {
    return showArchiveError("You've already submitted that answer — try a different one.");
  }

  archiveBusy = true;
  el.archiveSubmit.disabled = true;
  el.archiveSubmit.classList.add("busy");
  el.archiveSubmit.querySelector(".submit-label").textContent = "Judging…";

  try {
    let verdict = null;
    if (!serverJudged(archiveChallenge.scoringVersion)) {
      // Shares the same judge instance as today's riddle (loadJudge() is
      // idempotent) - loaded on demand here since a player who already
      // finished today's riddle may never have triggered prepareJudge().
      await loadJudge();
      verdict = await scoreAnswer({
        answer,
        statement: archiveChallenge.noulStatement,
        penaltyStatement: archiveChallenge.penaltyStatement,
        penaltyExponent: archiveChallenge.penaltyExponent,
      });
    }

    const normalized = normalizeAnswer(answer);
    const hash = await answerHash({
      challengeId: archiveChallenge.id,
      scoringVersion: archiveChallenge.scoringVersion,
      normalizedAnswer: normalized,
    });

    rememberName(name);

    const response = await submit({
      challengeId: archiveChallenge.id,
      dayKey: archiveChallenge.dayKey,
      scoringVersion: archiveChallenge.scoringVersion,
      name,
      answer,
      normalizedAnswer: normalized,
      answerHash: hash,
      ...(verdict ? { noul: verdict.noul, score: verdict.score, model: verdict.model } : {}),
    });

    if (Array.isArray(response?.attempts)) archiveAttemptsList = response.attempts;
    renderArchiveAttempts();
    el.archiveAnswer.value = "";
    updateArchiveCounter();
    await refreshArchiveBoards();
  } catch (err) {
    if (err.status === 409 && err.body?.error === "max_attempts") {
      try {
        const server = await fetchAttempts(archiveChallenge.id);
        archiveAttemptsList = server.attempts ?? archiveAttemptsList;
      } catch {
        // Keep what we had.
      }
      renderArchiveAttempts();
      showArchiveError("All 3 archive attempts are already used for this day.");
    } else if (err.status === 409 && err.body?.error === "duplicate_answer") {
      showArchiveError("You've already submitted that answer for this day.");
    } else if (err.status === 400 && err.body?.error === "junk_answer") {
      showArchiveError(err.body.hint || err.message);
    } else {
      showArchiveError(err?.message || "Something went wrong scoring that. Try again.");
    }
  } finally {
    archiveBusy = false;
    el.archiveSubmit.disabled = false;
    el.archiveSubmit.classList.remove("busy");
    el.archiveSubmit.querySelector(".submit-label").textContent = `Submit attempt ${Math.min(
      archiveAttemptsList.length + 1,
      MAX_ATTEMPTS,
    )} of ${MAX_ATTEMPTS}`;
  }
});

// --- bonus round: "what's the opposite of ___?" ----------------------------
//
// Unlocks only once today's main riddle is done (see initBonusIfUnlocked) and
// has its own 3 guesses and its own leaderboard - a different challenge id
// is already a different leaderboard (see fetchBoard in the worker), so
// nothing extra is needed there. The word itself comes from a hand-picked
// list that rotates by date (see shared/challenges.js's opposingWordForDay) -
// not generated by a model at request time, so this costs nothing and never
// fails, unlike an actual per-day AI call would.

const bonusChallenge = bonusChallengeForDay(todayKey());
let bonusAttemptsList = [];

const BONUS_GUESS_LABELS = ["Enter first guess", "Enter second guess", "Enter third guess"];

function hasCompletedBonus() {
  return bonusAttemptsList.length >= MAX_ATTEMPTS;
}

function showBonusError(message) {
  el.bonusError.textContent = message ?? "";
  el.bonusError.hidden = !message;
}

function updateBonusCounter() {
  const used = [...el.bonusAnswer.value].length;
  el.bonusCounter.textContent = `${used} / ${MAX_ANSWER}`;
  el.bonusCounter.classList.toggle("near", used > MAX_ANSWER - 15);
}
el.bonusAnswer.addEventListener("input", updateBonusCounter);
el.bonusAnswer.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    el.bonusPlay.requestSubmit();
  }
});

/** No name input in the bonus round: you can only get here by finishing
 * today's riddle, so the name is already known and reused silently. The
 * input is only revealed in the one case where it genuinely isn't known -
 * nothing remembered on this device (e.g. the riddle was played elsewhere,
 * or storage was cleared). */
function renderBonusNameField() {
  const chosen = savedName();
  if (chosen) {
    el.bonusNameField.hidden = true;
    el.bonusPlayingAs.hidden = false;
    el.bonusPlayingAs.replaceChildren("Playing as ", nameNode(chosen));
  } else {
    el.bonusNameField.hidden = false;
    el.bonusPlayingAs.hidden = true;
  }
}

/** No attempt-number badge here, deliberately - just which ordinal guess is
 * next, in plain words, since there are only ever 3 and no redaction note to
 * explain alongside it. */
function renderBonusAttempts() {
  if (bonusAttemptsList.length === 0) {
    el.bonusAttempts.hidden = true;
  } else {
    el.bonusAttempts.hidden = false;
    const daily = averageScore(bonusAttemptsList);
    el.bonusScore.textContent = formatScore(daily);
    el.bonusScore.className = `score ${scoreClass(daily)}`;
    el.bonusAttemptList.replaceChildren();
    for (const attempt of bonusAttemptsList) el.bonusAttemptList.append(attemptRow(attempt));
  }
  const done = hasCompletedBonus();
  el.bonusAttemptsDone.hidden = !done;
  el.bonusPlay.hidden = done;
  if (!done) el.bonusSubmitLabel.textContent = BONUS_GUESS_LABELS[bonusAttemptsList.length];
  // Keeps the shortcut button in the riddle card in step with this round -
  // once the last guess lands there is nothing left to jump to.
  updatePlayBonusButton();
}

async function refreshBonusBoard() {
  try {
    const board = await fetchLeaderboard(bonusChallenge.id);
    const rows = board?.top ?? [];
    el.bonusRows.replaceChildren();
    rows.forEach((entry, index) => el.bonusRows.append(todayRowNode(entry, index + 1)));
    el.bonusBoardEmpty.hidden = rows.length > 0;
    if (board?.you) {
      const gap = document.createElement("li");
      gap.className = "row-gap";
      gap.textContent = "···";
      el.bonusRows.append(gap, todayRowNode(board.you, board.you.rank));
    }
  } catch {
    el.bonusRows.replaceChildren();
    el.bonusBoardEmpty.hidden = false;
  }
}

// The bonus section itself is always visible once there's a shared backend
// (it's the "there IS a bonus round" indication - staying hidden entirely
// until unlocked defeats the point) and shows a locked notice until today's
// main riddle is done, at which point it swaps to the real play panel.
// `bonusInitialized` guards the one-time fetch so re-renders (e.g. another
// main-round attempt that doesn't change completion) don't re-fetch.
let bonusInitialized = false;
let booted = false; // set once the page's first render is done

async function initBonusIfUnlocked() {
  // The bonus round was scored by the in-browser model, which v6 retires.
  if (SERVER_JUDGED || !leaderboardEnabled()) {
    el.bonus.hidden = true;
    return;
  }
  el.bonus.hidden = false;

  // The leaderboard (names, ranks, averages) is shown even while locked - a
  // sneak peek at how well others are doing, deliberately without their
  // answer text, which the worker already withholds from anyone who hasn't
  // finished their own 3 bonus guesses (see fetchBoard's redact logic) -
  // nothing extra needed here to keep the actual word a surprise.
  await refreshBonusBoard();

  const unlocked = hasCompletedToday();
  el.bonusLocked.hidden = unlocked;
  // Enters when it unlocks during play; already unlocked on load, it is just there.
  if (unlocked) showEl(el.bonusUnlocked, booted);
  else el.bonusUnlocked.hidden = true;
  if (!unlocked || bonusInitialized) return;
  bonusInitialized = true;
  el.bonusPrompt.textContent = bonusChallenge.prompt;
  renderBonusNameField();
  try {
    const server = await fetchAttempts(bonusChallenge.id);
    bonusAttemptsList = Array.isArray(server?.attempts) ? server.attempts : [];
  } catch {
    bonusAttemptsList = [];
  }
  renderBonusAttempts();
}

let bonusBusy = false;

el.bonusPlay.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (bonusBusy) return;
  showBonusError(null);

  if (hasCompletedBonus()) {
    return showBonusError("All 3 bonus guesses are used today.");
  }

  let name;
  let answer;
  try {
    // The name comes from today's riddle, which must already be finished to
    // be here at all - the input only exists as a fallback for when nothing
    // is remembered on this device (see renderBonusNameField).
    name = validateName(savedName() || el.bonusName.value);
    answer = validateAnswer(el.bonusAnswer.value);
  } catch (err) {
    return showBonusError(err.message);
  }
  if (!looksLikeRealText(answer)) {
    return showBonusError("Write an actual guess, not random characters.");
  }
  if (isDuplicateAnswer(bonusAttemptsList, answer)) {
    return showBonusError("You've already guessed that — try a different one.");
  }

  bonusBusy = true;
  el.bonusSubmit.disabled = true;
  el.bonusSubmit.classList.add("busy");
  el.bonusSubmitLabel.textContent =
    judgeRuntime()?.device === "server-wasm" ? "Checking your guess…" : "Judging…";

  try {
    await loadJudge();
    const verdict = await scoreAnswer({ answer, statement: bonusChallenge.noulStatement });

    const normalized = normalizeAnswer(answer);
    const hash = await answerHash({
      challengeId: bonusChallenge.id,
      scoringVersion: bonusChallenge.scoringVersion,
      normalizedAnswer: normalized,
    });

    rememberName(name);

    const response = await submit({
      challengeId: bonusChallenge.id,
      dayKey: bonusChallenge.dayKey,
      scoringVersion: bonusChallenge.scoringVersion,
      name,
      answer,
      normalizedAnswer: normalized,
      answerHash: hash,
      noul: verdict.noul,
      score: verdict.score,
      model: verdict.model,
    });

    if (Array.isArray(response?.attempts)) bonusAttemptsList = response.attempts;
    renderBonusAttempts();
    el.bonusAnswer.value = "";
    updateBonusCounter();
    await refreshBonusBoard();
  } catch (err) {
    if (err.status === 409 && err.body?.error === "max_attempts") {
      try {
        const server = await fetchAttempts(bonusChallenge.id);
        bonusAttemptsList = server.attempts ?? bonusAttemptsList;
      } catch {
        // Keep what we had.
      }
      renderBonusAttempts();
      showBonusError("All 3 bonus guesses are already used today.");
    } else if (err.status === 409 && err.body?.error === "duplicate_answer") {
      showBonusError("You've already guessed that.");
    } else if (err.status === 403 && err.body?.error === "bonus_locked") {
      showBonusError("Finish today's riddle first to unlock the bonus round.");
    } else {
      showBonusError(err?.message || "Something went wrong scoring that. Try again.");
    }
  } finally {
    bonusBusy = false;
    el.bonusSubmit.disabled = false;
    el.bonusSubmit.classList.remove("busy");
    if (!hasCompletedBonus()) {
      el.bonusSubmitLabel.textContent = BONUS_GUESS_LABELS[bonusAttemptsList.length];
    }
  }
});

// --- judge loading ---------------------------------------------------------

function formatBytes(bytes) {
  if (!bytes) return null;
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
}

/** The download meter: a full-width fill slid in from the left (a transform,
 * so it never relayouts). */
function setMeter(percent) {
  el.preparingBar.style.transform = `translateX(${percent - 100}%)`;
}

async function prepareJudge() {
  const info = await judgeInfo();

  if (info.unsupported) {
    // Known ahead of time, before anything is downloaded: this device has no
    // working WebGPU, and there is no in-browser fallback for this model -
    // see web/src/judge.js's module comment for why. Fail immediately with a
    // specific, honest message rather than attempting (and wasting a
    // download on) a load that is guaranteed to crash.
    throw new UnsupportedDeviceError(
      "This browser can't run today's judge. Try a recent version of Chrome, Edge, or Safari with WebGPU enabled.",
    );
  }

  const totalSize = formatBytes(info.downloadBytes);

  if (info.isCached) {
    el.preparingText.textContent = "Loading the judge…";
    el.preparingNote.textContent = "Already downloaded on this device — no redownload needed.";
  } else if (totalSize) {
    el.preparingText.textContent = "Downloading judge…";
    el.preparingNote.textContent = `One-time ${totalSize} download. It will be cached on this device afterwards.`;
  }

  await loadJudge({
    onPhase: ({ phase, progress, loaded, total }) => {
      if (phase === PHASE.DOWNLOADING) {
        const percent = Math.round(progress * 100);
        setMeter(percent);
        el.preparingBar.classList.remove("indeterminate");
        const byteNote =
          typeof loaded === "number" && typeof total === "number" && total > 0
            ? ` (${formatBytes(loaded) ?? "0 MB"} / ${formatBytes(total) ?? totalSize})`
            : "";
        el.preparingText.textContent = `Downloading judge… ${percent}%${byteNote}`;
      } else if (phase === PHASE.INITIALIZING) {
        setMeter(100);
        el.preparingBar.classList.add("indeterminate");
        el.preparingText.textContent = "Initializing judge…";
        el.preparingNote.textContent = "Setting up the model on this device. Almost ready.";
      } else if (phase === PHASE.READY) {
        el.preparingBar.classList.remove("indeterminate");
        el.preparingText.textContent = "Judge ready.";
      }
    },
  });

  setMeter(100);
  if (attempts.length < MAX_ATTEMPTS) {
    // Loading -> play: one overlapping 220 ms swap; the form takes input from
    // its first frame.
    const m = window.JGG?.motion;
    if (m?.swap) m.swap(el.preparing, el.play);
    else {
      el.preparing.hidden = true;
      el.play.hidden = false;
    }
    el.name.value = savedName();
    updateCounter();
  } else {
    el.preparing.hidden = true;
  }
}

// --- interactions ----------------------------------------------------------

function updateCounter() {
  const used = [...el.answer.value].length;
  el.counter.textContent = `${used} / ${MAX_ANSWER}`;
  el.counter.classList.toggle("near", used > MAX_ANSWER - 15);
}

/** Called only after an attempt is actually accepted (locally, or by the
 * shared leaderboard) - never on a failed, invalid, or duplicate-rejected
 * submission, so a player's in-progress typing is never silently discarded.
 * The name field is deliberately left alone; only the answer and its counter
 * reset, ready for the next attempt. */
function clearAnswerInput() {
  el.answer.value = "";
  updateCounter();
}
el.answer.addEventListener("input", updateCounter);
el.answer.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    el.play.requestSubmit();
  }
});

el.playBonusButton.addEventListener("click", () => {
  const m = window.JGG?.motion;
  if (m?.scroll) m.scroll(el.bonus, { block: "start" });
  else el.bonus.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
});

let busy = false;

el.play.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  showError(null);

  if (hasCompletedToday()) {
    return showError("All 3 attempts are used for today.");
  }

  let name;
  let answer;
  try {
    name = validateName(el.name.value);
    answer = validateAnswer(el.answer.value);
  } catch (err) {
    return showError(err.message);
  }

  // A non-AI gate that never scores anything - it only decides whether the
  // real judge is asked at all. See shared/gibberish.js. Answers that reuse
  // the riddle's words are no longer blocked (owner, 18 Oct): since v5 the
  // judge itself marks rewordings down.
  if (!looksLikeRealText(answer)) {
    return showError("Write an actual interpretation, not random characters.");
  }
  if (isDuplicateAnswer(attempts, answer)) {
    return showError("You've already submitted that answer — try a different one.");
  }

  busy = true;
  el.submit.disabled = true;
  el.submit.classList.add("busy");
  // judgeRuntime() reflects whatever loadJudge() already resolved to, set
  // before this submission - no new request has been made yet, so this is
  // never the deciding factor in whether the server fallback gets used,
  // only how this one label reads while judging. Deliberately no mention
  // of WASM/WebGPU/ORT/q4 - same vague-but-honest phrasing either way.
  el.submit.querySelector(".submit-label").textContent =
    SERVER_JUDGED || judgeRuntime()?.device === "server-wasm" ? "Checking your answer…" : "Judging…";

  try {
    if (SERVER_JUDGED) {
      await submitJudged(name, answer);
      return;
    }
    const verdict = await scoreAnswer({
      answer,
      statement: challenge.noulStatement,
      penaltyStatement: challenge.penaltyStatement,
      penaltyExponent: challenge.penaltyExponent,
    });

    const normalized = normalizeAnswer(answer);
    const hash = await answerHash({
      challengeId: challenge.id,
      scoringVersion: challenge.scoringVersion,
      normalizedAnswer: normalized,
    });

    const localAttempt = {
      answer,
      score: verdict.score,
      noul: verdict.noul,
      at: new Date().toISOString(),
    };

    rememberName(name);

    if (leaderboardEnabled()) {
      try {
        const response = await submit({
          challengeId: challenge.id,
          dayKey: challenge.dayKey,
          scoringVersion: challenge.scoringVersion,
          name,
          answer,
          normalizedAnswer: normalized,
          answerHash: hash,
          noul: verdict.noul,
          score: verdict.score,
          model: verdict.model,
        });
        // The server assigns the true attempt number and is the source of
        // truth for the full list - use its copy, not a locally-guessed one.
        if (Array.isArray(response?.attempts)) {
          attempts = response.attempts;
          setLocalAttempts(challenge.id, attempts);
        } else {
          attempts = addLocalAttempt(challenge.id, localAttempt);
        }
        renderAttempts({ landed: true });
        if (response?.leaderboard) renderBoard(response.leaderboard);
        else await refreshBoard();
        clearAnswerInput();
      } catch (err) {
        if (err.status === 409 && err.body?.error === "max_attempts") {
          try {
            const server = await fetchAttempts(challenge.id);
            attempts = server.attempts ?? attempts;
            setLocalAttempts(challenge.id, attempts);
          } catch {
            // Keep what we had; the form stays disabled by the count below.
          }
          renderAttempts();
          showError("All 3 attempts are already used for today.");
          // Rejected, not accepted: the input is left as-is (requirement 3).
        } else if (err.status === 409 && err.body?.error === "duplicate_answer") {
          // Rejected server-side, no attempt consumed: don't touch `attempts`
          // or clear the input - the player should see and can edit what
          // they just typed.
          showError("You've already submitted that answer.");
        } else {
          // The score is real and shown locally; only the shared board failed.
          attempts = addLocalAttempt(challenge.id, localAttempt);
          renderAttempts({ landed: true });
          addToLocalBoard(challenge.id, {
            name,
            answer: bestAnswerOf(attempts),
            score: averageScore(attempts),
            at: localAttempt.at,
            you: true,
          });
          renderLocalBoard();
          el.boardNote.hidden = false;
          el.boardNote.textContent = `Your score is saved on this device. ${err.message}`;
          clearAnswerInput();
        }
      }
    } else {
      attempts = addLocalAttempt(challenge.id, localAttempt);
      renderAttempts({ landed: true });
      addToLocalBoard(challenge.id, {
        name,
        answer: bestAnswerOf(attempts),
        score: averageScore(attempts),
        at: localAttempt.at,
        you: true,
      });
      renderLocalBoard();
      clearAnswerInput();
    }
  } catch (err) {
    showError(err?.message || "Something went wrong scoring that. Try again.");
  } finally {
    busy = false;
    el.submit.disabled = false;
    el.submit.classList.remove("busy");
    el.submit.querySelector(".submit-label").textContent = `Submit attempt ${Math.min(
      attempts.length + 1,
      MAX_ATTEMPTS,
    )} of ${MAX_ATTEMPTS}`;
    // Runs no matter which branch above was taken (server success, a
    // rejected 4th attempt, a duplicate, or a local-only fallback) - any of
    // them can be the one that pushes attempts.length to 3, so the bonus
    // round's unlock check belongs here once, not duplicated per-branch
    // (and easy to miss one, which is exactly what happened before).
    await initBonusIfUnlocked();
  }
});

/** v6: send the answer, show the verdict. The worker judges (cache first),
 * refuses junk without spending an attempt, and records a pending attempt if
 * judging is paused. Errors the player can act on are shown; anything else
 * asks for a retry. */
async function submitJudged(name, answer) {
  if (!leaderboardEnabled()) {
    showError("The judge is offline right now. Try again in a moment.");
    return;
  }
  const normalized = normalizeAnswer(answer);
  const hash = await answerHash({
    challengeId: challenge.id,
    scoringVersion: challenge.scoringVersion,
    normalizedAnswer: normalized,
  });
  rememberName(name);
  try {
    const response = await submit({
      challengeId: challenge.id,
      dayKey: challenge.dayKey,
      scoringVersion: challenge.scoringVersion,
      name,
      answer,
      normalizedAnswer: normalized,
      answerHash: hash,
    });
    if (Array.isArray(response?.attempts)) {
      attempts = response.attempts;
      setLocalAttempts(challenge.id, attempts);
    }
    renderAttempts({ landed: true });
    if (response?.leaderboard) renderBoard(response.leaderboard);
    else await refreshBoard();
    clearAnswerInput();
  } catch (err) {
    if (err.status === 400 && err.body?.error === "junk_answer") {
      showError(err.body.hint || err.message);
    } else if (err.status === 409 && err.body?.error === "max_attempts") {
      try {
        const server = await fetchAttempts(challenge.id);
        attempts = server.attempts ?? attempts;
        setLocalAttempts(challenge.id, attempts);
      } catch {
        // Keep what we had.
      }
      renderAttempts();
      showError("All 3 attempts are already used for today.");
    } else if (err.status === 409 && err.body?.error === "duplicate_answer") {
      showError("You've already submitted that answer.");
    } else if (err.status === 429) {
      showError("Slow down a little: too many answers from here. Try again in a few minutes.");
    } else {
      showError("Couldn't reach the judge. Check your connection and try again.");
    }
  }
}

// --- boot ------------------------------------------------------------------

renderChallenge();

await loadConfig();

// Reconcile attempts: prefer the server's copy (authoritative once a backend
// exists), fall back to the local cache if the network fails or no backend
// is configured at all.
if (leaderboardEnabled()) {
  try {
    const server = await fetchAttempts(challenge.id);
    attempts = Array.isArray(server?.attempts) ? server.attempts : [];
    setLocalAttempts(challenge.id, attempts);
  } catch {
    attempts = localAttempts(challenge.id);
  }
} else {
  attempts = localAttempts(challenge.id);
}

renderAttempts();
await refreshBoard();
await renderYesterday(); // a different, already-closed riddle - safe to show any time
startPolling();
await initBonusIfUnlocked(); // no-op unless today's riddle is already done
booted = true;

// Archive needs the shared backend to have anywhere durable to store late
// attempts and a separate late leaderboard to show them on - with no
// backend configured there's nothing for it to do.
if (leaderboardEnabled()) {
  el.archive.hidden = false;
} else {
  el.archive.hidden = true;
}

// Temporary diagnostic aid, not a permanent feature: ?debug=1 appends the
// real underlying error (walking every .cause link, with each stage tag
// where judge-wasm.js set one) to the on-screen failure note, so a real
// device with no attached devtools (most phones) can still report back the
// exact failure instead of just the generic friendly headline below. The
// headline itself never changes - this only extends the note text, and
// only when explicitly asked for via the URL.
function describeErrorChain(err) {
  const parts = [];
  let current = err;
  let depth = 0;
  while (current && depth < 6) {
    const tag = current.stage ? `[${current.stage}] ` : "";
    parts.push(`${tag}${current.name ?? "Error"}: ${current.message ?? current}`);
    current = current.cause;
    depth += 1;
  }
  return parts.join(" <- caused by: ");
}

if (SERVER_JUDGED) {
  // The worker judges: nothing to download. Straight to the form.
  el.preparing.hidden = true;
  if (!hasCompletedToday()) {
    el.play.hidden = false;
    el.name.value = savedName();
    updateCounter();
  }
} else if (hasCompletedToday()) {
  // Already done for today: no reason to download a 365MB model just to show
  // a screen that says so.
  el.preparing.hidden = true;
} else {
  try {
    await prepareJudge();
  } catch (err) {
    // Always logged in full (stack, name, cause) regardless of what the
    // player sees - this is what makes a production failure diagnosable
    // instead of just the generic headline below.
    console.error("[main] judge failed to load:", err);
    el.preparing.hidden = false;
    el.preparingText.textContent =
      err instanceof UnsupportedDeviceError
        ? "This device can't run today's judge."
        : "Today's judge could not load.";
    const friendlyNote = err?.message ?? "Check your connection and refresh to try again.";
    const debugRequested = new URLSearchParams(location.search).get("debug") === "1";
    el.preparingNote.textContent = debugRequested
      ? `${friendlyNote}\n\nDEBUG: ${describeErrorChain(err)}`
      : friendlyNote;
    // A failure isn't loading any more: stop and hide the spinner and the sweep.
    el.preparing.querySelector(".spinner-ring").hidden = true;
    el.preparingBar.classList.remove("indeterminate");
    setMeter(0);
  }
}
