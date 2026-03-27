'use strict';

const STATS_KEY = 'mla_stats';
const DARK_KEY  = 'mla_dark';
const API_BASE  = '/api';

let stats      = {};
let bookmarks  = new Set();
let serverMode = true;

let session = {
  queue: [], index: 0, mode: 'all', answered: false,
  isExam: false, examAnswers: {},
  timerSec: 0, timerInterval: null,
};

// ── CORRECT ANSWER HELPERS ────────────────────────────────────────────────────
// Use community votes (highest vote_count) as ground truth; fall back to official
function getCorrectAnswer(q) {
  if (q.community_votes && q.community_votes.length) {
    const top = q.community_votes.reduce((best, v) => v.vote_count > best.vote_count ? v : best);
    if (top.vote_count > 0) return top.voted_answers;
  }
  return q.correct_answer;
}

// Multi-select if correct answer is 2+ capital letters like "AB", "ADE"
function isMultiSelect(q) {
  return /^[A-E]{2,}$/.test(getCorrectAnswer(q));
}

// Image-based answer — can't show correct answer visually
function isImageAnswer(q) {
  return q.correct_answer_is_image || /^image/i.test(q.correct_answer);
}

// ── INIT ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  applyDarkMode();
  await loadStats();
  await loadBookmarks();
  populateTopics();
  updateHomeCounts();
  showView('homeView');
  bindEvents();
  document.addEventListener('keydown', handleKeyboard);
});

function bindEvents() {
  // Mode buttons
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      session.mode = btn.dataset.mode;
    });
  });

  document.getElementById('btnStart').addEventListener('click', startQuiz);
  document.getElementById('btnStartExam').addEventListener('click', startExam);
  document.getElementById('btnSubmit').addEventListener('click', submitAnswer);
  document.getElementById('btnNext').addEventListener('click', nextQuestion);
  document.getElementById('btnSkip').addEventListener('click', skipQuestion);
  document.getElementById('btnBookmark').addEventListener('click', toggleBookmark);
  document.getElementById('btnAnalytics').addEventListener('click', showAnalytics);
  document.getElementById('btnBackQuiz').addEventListener('click', () => showView('quizView'));
  document.getElementById('btnHome').addEventListener('click', exitToHome);
  document.getElementById('btnResetConfirm').addEventListener('click', resetProgress);
  document.getElementById('btnDarkMode').addEventListener('click', toggleDarkMode);
  document.getElementById('btnDarkModeHome').addEventListener('click', toggleDarkMode);
  document.getElementById('btnExport').addEventListener('click', exportProgress);
  document.getElementById('importFile').addEventListener('change', importProgress);
  document.getElementById('sortBy').addEventListener('change', renderAnalyticsTable);
  document.getElementById('filterStatus').addEventListener('change', renderAnalyticsTable);
  document.getElementById('searchQ').addEventListener('input', renderAnalyticsTable);
}

// ── STORAGE ───────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res = await fetch(`${API_BASE}/stats`);
    if (!res.ok) throw new Error();
    stats = await res.json();
    serverMode = true;
  } catch {
    serverMode = false;
    try { stats = JSON.parse(localStorage.getItem(STATS_KEY)) || {}; } catch { stats = {}; }
  }
}

function saveLocal() {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

function getQStat(num) {
  return stats[num] || { attempts: 0, correct: 0 };
}

async function recordAnswer(num, isCorrect) {
  if (!stats[num]) stats[num] = { attempts: 0, correct: 0 };
  stats[num].attempts++;
  if (isCorrect) stats[num].correct++;
  stats[num].last = Date.now();

  if (serverMode) {
    try {
      await fetch(`${API_BASE}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionNum: num, isCorrect }),
      });
    } catch { saveLocal(); }
  } else {
    saveLocal();
  }
}

async function resetProgress() {
  if (!confirm('Reset ALL progress and bookmarks? This cannot be undone.')) return;
  if (serverMode) {
    await fetch(`${API_BASE}/stats`, { method: 'DELETE' });
  }
  localStorage.removeItem(STATS_KEY);
  localStorage.removeItem('mla_bookmarks');
  stats = {};
  bookmarks.clear();
  updateHomeCounts();
  updateHeaderStats();
  showToast('Progress reset');
}

// ── BOOKMARKS ─────────────────────────────────────────────────────────────────
async function loadBookmarks() {
  try {
    const res = await fetch(`${API_BASE}/bookmarks`);
    if (!res.ok) throw new Error();
    bookmarks = new Set(await res.json());
  } catch {
    try { bookmarks = new Set(JSON.parse(localStorage.getItem('mla_bookmarks') || '[]')); }
    catch { bookmarks = new Set(); }
  }
}

async function toggleBookmark() {
  const num = session.queue[session.index];
  const add = !bookmarks.has(num);
  if (add) bookmarks.add(num); else bookmarks.delete(num);

  const btn = document.getElementById('btnBookmark');
  btn.textContent = add ? '🔖' : '☆';
  btn.classList.toggle('bookmarked', add);

  if (serverMode) {
    try {
      await fetch(`${API_BASE}/bookmark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionNum: num, bookmarked: add }),
      });
    } catch { localStorage.setItem('mla_bookmarks', JSON.stringify([...bookmarks])); }
  } else {
    localStorage.setItem('mla_bookmarks', JSON.stringify([...bookmarks]));
  }
  updateHomeCounts();
  showToast(add ? '🔖 Bookmarked' : 'Bookmark removed');
}

// ── DARK MODE ─────────────────────────────────────────────────────────────────
function toggleDarkMode() {
  document.body.classList.toggle('dark');
  const dark = document.body.classList.contains('dark');
  localStorage.setItem(DARK_KEY, dark ? '1' : '');
  const icon = dark ? '☀️' : '🌙';
  document.getElementById('btnDarkMode').textContent = icon;
  document.getElementById('btnDarkModeHome').textContent = icon;
}

function applyDarkMode() {
  if (localStorage.getItem(DARK_KEY)) {
    document.body.classList.add('dark');
  }
}

// ── VIEWS ─────────────────────────────────────────────────────────────────────
function showView(id) {
  ['homeView', 'quizView', 'analyticsView'].forEach(v => {
    document.getElementById(v).style.display = v === id ? '' : 'none';
  });
  document.getElementById('appHeader').style.display = id === 'homeView' ? 'none' : '';
  if (id === 'homeView') { stopTimer(); updateHomeCounts(); syncDarkBtn(); }
  if (id === 'analyticsView') renderAnalytics();
}

function exitToHome() {
  if (session.isExam && session.timerInterval) {
    if (!confirm('Exit exam? Your progress will be lost.')) return;
    stopTimer();
    session.isExam = false;
  }
  showView('homeView');
}

function syncDarkBtn() {
  const dark = document.body.classList.contains('dark');
  const icon = dark ? '☀️' : '🌙';
  document.getElementById('btnDarkMode').textContent = icon;
  document.getElementById('btnDarkModeHome').textContent = icon;
}

// ── HOME ──────────────────────────────────────────────────────────────────────
function populateTopics() {
  const topics = [...new Set(QUESTIONS.map(q => q.topic))].sort((a, b) => a - b);
  const sel = document.getElementById('topicFilter');
  topics.forEach(t => {
    const o = document.createElement('option');
    o.value = t; o.textContent = `Topic ${t}`;
    sel.appendChild(o);
  });
}

function updateHomeCounts() {
  document.getElementById('countAll').textContent      = QUESTIONS.length;
  document.getElementById('countWeak').textContent     = QUESTIONS.filter(q => {
    const s = getQStat(q.number);
    return s.attempts > 0 && (s.correct / s.attempts) < 0.7;
  }).length;
  document.getElementById('countUnseen').textContent   = QUESTIONS.filter(q => getQStat(q.number).attempts === 0).length;
  document.getElementById('countBookmark').textContent = bookmarks.size;
}

// ── QUEUE ─────────────────────────────────────────────────────────────────────
function buildQueue() {
  const mode  = session.mode;
  const topic = document.getElementById('topicFilter').value;

  let pool = QUESTIONS.filter(q => topic === 'all' || q.topic === parseInt(topic));

  if      (mode === 'unseen')   pool = pool.filter(q => getQStat(q.number).attempts === 0);
  else if (mode === 'weak')     pool = pool.filter(q => {
    const s = getQStat(q.number);
    return s.attempts === 0 || (s.correct / s.attempts) < 0.7;
  });
  else if (mode === 'hotspot')  pool = pool.filter(q => q.structured_answer);
  else if (mode === 'bookmark') pool = pool.filter(q => bookmarks.has(q.number));

  if (!pool.length) { alert('No questions match this filter.'); return []; }

  // Weighted shuffle — wrong answers float up
  const arr = pool.map(q => {
    const s = getQStat(q.number);
    if (s.attempts === 0) return { q, w: 1.5 };
    const acc = s.correct / s.attempts;
    return { q, w: acc < 0.5 ? 3 : acc < 0.75 ? 2 : 0.7 };
  });

  const result = [];
  while (arr.length) {
    const total = arr.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < arr.length; i++) {
      r -= arr[i].w;
      if (r <= 0) { result.push(arr[i].q.number); arr.splice(i, 1); break; }
    }
  }
  return result;
}

// ── QUIZ ──────────────────────────────────────────────────────────────────────
function startQuiz() {
  session.mode = document.querySelector('.mode-btn.active')?.dataset.mode || 'all';
  const queue = buildQueue();
  if (!queue.length) return;
  session.queue    = queue;
  session.index    = 0;
  session.isExam   = false;
  session.examAnswers = {};
  stopTimer();
  restoreQActions();
  showView('quizView');
  renderQuestion();
}

function startExam() {
  const shuffled = [...QUESTIONS].sort(() => Math.random() - 0.5);
  session.queue       = shuffled.slice(0, 65).map(q => q.number);
  session.index       = 0;
  session.isExam      = true;
  session.examAnswers = {};
  session.timerSec    = 170 * 60;
  restoreQActions();
  startTimer();
  showView('quizView');
  renderQuestion();
}

function renderQuestion() {
  const num = session.queue[session.index];
  const q   = QUESTIONS.find(x => x.number === num);
  session.answered = false;

  document.getElementById('qNumber').textContent  = `Q #${q.number}`;
  document.getElementById('qTopic').textContent   = `Topic ${q.topic}`;
  document.getElementById('qType').textContent    = q.structured_answer ? 'HOTSPOT' : 'MCQ';
  const s = getQStat(q.number);
  document.getElementById('qHistory').textContent =
    s.attempts ? `${s.attempts}× · ${Math.round(s.correct / s.attempts * 100)}%` : 'New';

  // Bookmark state
  const bmBtn = document.getElementById('btnBookmark');
  const isBm  = bookmarks.has(num);
  bmBtn.textContent = isBm ? '🔖' : '☆';
  bmBtn.classList.toggle('bookmarked', isBm);

  // Question text
  let qText = q.question;
  if (q.structured_answer) {
    const bi = qText.indexOf('•');
    if (bi > 0) qText = qText.slice(0, bi).trim();
  }
  document.getElementById('questionText').textContent = qText;

  // Choices
  const container = document.getElementById('choicesContainer');
  container.innerHTML = '';
  if (q.structured_answer)    renderHotspot(q, container);
  else if (isImageAnswer(q))  renderImageQuestion(q, container);
  else                        renderMCQ(q, container);

  // Reset UI
  document.getElementById('feedbackBox').style.display = 'none';
  document.getElementById('btnSubmit').style.display   = '';
  document.getElementById('btnNext').style.display     = 'none';
  document.getElementById('btnSkip').style.display     = '';
  document.getElementById('kbHint').style.display      = (q.structured_answer || isImageAnswer(q)) ? 'none' : '';

  updateProgress();
  updateHeaderStats();
}

// ── MCQ ───────────────────────────────────────────────────────────────────────
function renderMCQ(q, container) {
  const multi = isMultiSelect(q);
  const correct = getCorrectAnswer(q);
  const needed  = multi ? correct.length : 1;

  container.className = 'choices-mcq';

  if (multi) {
    const hint = document.createElement('div');
    hint.className   = 'multi-hint';
    hint.textContent = `Select ${needed} answers`;
    container.appendChild(hint);
  }

  Object.entries(q.choices).forEach(([letter, text]) => {
    const btn = document.createElement('button');
    btn.className      = 'choice-btn';
    btn.dataset.choice = letter;
    btn.innerHTML      = `<span class="choice-letter">${letter}</span><span class="choice-text">${text}</span>`;
    btn.addEventListener('click', () => {
      if (session.answered) return;
      if (multi) {
        btn.classList.toggle('selected');
      } else {
        container.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      }
    });
    container.appendChild(btn);
  });
}

// ── IMAGE QUESTION ────────────────────────────────────────────────────────────
function renderImageQuestion(q, container) {
  container.className = 'choices-mcq';
  const correct = getCorrectAnswer(q);

  const note = document.createElement('div');
  note.className = 'image-answer-note';
  note.innerHTML = `⚠️ This question's answer is image-based and cannot be verified automatically.
    <br>Community answer: <strong>${correct}</strong>`;
  container.appendChild(note);

  // Still render choices if available (for reading)
  if (q.choices && Object.keys(q.choices).length) {
    Object.entries(q.choices).forEach(([letter, text]) => {
      const btn = document.createElement('button');
      btn.className      = 'choice-btn';
      btn.dataset.choice = letter;
      btn.innerHTML      = `<span class="choice-letter">${letter}</span><span class="choice-text">${text}</span>`;
      btn.addEventListener('click', () => {
        if (session.answered) return;
        container.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
      container.appendChild(btn);
    });
  }
}

// ── HOTSPOT ───────────────────────────────────────────────────────────────────
function renderHotspot(q, container) {
  container.className = 'choices-hotspot';
  const sa = q.structured_answer;

  if (sa.type === 'ordered-steps') {
    const options = extractBulletOptions(q.question);
    sa.steps.forEach((_, i) => {
      const row = document.createElement('div');
      row.className = 'hotspot-row';
      const label = document.createElement('span');
      label.className = 'step-label'; label.textContent = `Step ${i + 1}:`;
      const sel = document.createElement('select');
      sel.dataset.stepIndex = i;
      sel.innerHTML = '<option value="">— Select —</option>';
      options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt.length > 90 ? opt.slice(0, 90) + '…' : opt; o.title = opt;
        sel.appendChild(o);
      });
      row.appendChild(label); row.appendChild(sel); container.appendChild(row);
    });
  } else if (sa.type === 'matching') {
    const opts = extractBulletOptions(q.question);
    const options = opts.length ? opts : [...new Set(sa.matches.map(m => m.answer))];
    sa.matches.forEach((match, i) => {
      const row = document.createElement('div');
      row.className = 'hotspot-row';
      const desc = document.createElement('span');
      desc.className = 'match-description'; desc.textContent = match.description;
      const sel = document.createElement('select');
      sel.dataset.matchIndex = i;
      sel.innerHTML = '<option value="">— Select —</option>';
      options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt.length > 70 ? opt.slice(0, 70) + '…' : opt; o.title = opt;
        sel.appendChild(o);
      });
      row.appendChild(desc); row.appendChild(sel); container.appendChild(row);
    });
  }
}

function extractBulletOptions(text) {
  return text.split('•').slice(1).map(s => s.trim()).filter(Boolean);
}

// ── SUBMIT ────────────────────────────────────────────────────────────────────
async function submitAnswer() {
  if (session.answered) return;
  const num = session.queue[session.index];
  const q   = QUESTIONS.find(x => x.number === num);
  let isCorrect = false;

  if (q.structured_answer) {
    isCorrect = checkHotspot(q);
  } else if (isImageAnswer(q)) {
    // Image questions: always mark as "seen", treat as correct (unverifiable)
    isCorrect = true;
  } else if (isMultiSelect(q)) {
    const selected = [...document.querySelectorAll('.choice-btn.selected')].map(b => b.dataset.choice);
    if (!selected.length) { showToast('Select at least one answer'); return; }
    isCorrect = checkMCQ(q, selected);
  } else {
    const sel = document.querySelector('.choice-btn.selected');
    if (!sel) { showToast('Select an answer (A/B/C/D)'); return; }
    isCorrect = checkMCQ(q, sel.dataset.choice);
  }

  await recordAnswer(q.number, isCorrect);
  session.answered = true;

  if (session.isExam) {
    const correct = getCorrectAnswer(q);
    const fb = document.getElementById('feedbackBox');
    fb.className = `feedback-box feedback-${isCorrect ? 'correct' : 'wrong'}`;
    fb.innerHTML = `<div class="feedback-result">${isCorrect
      ? '✓ Correct'
      : `✗ Wrong — correct: <strong>${correct}</strong>`
    }</div>`;
    fb.style.display = '';
  } else {
    showFeedback(q, isCorrect);
  }

  document.getElementById('btnSubmit').style.display = 'none';
  document.getElementById('btnNext').style.display   = '';
  document.getElementById('btnSkip').style.display   = 'none';
}

// selected = string (single) or array (multi)
function checkMCQ(q, selected) {
  const correct = getCorrectAnswer(q);
  const multi   = Array.isArray(selected);

  // Normalise to sorted letter sets for comparison
  const correctSet  = new Set(correct.split(''));
  const selectedSet = multi ? new Set(selected) : new Set([selected]);
  const isCorrect   = correctSet.size === selectedSet.size && [...correctSet].every(l => selectedSet.has(l));

  document.querySelectorAll('.choice-btn').forEach(btn => {
    const c = btn.dataset.choice;
    if (correctSet.has(c))                        btn.classList.add('correct');
    else if (selectedSet.has(c) && !isCorrect)    btn.classList.add('wrong');
    btn.style.pointerEvents = 'none';
  });
  return isCorrect;
}

function checkHotspot(q) {
  const sa = q.structured_answer;
  let allCorrect = true;
  if (sa.type === 'ordered-steps') {
    document.querySelectorAll('[data-step-index]').forEach((sel, i) => {
      if (sel.value === sa.steps[i]) sel.classList.add('select-correct');
      else { sel.classList.add('select-wrong'); allCorrect = false; }
      sel.disabled = true;
    });
  } else if (sa.type === 'matching') {
    document.querySelectorAll('[data-match-index]').forEach((sel, i) => {
      if (sel.value === sa.matches[i].answer) sel.classList.add('select-correct');
      else { sel.classList.add('select-wrong'); allCorrect = false; }
      sel.disabled = true;
    });
  }
  return allCorrect;
}

function showFeedback(q, isCorrect) {
  const box     = document.getElementById('feedbackBox');
  const correct = getCorrectAnswer(q);
  box.className = `feedback-box feedback-${isCorrect ? 'correct' : 'wrong'}`;

  let html = `<div class="feedback-result">${isCorrect ? '✓ Correct!' : '✗ Incorrect'}</div>`;

  if (!isCorrect) {
    html += '<div class="answer-detail"><strong>Correct Answer: </strong>';
    if (q.structured_answer) {
      const sa = q.structured_answer;
      if (sa.type === 'ordered-steps') sa.steps.forEach((s, i) => { html += `<div>Step ${i+1}: ${s}</div>`; });
      else sa.matches.forEach(m => { html += `<div>"${m.description}" → <strong>${m.answer}</strong></div>`; });
    } else if (isMultiSelect(q)) {
      const letters = correct.split('');
      const descriptions = letters.map(l => `<strong>${l}</strong> — ${q.choices[l] || ''}`).join('<br>');
      html += `<strong>${correct}</strong><br><div style="margin-top:6px">${descriptions}</div>`;
    } else {
      html += `<strong>${correct}</strong> — ${q.choices[correct] || ''}`;
      // Note if community overrode official answer
      if (correct !== q.correct_answer) {
        html += ` <span class="override-note">(community override from ${q.correct_answer})</span>`;
      }
    }
    html += '</div>';
  }

  if (q.explanation) html += `<div class="explanation">${q.explanation}</div>`;

  // Community votes sorted by vote_count descending
  if (q.community_votes && q.community_votes.length) {
    const sorted = [...q.community_votes].sort((a, b) => b.vote_count - a.vote_count);
    const vStr   = sorted.map(v => `<strong>${v.voted_answers}</strong>: ${v.vote_count}`).join(' · ');
    html += `<div class="explanation">👥 Votes: ${vStr}</div>`;
  }

  box.innerHTML = html;
  box.style.display = '';
}

function nextQuestion() {
  session.index++;
  if (session.isExam && session.index >= session.queue.length) {
    showExamResults(); return;
  }
  if (!session.isExam && session.index >= session.queue.length) {
    const newQ = buildQueue();
    session.queue = newQ.length ? newQ : session.queue;
    session.index = 0;
  }
  renderQuestion();
}

function skipQuestion() {
  if (session.isExam) { nextQuestion(); return; }
  const cur = session.queue.splice(session.index, 1)[0];
  session.queue.push(cur);
  if (session.index >= session.queue.length) session.index = 0;
  renderQuestion();
}

// ── EXAM / TIMER ──────────────────────────────────────────────────────────────
function startTimer() {
  const display = document.getElementById('examTimerDisplay');
  const val     = document.getElementById('timerVal');
  display.style.display = '';
  stopTimer();
  val.textContent = formatTime(session.timerSec);

  session.timerInterval = setInterval(() => {
    session.timerSec--;
    val.textContent = formatTime(session.timerSec);
    display.classList.toggle('timer-warn', session.timerSec <= 300);
    if (session.timerSec <= 0) { stopTimer(); showExamResults(); }
  }, 1000);
}

function stopTimer() {
  if (session.timerInterval) { clearInterval(session.timerInterval); session.timerInterval = null; }
  const d = document.getElementById('examTimerDisplay');
  if (d) { d.style.display = 'none'; d.classList.remove('timer-warn'); }
}

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function showExamResults() {
  stopTimer();
  session.isExam = false;

  let correct = 0, wrong = 0, unanswered = 0;
  session.queue.forEach(num => {
    const q   = QUESTIONS.find(x => x.number === num);
    const sel = session.examAnswers[num];
    if (!sel) { unanswered++; }
    else if (sel === q.correct_answer) correct++;
    else wrong++;
  });

  const total  = session.queue.length;
  const pct    = Math.round(correct / total * 100);
  const passed = pct >= 72;
  const color  = passed ? 'var(--success)' : 'var(--error)';

  const rows = session.queue.map(num => {
    const q       = QUESTIONS.find(x => x.number === num);
    const sel     = session.examAnswers[num];
    const correct = getCorrectAnswer(q);
    const ok      = sel === correct;
    return `<tr>
      <td><strong>#${num}</strong></td>
      <td style="color:${ok ? 'var(--success)' : 'var(--error)'}">${ok ? '✓' : '✗'}</td>
      <td>You: <strong>${sel || '—'}</strong></td>
      <td>Answer: <strong>${correct}</strong></td>
    </tr>`;
  }).join('');

  document.getElementById('questionCard').innerHTML = `
    <div style="text-align:center;padding:20px 8px 28px">
      <div style="font-size:2.8rem;margin-bottom:12px">${passed ? '🎉' : '📖'}</div>
      <h2 style="font-size:1.5rem">${passed ? 'Passed!' : 'Keep practicing!'}</h2>
      <div style="font-size:3.2rem;font-weight:700;color:${color};margin:14px 0;line-height:1">${pct}%</div>
      <p style="color:var(--text-muted);font-size:.95rem">
        ✅ ${correct} correct &nbsp;·&nbsp; ❌ ${wrong} wrong &nbsp;·&nbsp; — ${unanswered} skipped
        <br><span style="font-size:.85rem">Passing score: 72% (${Math.ceil(total * 0.72)}/${total})</span>
      </p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:22px">
        <button class="btn-primary" onclick="startExam()">Retry Exam</button>
        <button class="btn-primary" onclick="startQuiz()">Practice Mode</button>
        <button class="btn-ghost" style="color:var(--text);border-color:var(--border)" onclick="showAnalytics()">Analytics</button>
      </div>
    </div>
    <div style="margin-top:4px">
      <div style="font-size:.85rem;font-weight:600;color:var(--text-muted);margin-bottom:10px;padding:0 4px">Question Results</div>
      <div style="max-height:360px;overflow-y:auto;border:1px solid var(--border);border-radius:8px">
        <table style="width:100%;font-size:.85rem;border-collapse:collapse">
          <thead><tr style="background:var(--bg)">
            <th style="text-align:left;padding:8px 12px;border-bottom:1px solid var(--border)">#</th>
            <th style="text-align:left;padding:8px 12px;border-bottom:1px solid var(--border)">Result</th>
            <th style="text-align:left;padding:8px 12px;border-bottom:1px solid var(--border)">Your Answer</th>
            <th style="text-align:left;padding:8px 12px;border-bottom:1px solid var(--border)">Correct</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
  document.querySelector('.q-actions').style.display = 'none';
}

function restoreQActions() {
  const qa = document.querySelector('.q-actions');
  if (qa) qa.style.display = '';
}

// ── KEYBOARD SHORTCUTS ────────────────────────────────────────────────────────
function handleKeyboard(e) {
  if (document.getElementById('quizView').style.display === 'none') return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const key = e.key.toUpperCase();

  // A/C/D or 1/2/3/4 — select choice (B handled separately below)
  if (['A', 'C', 'D', '1', '2', '3', '4'].includes(key) && !session.answered) {
    const letter = key >= '1' && key <= '4'
      ? String.fromCharCode(64 + parseInt(key))
      : key;
    const btn = document.querySelector(`.choice-btn[data-choice="${letter}"]`);
    if (btn) { e.preventDefault(); btn.click(); }
    return;
  }

  // Special case for B: choice B (if not answered) or bookmark (if answered / no choice B)
  if (e.key === 'b' || e.key === 'B') {
    if (!session.answered) {
      const choiceB = document.querySelector('.choice-btn[data-choice="B"]');
      if (choiceB) { e.preventDefault(); choiceB.click(); return; }
    }
    e.preventDefault();
    document.getElementById('btnBookmark').click();
    return;
  }

  // Enter / Space — submit or next
  if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
    e.preventDefault();
    if (!session.answered) document.getElementById('btnSubmit').click();
    else document.getElementById('btnNext').click();
    return;
  }

  // → or S — skip
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (!session.answered) document.getElementById('btnSkip').click();
    else document.getElementById('btnNext').click();
  }
}

// ── PROGRESS ──────────────────────────────────────────────────────────────────
function updateProgress() {
  const pct = session.queue.length ? ((session.index + 1) / session.queue.length) * 100 : 0;
  document.getElementById('progressFill').style.width = pct + '%';
}

function updateHeaderStats() {
  const attempted     = Object.keys(stats).length;
  const totalCorrect  = Object.values(stats).reduce((s, x) => s + x.correct, 0);
  const totalAttempts = Object.values(stats).reduce((s, x) => s + x.attempts, 0);
  const acc = totalAttempts ? Math.round(totalCorrect / totalAttempts * 100) : 0;
  const examTag = session.isExam ? ' · EXAM MODE' : '';
  document.getElementById('headerStats').textContent =
    `${attempted}/230 practiced · ${acc}%${examTag}`;
}

// ── ANALYTICS ─────────────────────────────────────────────────────────────────
function showAnalytics() { showView('analyticsView'); }

function renderAnalytics() {
  renderSummaryCards();
  renderAnalyticsTable();
}

function renderSummaryCards() {
  const attempted     = Object.keys(stats).length;
  const totalAttempts = Object.values(stats).reduce((s, x) => s + x.attempts, 0);
  const totalCorrect  = Object.values(stats).reduce((s, x) => s + x.correct, 0);
  const acc     = totalAttempts ? Math.round(totalCorrect / totalAttempts * 100) : 0;
  const mastered = QUESTIONS.filter(q => {
    const s = getQStat(q.number);
    return s.attempts >= 3 && (s.correct / s.attempts) >= 0.8;
  }).length;
  const weak = QUESTIONS.filter(q => {
    const s = getQStat(q.number);
    return s.attempts > 0 && (s.correct / s.attempts) < 0.7;
  }).length;

  document.getElementById('summaryCards').innerHTML = `
    <div class="stat-card"><div class="stat-value">${attempted}</div><div class="stat-label">Practiced</div></div>
    <div class="stat-card"><div class="stat-value">${totalAttempts}</div><div class="stat-label">Total Answers</div></div>
    <div class="stat-card"><div class="stat-value">${acc}%</div><div class="stat-label">Accuracy</div></div>
    <div class="stat-card"><div class="stat-value">${mastered}</div><div class="stat-label">Mastered (≥80%)</div></div>
    <div class="stat-card"><div class="stat-value">${weak}</div><div class="stat-label">Need Practice</div></div>
    <div class="stat-card"><div class="stat-value">${230 - attempted}</div><div class="stat-label">Not Seen</div></div>
  `;
}

function renderAnalyticsTable() {
  const sortBy       = document.getElementById('sortBy').value;
  const filterStatus = document.getElementById('filterStatus').value;
  const search       = document.getElementById('searchQ').value.toLowerCase();

  let rows = QUESTIONS.map(q => {
    const s   = getQStat(q.number);
    const acc = s.attempts ? s.correct / s.attempts : null;
    let status = 'unseen';
    if (s.attempts > 0) status = acc >= 0.8 && s.attempts >= 2 ? 'ok' : acc < 0.7 ? 'weak' : 'partial';
    return { q, s, acc, status };
  });

  if (filterStatus === 'bookmark') rows = rows.filter(r => bookmarks.has(r.q.number));
  else if (filterStatus !== 'all') rows = rows.filter(r => r.status === filterStatus);
  if (search) rows = rows.filter(r =>
    r.q.question.toLowerCase().includes(search) || String(r.q.number).includes(search)
  );

  if      (sortBy === 'wrong')    rows.sort((a, b) => (a.acc ?? 1) - (b.acc ?? 1));
  else if (sortBy === 'right')    rows.sort((a, b) => (b.acc ?? -1) - (a.acc ?? -1));
  else if (sortBy === 'attempts') rows.sort((a, b) => b.s.attempts - a.s.attempts);
  else                            rows.sort((a, b) => a.q.number - b.q.number);

  const dotClass = { ok: 'dot-ok', weak: 'dot-weak', unseen: 'dot-unseen', partial: 'dot-partial' };
  const dotTitle = { ok: 'Mastered', weak: 'Needs practice', unseen: 'Not seen', partial: 'In progress' };

  const tbody = rows.map(({ q, s, acc, status }) => {
    const accPct  = acc !== null ? Math.round(acc * 100) : null;
    const accColor = acc === null ? '#cbd5e1' : acc >= 0.8 ? '#16a34a' : acc >= 0.5 ? '#f59e0b' : '#dc2626';
    const accBar  = acc !== null
      ? `<div class="acc-bar-wrap">
           <div class="acc-bar"><div class="acc-fill" style="width:${accPct}%;background:${accColor}"></div></div>
           <span class="acc-text" style="color:${accColor}">${accPct}%</span>
         </div>`
      : '<span style="color:#94a3b8;font-size:.8rem">—</span>';

    const badge  = q.structured_answer ? '<span class="badge-hotspot">HOTSPOT</span>' : '<span class="badge-mcq">MCQ</span>';
    const bmMark = bookmarks.has(q.number) ? ' <span style="font-size:.8rem">🔖</span>' : '';
    const qPrev  = q.question.replace(/\n/g, ' ').slice(0, 80) + '…';

    return `<tr data-qnum="${q.number}">
      <td><strong>#${q.number}</strong>${bmMark}</td>
      <td>${badge}</td>
      <td class="q-text-cell" title="${q.question.replace(/"/g, '&quot;')}">${qPrev}</td>
      <td>${s.attempts || '—'}</td>
      <td>${accBar}</td>
      <td><span class="status-dot ${dotClass[status]}" title="${dotTitle[status]}"></span></td>
    </tr>`;
  }).join('');

  document.getElementById('analyticsTable').innerHTML = `
    <table>
      <thead><tr>
        <th>#</th><th>Type</th><th>Question</th>
        <th>Tries</th><th>Accuracy</th><th>Status</th>
      </tr></thead>
      <tbody>${tbody}</tbody>
    </table>`;

  document.querySelectorAll('#analyticsTable tr[data-qnum]').forEach(tr => {
    tr.addEventListener('click', () => {
      const num = parseInt(tr.dataset.qnum);
      session.queue    = [num];
      session.index    = 0;
      session.answered = false;
      session.isExam   = false;
      stopTimer();
      restoreQActions();
      showView('quizView');
      renderQuestion();
    });
  });
}

// ── EXPORT / IMPORT ───────────────────────────────────────────────────────────
function exportProgress() {
  const data = {
    stats,
    bookmarks: [...bookmarks],
    exportedAt: new Date().toISOString(),
    version: 1,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `mla-progress-${new Date().toISOString().slice(0,10)}.json` });
  a.click();
  URL.revokeObjectURL(url);
  showToast('Progress exported!');
}

async function importProgress(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.stats) throw new Error('Invalid file');

    const dateStr = data.exportedAt ? new Date(data.exportedAt).toLocaleDateString() : 'unknown date';
    if (!confirm(`Import progress from ${dateStr}?\nThis will overwrite your current data.`)) {
      e.target.value = ''; return;
    }

    stats = data.stats;
    if (data.bookmarks) bookmarks = new Set(data.bookmarks);

    // Sync to server
    if (serverMode) {
      try {
        await fetch(`${API_BASE}/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stats }),
        });
      } catch { /* server unavailable, use local */ }
    }
    saveLocal();
    localStorage.setItem('mla_bookmarks', JSON.stringify([...bookmarks]));
    updateHomeCounts();
    updateHeaderStats();
    showToast('Progress imported!');
  } catch {
    showToast('Invalid file');
  }
  e.target.value = '';
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e293b;color:white;padding:10px 20px;border-radius:8px;font-size:.9rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.3);white-space:nowrap';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}
