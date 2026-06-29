/* GMAT Quant Quiz — vanilla JS static app */

const STORAGE_KEY = "gmat-quant-quiz-v1";
const SESSION_SIZE = 10;

const state = {
  questions: [],
  progress: loadProgress(),
  filters: { difficulties: new Set(["Easy", "Medium", "Hard"]), skipBroken: true, prioritizeWrong: true },
  session: null,
  currentIdx: 0,
  answered: false,
};

/* ---------- persistence ---------- */

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultProgress();
    const parsed = JSON.parse(raw);
    return { ...defaultProgress(), ...parsed };
  } catch {
    return defaultProgress();
  }
}

function defaultProgress() {
  return {
    attempts: {}, // qnum -> { correct: bool, count: number, lastAt: number, history: [bool, bool, ...] }
    streak: 0,
    bestStreak: 0,
    totalAnswered: 0,
    totalCorrect: 0,
  };
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
}

/* ---------- data ---------- */

async function loadQuestions() {
  const res = await fetch("quant_questions.json");
  if (!res.ok) throw new Error("Failed to load questions");
  state.questions = await res.json();
}

/* ---------- screens ---------- */

function show(screen) {
  for (const s of document.querySelectorAll(".screen")) s.classList.add("hidden");
  document.getElementById(screen).classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "instant" });
}

/* ---------- home rendering ---------- */

function renderHome() {
  const attempted = Object.keys(state.progress.attempts).length;
  const totalCorrect = state.progress.totalCorrect;
  const totalAnswered = state.progress.totalAnswered;
  const pct = totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : null;

  document.getElementById("stat-attempted").textContent = attempted;
  document.getElementById("stat-correct-pct").textContent = pct === null ? "—" : `${pct}%`;
  document.getElementById("stat-streak").textContent = state.progress.streak;
  document.getElementById("stat-remaining").textContent = state.questions.length - attempted;

  // diff chips
  for (const chip of document.querySelectorAll("#difficulty-chips .chip")) {
    chip.classList.toggle("active", state.filters.difficulties.has(chip.dataset.diff));
  }
  document.getElementById("skip-broken").checked = state.filters.skipBroken;
  document.getElementById("prioritize-wrong").checked = state.filters.prioritizeWrong;

  // breakdowns
  renderBreakdown("diff-breakdown", groupBy(state.questions, q => q.difficulty), ["Easy", "Medium", "Hard"]);
  renderBreakdown("cat-breakdown", groupBy(state.questions, q => q.category), null);
}

function groupBy(arr, fn) {
  const out = {};
  for (const x of arr) {
    const k = fn(x) || "(unknown)";
    if (!out[k]) out[k] = [];
    out[k].push(x);
  }
  return out;
}

function renderBreakdown(targetId, groups, order) {
  const target = document.getElementById(targetId);
  target.innerHTML = "";
  const keys = order || Object.keys(groups).sort();
  for (const k of keys) {
    if (!groups[k]) continue;
    const items = groups[k];
    const attempted = items.filter(q => state.progress.attempts[q.number]).length;
    const correct = items.filter(q => {
      const a = state.progress.attempts[q.number];
      return a && a.correct;
    }).length;
    const row = document.createElement("div");
    row.className = "bd-row";
    row.innerHTML = `
      <span class="bd-label">${escapeHtml(k)}</span>
      <span class="bd-val">${correct}/${attempted} · ${items.length} total</span>
    `;
    target.appendChild(row);
  }
}

/* ---------- session building ---------- */

function buildSession({ onlyWrong = false } = {}) {
  let pool = state.questions.filter(q => state.filters.difficulties.has(q.difficulty));
  if (state.filters.skipBroken) {
    pool = pool.filter(q => !q.extraction_notes);
  }
  if (onlyWrong) {
    pool = pool.filter(q => {
      const a = state.progress.attempts[q.number];
      return a && !a.correct;
    });
    if (pool.length === 0) {
      alert("No previously wrong questions to review (with current filters).");
      return null;
    }
  } else {
    // De-prioritize already-correct: prefer never-attempted, then previously-wrong, then correct.
    const unseen = pool.filter(q => !state.progress.attempts[q.number]);
    const wrong = pool.filter(q => {
      const a = state.progress.attempts[q.number];
      return a && !a.correct;
    });
    const right = pool.filter(q => {
      const a = state.progress.attempts[q.number];
      return a && a.correct;
    });
    pool = state.filters.prioritizeWrong
      ? [...shuffle(wrong), ...shuffle(unseen), ...shuffle(right)]
      : [...shuffle(unseen), ...shuffle(wrong), ...shuffle(right)];
  }
  const items = pool.slice(0, SESSION_SIZE);
  if (items.length === 0) return null;
  return {
    items,
    sessionCorrect: 0,
  };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- quiz rendering ---------- */

function startSession(opts) {
  const session = buildSession(opts);
  if (!session) {
    alert("No questions match the current filters.");
    return;
  }
  state.session = session;
  state.currentIdx = 0;
  show("quiz");
  renderQuestion();
}

function renderQuestion() {
  state.answered = false;
  const q = state.session.items[state.currentIdx];
  document.getElementById("q-progress").textContent = `${state.currentIdx + 1} / ${state.session.items.length}`;
  document.getElementById("q-session-correct").textContent = `${state.session.sessionCorrect} correct`;
  const pct = ((state.currentIdx) / state.session.items.length) * 100;
  document.getElementById("progress-bar-fill").style.width = `${pct}%`;

  document.getElementById("q-number").textContent = `#${q.number}`;
  document.getElementById("q-difficulty").textContent = q.difficulty;
  document.getElementById("q-category").textContent = q.category || "—";

  const notice = document.getElementById("q-notice");
  if (q.extraction_notes) {
    notice.textContent = `⚠ ${q.extraction_notes}`;
    notice.classList.remove("hidden");
  } else {
    notice.classList.add("hidden");
  }

  document.getElementById("q-text").textContent = q.question || "(question missing)";

  const optsBox = document.getElementById("q-options");
  optsBox.innerHTML = "";
  const letters = ["A", "B", "C", "D", "E"];
  for (const L of letters) {
    const txt = q.options[L] ?? "(empty)";
    const btn = document.createElement("button");
    btn.className = "option";
    btn.type = "button";
    btn.dataset.letter = L;
    btn.innerHTML = `<span class="option-letter">${L}</span><span class="option-text"></span>`;
    btn.querySelector(".option-text").textContent = txt;
    btn.addEventListener("click", () => onAnswer(L));
    optsBox.appendChild(btn);
  }

  document.getElementById("q-feedback").classList.add("hidden");
  document.getElementById("next-btn").disabled = true;
}

function onAnswer(letter) {
  if (state.answered) return;
  state.answered = true;
  const q = state.session.items[state.currentIdx];
  const isCorrect = letter === q.correct_answer;

  // Visual feedback on buttons
  for (const btn of document.querySelectorAll(".option")) {
    const L = btn.dataset.letter;
    btn.disabled = true;
    if (L === q.correct_answer) {
      btn.classList.add("correct");
    } else if (L === letter) {
      btn.classList.add("wrong");
    } else {
      btn.classList.add("disabled-faded");
    }
  }

  // Feedback panel
  const fb = document.getElementById("q-feedback");
  const fbResult = document.getElementById("q-feedback-result");
  fbResult.classList.toggle("good", isCorrect);
  fbResult.classList.toggle("bad", !isCorrect);
  fbResult.textContent = isCorrect ? "✓ Correct" : `✗ Wrong — correct answer is ${q.correct_answer}`;
  document.getElementById("q-explanation").textContent = q.explanation || "(no explanation)";
  fb.classList.remove("hidden");

  // Update progress
  const prev = state.progress.attempts[q.number] || { count: 0, history: [] };
  state.progress.attempts[q.number] = {
    correct: isCorrect,
    count: prev.count + 1,
    lastAt: Date.now(),
    history: [...(prev.history || []), isCorrect].slice(-10),
  };
  state.progress.totalAnswered += 1;
  if (isCorrect) {
    state.progress.totalCorrect += 1;
    state.progress.streak += 1;
    state.progress.bestStreak = Math.max(state.progress.bestStreak, state.progress.streak);
    state.session.sessionCorrect += 1;
  } else {
    state.progress.streak = 0;
  }
  saveProgress();

  document.getElementById("q-session-correct").textContent = `${state.session.sessionCorrect} correct`;
  document.getElementById("next-btn").disabled = false;
}

function next() {
  if (state.currentIdx + 1 < state.session.items.length) {
    state.currentIdx += 1;
    renderQuestion();
  } else {
    finishSession();
  }
}

function skip() {
  next();
}

function finishSession() {
  const total = state.session.items.length;
  const correct = state.session.sessionCorrect;
  const pct = Math.round((correct / total) * 100);
  document.getElementById("done-summary").textContent =
    `${correct} / ${total} correct (${pct}%). Lifetime: ${state.progress.totalCorrect}/${state.progress.totalAnswered}.`;
  show("done");
}

/* ---------- helpers ---------- */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* ---------- wiring ---------- */

function wire() {
  for (const chip of document.querySelectorAll("#difficulty-chips .chip")) {
    chip.addEventListener("click", () => {
      const d = chip.dataset.diff;
      if (state.filters.difficulties.has(d)) {
        if (state.filters.difficulties.size > 1) state.filters.difficulties.delete(d);
      } else {
        state.filters.difficulties.add(d);
      }
      renderHome();
    });
  }
  document.getElementById("skip-broken").addEventListener("change", e => {
    state.filters.skipBroken = e.target.checked;
  });
  document.getElementById("prioritize-wrong").addEventListener("change", e => {
    state.filters.prioritizeWrong = e.target.checked;
  });

  document.getElementById("start-btn").addEventListener("click", () => startSession({}));
  document.getElementById("review-wrong-btn").addEventListener("click", () => startSession({ onlyWrong: true }));

  document.getElementById("back-btn").addEventListener("click", () => {
    if (confirm("Leave this session? Your answers so far are saved.")) {
      show("home");
      renderHome();
    }
  });
  document.getElementById("next-btn").addEventListener("click", next);
  document.getElementById("skip-btn").addEventListener("click", skip);

  document.getElementById("done-home-btn").addEventListener("click", () => {
    show("home");
    renderHome();
  });
  document.getElementById("done-again-btn").addEventListener("click", () => startSession({}));

  document.getElementById("reset-btn").addEventListener("click", () => {
    if (confirm("Reset all progress? This cannot be undone.")) {
      state.progress = defaultProgress();
      saveProgress();
      renderHome();
    }
  });
}

/* ---------- boot ---------- */

(async function boot() {
  try {
    await loadQuestions();
  } catch (e) {
    document.body.innerHTML = `<pre style="padding:20px;color:#fff">Failed to load questions.json — ${e.message}</pre>`;
    return;
  }
  wire();
  renderHome();
})();
