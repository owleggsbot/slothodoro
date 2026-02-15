/* Slothodoro — calm, sloth-soft Pomodoro timer.
   Static-only (GitHub Pages). No accounts. Stats are local.
*/

// -------------------------
// PWA
// -------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// -------------------------
// Helpers
// -------------------------
const $ = (id) => document.getElementById(id);
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const pad2 = (n) => String(n).padStart(2, '0');
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
};

const dateKeyFromISO = (iso) => {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  } catch {
    return null;
  }
};

function fmtClock(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  } catch {
    return '';
  }
}

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${pad2(m)}:${pad2(r)}`;
}

function b64urlEncode(str) {
  const u8 = new TextEncoder().encode(str);
  let bin = '';
  u8.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function b64urlDecode(b64url) {
  const b64 = b64url.replaceAll('-', '+').replaceAll('_', '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const u8 = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(u8);
}

// -------------------------
// Elements
// -------------------------
const el = {
  time: $('time'),
  modeLabel: $('modeLabel'),
  hint: $('hint'),

  ringProg: $('ringProg'),

  btnStart: $('btnStart'),
  btnPause: $('btnPause'),
  btnReset: $('btnReset'),
  btnSkip: $('btnSkip'),
  btnMinus1: $('btnMinus1'),
  btnPlus1: $('btnPlus1'),

  focusMin: $('focusMin'),
  breakMin: $('breakMin'),
  longEvery: $('longEvery'),
  longBreakMin: $('longBreakMin'),
  sound: $('sound'),
  tick: $('tick'),
  tickVol: $('tickVol'),
  slowMode: $('slowMode'),
  notify: $('notify'),
  keepAwake: $('keepAwake'),
  autoStart: $('autoStart'),

  statTodaySessions: $('statTodaySessions'),
  statTodayMinutes: $('statTodayMinutes'),
  todayList: $('todayList'),
  todayChart: $('todayChart'),

  statFocus: $('statFocus'),
  statMinutes: $('statMinutes'),
  statStreak: $('statStreak'),
  btnClear: $('btnClear'),

  btnShare: $('btnShare'),
  shareDialog: $('shareDialog'),
  shareCanvas: $('shareCanvas'),
};

// -------------------------
// State
// -------------------------
const STORAGE_KEY = 'slothodoro:v1';

const defaultState = {
  settings: {
    focusMin: 25,
    breakMin: 5,
    longEvery: 4,
    longBreakMin: 15,
    sound: true,
    tick: false,
    tickVol: 12,
    slowMode: false,
    notify: false,
    keepAwake: false,
    autoStart: false,
  },
  stats: {
    focusSessions: 0,
    focusMinutes: 0,
    streakDate: null,
    streakCount: 0,
  },
  // Local-only history of completed focus sessions.
  // Each entry: { at: ISOString, focusMin: number }
  history: [],
  cyclesSinceLong: 0,
  lastResult: null,
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(defaultState),
      ...parsed,
      settings: { ...defaultState.settings, ...(parsed.settings || {}) },
      stats: { ...defaultState.stats, ...(parsed.stats || {}) },
      history: Array.isArray(parsed.history) ? parsed.history : structuredClone(defaultState.history),
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

// -------------------------
// Timer engine
// -------------------------
let phase = 'focus'; // focus | break | longbreak
let remainingMs = state.settings.focusMin * 60 * 1000;
let running = false;
let endAt = null;
let raf = null;
let to = null;
let wakeLock = null;
let lastWholeSecond = null;

function scheduleTick() {
  if (state.settings.slowMode) {
    to = setTimeout(tick, 250);
  } else {
    raf = requestAnimationFrame(tick);
  }
}

async function ensureWakeLock() {
  if (!state.settings.keepAwake) return;
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    // ignore
  }
}

async function releaseWakeLock() {
  try {
    await wakeLock?.release?.();
  } catch {
    // ignore
  }
  wakeLock = null;
}

function phaseLabel(p) {
  if (p === 'focus') return 'Focus';
  if (p === 'break') return 'Break';
  return 'Long break';
}

function getPhaseDurationMs(p) {
  if (p === 'focus') return clamp(state.settings.focusMin, 1, 180) * 60 * 1000;
  if (p === 'break') return clamp(state.settings.breakMin, 1, 60) * 60 * 1000;
  return clamp(state.settings.longBreakMin, 5, 90) * 60 * 1000;
}

function setPhase(p, { resetClock = true } = {}) {
  phase = p;
  if (resetClock) remainingMs = getPhaseDurationMs(p);
  running = false;
  endAt = null;
  if (raf) cancelAnimationFrame(raf);
  if (to) clearTimeout(to);
  raf = null;
  to = null;
  releaseWakeLock();
  lastWholeSecond = Math.ceil(remainingMs / 1000);
  render();
}

function start() {
  if (running) return;
  running = true;
  endAt = Date.now() + remainingMs;
  lastWholeSecond = Math.ceil(remainingMs / 1000);
  ensureTickAudio();
  ensureWakeLock();
  tick();
  render();
}

function pause() {
  if (!running) return;
  running = false;
  remainingMs = Math.max(0, endAt - Date.now());
  endAt = null;
  if (raf) cancelAnimationFrame(raf);
  if (to) clearTimeout(to);
  raf = null;
  to = null;
  releaseWakeLock();
  lastWholeSecond = Math.ceil(remainingMs / 1000);
  render();
}

function reset() {
  pause();
  remainingMs = getPhaseDurationMs(phase);
  lastWholeSecond = Math.ceil(remainingMs / 1000);
  render();
}

function skipPhase() {
  // Skip is intentionally "gentle": it moves to the next phase.
  // If you skip focus, we do NOT count it toward stats/streak.
  const wasRunning = running;
  if (wasRunning) pause();
  remainingMs = 0;
  lastWholeSecond = 0;
  onPhaseComplete({ countFocus: phase !== 'focus' ? true : false });
}

function nudgeRemainingMinutes(deltaMin) {
  const deltaMs = deltaMin * 60 * 1000;

  // Keep things sane: never below 0, and cap at 6 hours.
  remainingMs = clamp(remainingMs + deltaMs, 0, 6 * 60 * 60 * 1000);

  if (running && endAt) {
    endAt = endAt + deltaMs;
    // If we nudged below zero, complete immediately.
    if (endAt <= Date.now()) {
      remainingMs = 0;
      running = false;
      endAt = null;
      if (raf) cancelAnimationFrame(raf);
      if (to) clearTimeout(to);
      raf = null;
      to = null;
      onPhaseComplete();
      return;
    }
  }

  render();
}

function tick() {
  if (!running) return;
  remainingMs = Math.max(0, endAt - Date.now());

  // Tiny focus tick: fire once per whole-second change (not every rAF frame).
  const wholeSec = Math.ceil(remainingMs / 1000);
  if (phase === 'focus' && state.settings.tick && wholeSec !== lastWholeSecond && remainingMs > 0) {
    playTick();
  }
  lastWholeSecond = wholeSec;

  if (remainingMs <= 0) {
    running = false;
    endAt = null;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    onPhaseComplete();
    return;
  }
  render();
  scheduleTick();
}

// -------------------------
// Sound
// -------------------------
let tickCtx = null;
let tickGain = null;

function tickVolumeGain() {
  // UI is 0–100. Keep it very quiet: map to 0.0–0.12.
  const v = clamp(Number(state.settings.tickVol ?? 0), 0, 100);
  return (v / 100) * 0.12;
}

function ensureTickAudio() {
  if (!state.settings.tick) return;
  try {
    if (!tickCtx) tickCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (tickCtx.state === 'suspended') tickCtx.resume().catch(() => {});
    if (!tickGain) {
      tickGain = tickCtx.createGain();
      tickGain.gain.setValueAtTime(0.0001, tickCtx.currentTime);
      tickGain.connect(tickCtx.destination);
    }
  } catch {
    // ignore
  }
}

function playTick() {
  if (!state.settings.tick) return;
  try {
    ensureTickAudio();
    if (!tickCtx || !tickGain) return;

    const now = tickCtx.currentTime;
    const o = tickCtx.createOscillator();
    const g = tickCtx.createGain();

    // A tiny, soft click. High-ish frequency, super short envelope.
    o.type = 'triangle';
    o.frequency.setValueAtTime(1800, now);

    const vol = Math.max(0.0001, tickVolumeGain());
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);

    o.connect(g);
    g.connect(tickGain);

    o.start(now);
    o.stop(now + 0.04);
  } catch {
    // ignore
  }
}

function softChime() {
  if (!state.settings.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();

    o1.type = 'sine';
    o2.type = 'triangle';
    o1.frequency.setValueAtTime(523.25, now); // C5
    o2.frequency.setValueAtTime(659.25, now); // E5

    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);

    o1.connect(g);
    o2.connect(g);
    g.connect(ctx.destination);

    o1.start(now);
    o2.start(now + 0.02);
    o1.stop(now + 0.9);
    o2.stop(now + 0.9);

    setTimeout(() => ctx.close().catch(()=>{}), 1200);
  } catch {
    // ignore
  }
}

function maybeNotify(title, body) {
  if (!state.settings.notify) return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  // don't be annoying if the tab is focused
  if (!document.hidden) return;
  try {
    new Notification(title, { body, icon: './favicon.svg' });
  } catch {
    // ignore
  }
}

// -------------------------
// Completion & stats
// -------------------------
function bumpStreak() {
  const t = todayKey();
  if (state.stats.streakDate !== t) {
    state.stats.streakDate = t;
    state.stats.streakCount = 0;
  }
  state.stats.streakCount += 1;
}

function onPhaseComplete({ countFocus = true } = {}) {
  softChime();

  if (phase === 'focus') {
    // If the user skips focus, don't count stats/streak.
    if (!countFocus) {
      saveState();
      setPhase('break');
      el.hint.textContent = 'Break time. Blink slowly. Hydrate.';
      if (state.settings.autoStart) start();
      return;
    }

    maybeNotify('Slothodoro: Focus finished', 'Break time. Blink slowly. Hydrate.');
    const minutes = clamp(state.settings.focusMin, 1, 180);
    state.stats.focusSessions += 1;
    state.stats.focusMinutes += minutes;
    bumpStreak();

    // Record session in local-only history
    state.history = Array.isArray(state.history) ? state.history : [];
    state.history.push({ at: new Date().toISOString(), focusMin: minutes });
    // keep the history bounded so localStorage doesn't bloat
    if (state.history.length > 500) state.history = state.history.slice(-500);

    const result = {
      at: new Date().toISOString(),
      focusMin: minutes,
      breakMin: clamp(state.settings.breakMin, 1, 60),
      totalFocusSessions: state.stats.focusSessions,
      streakToday: state.stats.streakCount,
    };

    state.lastResult = result;
    try {
      const encoded = b64urlEncode(JSON.stringify(result));
      history.replaceState(null, '', `#r=${encoded}`);
    } catch {}

    // Decide next phase
    let next = 'break';
    let hint = 'Break time. Blink slowly. Hydrate.';
    const le = Number(state.settings.longEvery || 0);
    if (le > 0) {
      state.cyclesSinceLong = (state.cyclesSinceLong || 0) + 1;
      if (state.cyclesSinceLong >= le) {
        state.cyclesSinceLong = 0;
        next = 'longbreak';
        hint = 'Long break time. You earned it.';
      }
    }

    saveState();
    setPhase(next);
    el.hint.textContent = hint;
    if (state.settings.autoStart) start();
    return;
  }

  // Completed a break (or long break)
  maybeNotify('Slothodoro: Break finished', 'Back to focus. Slow and steady.');
  saveState();
  setPhase('focus');
  el.hint.textContent = 'Back to focus. Slow and steady.';
  if (state.settings.autoStart) start();
}

// -------------------------
// Share card
// -------------------------
function drawShareCard() {
  const c = el.shareCanvas;
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;

  // bg
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, w, h);

  // subtle gradient
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, 'rgba(125, 255, 200, 0.12)');
  g.addColorStop(1, 'rgba(140, 200, 255, 0.08)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // card
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  roundRect(ctx, 80, 90, w - 160, h - 180, 28);
  ctx.fill();

  ctx.fillStyle = '#e9f2ff';
  ctx.font = '700 72px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('Slothodoro', 140, 210);

  ctx.font = '500 34px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillStyle = 'rgba(233,242,255,0.85)';
  ctx.fillText('calm focus, sloth pace', 140, 260);

  const r = state.lastResult;
  const focusMin = r?.focusMin ?? clamp(state.settings.focusMin, 1, 180);
  const sessions = state.stats.focusSessions;
  const streak = (state.stats.streakDate === todayKey()) ? state.stats.streakCount : 0;

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 120px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText(`${focusMin} min`, 140, 420);

  ctx.fillStyle = 'rgba(233,242,255,0.85)';
  ctx.font = '600 36px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText(`Focus sessions (all time): ${sessions}`, 140, 485);
  ctx.fillText(`Streak today: ${streak}`, 140, 535);

  // sloth emoji stamp
  ctx.font = '140px system-ui, -apple-system, Segoe UI, Apple Color Emoji, Noto Color Emoji';
  ctx.fillText('🦥', w - 280, 450);

  ctx.fillStyle = 'rgba(233,242,255,0.65)';
  ctx.font = '24px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('No accounts • Local-only stats • owleggsbot.github.io/slothodoro', 140, h - 120);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// -------------------------
// Render & wiring
// -------------------------
function renderTodayChart(todays) {
  if (!el.todayChart) return;

  // Bucket minutes by hour (local time). Each entry: 0..23
  const bins = Array.from({ length: 24 }, () => 0);
  for (const h of todays) {
    try {
      const d = new Date(h.at);
      if (Number.isNaN(d.getTime())) continue;
      const hour = d.getHours();
      const mins = Number(h.focusMin) || 0;
      if (hour >= 0 && hour <= 23) bins[hour] += Math.max(0, mins);
    } catch {}
  }

  const w = 240;
  const h = 44;
  const pad = 6;
  const innerH = h - pad * 2;
  const barW = 8;
  const gap = 2;
  const maxBarsW = 24 * barW + 23 * gap;
  const left = Math.floor((w - maxBarsW) / 2);

  const maxVal = Math.max(10, ...bins); // avoid divide-by-zero + keep subtle scaling
  const nowHour = new Date().getHours();

  const parts = [];
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" rx="8" ry="8" fill="rgba(255,255,255,0.03)"/>`);
  parts.push(`<line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="rgba(233,242,255,0.18)" stroke-width="1"/>`);

  // Current hour marker
  if (nowHour >= 0 && nowHour <= 23) {
    const x = left + nowHour * (barW + gap) + Math.floor(barW / 2);
    parts.push(`<line x1="${x}" y1="${pad}" x2="${x}" y2="${h - pad}" stroke="rgba(204,255,170,0.22)" stroke-width="1"/>`);
  }

  for (let i = 0; i < 24; i++) {
    const val = bins[i];
    const bh = Math.max(1, Math.round((val / maxVal) * (innerH - 2)));
    const x = left + i * (barW + gap);
    const y = h - pad - bh;
    const fill = val > 0 ? 'rgba(233,242,255,0.75)' : 'rgba(233,242,255,0.12)';
    parts.push(`<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="2" ry="2" fill="${fill}"/>`);
  }

  el.todayChart.innerHTML = parts.join('');
}

function renderToday() {
  const t = todayKey();
  const hist = Array.isArray(state.history) ? state.history : [];
  const todays = hist.filter(h => dateKeyFromISO(h.at) === t);

  const sessions = todays.length;
  const minutes = todays.reduce((sum, h) => sum + (Number(h.focusMin) || 0), 0);

  if (el.statTodaySessions) el.statTodaySessions.textContent = String(sessions);
  if (el.statTodayMinutes) el.statTodayMinutes.textContent = String(minutes);

  renderTodayChart(todays);

  if (el.todayList) {
    el.todayList.innerHTML = '';
    if (todays.length === 0) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="m">No sessions yet today. Slow and steady.</span><span class="t">—</span>';
      el.todayList.appendChild(li);
    } else {
      // newest first
      for (const h of [...todays].reverse().slice(0, 10)) {
        const li = document.createElement('li');
        const mins = Number(h.focusMin) || 0;
        li.innerHTML = `<span class="m">${mins} min focus</span><span class="t">${fmtClock(h.at)}</span>`;
        el.todayList.appendChild(li);
      }
    }
  }
}

function renderStats() {
  renderToday();
  el.statFocus.textContent = String(state.stats.focusSessions);
  el.statMinutes.textContent = String(state.stats.focusMinutes);
  const streak = (state.stats.streakDate === todayKey()) ? state.stats.streakCount : 0;
  el.statStreak.textContent = String(streak);
}

function render() {
  el.time.textContent = fmtTime(remainingMs);
  el.modeLabel.textContent = phaseLabel(phase);

  // Progress ring
  try {
    const CIRC = 302; // matches CSS stroke-dasharray
    const total = getPhaseDurationMs(phase);
    const pct = total > 0 ? (remainingMs / total) : 0;
    const off = CIRC * (1 - clamp(pct, 0, 1));
    if (el.ringProg) el.ringProg.style.strokeDashoffset = String(off);
  } catch {}

  // Helpful tab title (nice for keeping it in the background)
  document.title = `${fmtTime(remainingMs)} • ${phaseLabel(phase)} — Slothodoro`;

  el.btnStart.disabled = running;
  el.btnPause.disabled = !running;

  renderStats();
}

function syncSettingsToUI() {
  el.focusMin.value = String(state.settings.focusMin);
  el.breakMin.value = String(state.settings.breakMin);
  el.longEvery.value = String(state.settings.longEvery);
  el.longBreakMin.value = String(state.settings.longBreakMin);
  el.sound.checked = !!state.settings.sound;
  el.tick.checked = !!state.settings.tick;
  el.tickVol.value = String(clamp(Number(state.settings.tickVol ?? 12), 0, 100));
  el.tickVol.disabled = !el.tick.checked;
  el.slowMode.checked = !!state.settings.slowMode;
  el.notify.checked = !!state.settings.notify;
  el.keepAwake.checked = !!state.settings.keepAwake;
  el.autoStart.checked = !!state.settings.autoStart;
}


function applySettingsFromUI({ resetClockIfIdle = true } = {}) {
  state.settings.focusMin = clamp(Number(el.focusMin.value || 25), 1, 180);
  state.settings.breakMin = clamp(Number(el.breakMin.value || 5), 1, 60);
  state.settings.longEvery = clamp(Number(el.longEvery.value || 0), 0, 8);
  state.settings.longBreakMin = clamp(Number(el.longBreakMin.value || 15), 5, 90);
  state.settings.sound = !!el.sound.checked;
  state.settings.tick = !!el.tick.checked;
  state.settings.tickVol = clamp(Number(el.tickVol.value ?? 12), 0, 100);
  el.tickVol.disabled = !state.settings.tick;
  state.settings.slowMode = !!el.slowMode.checked;
  state.settings.notify = !!el.notify.checked;
  state.settings.keepAwake = !!el.keepAwake.checked;
  state.settings.autoStart = !!el.autoStart.checked;
  saveState();

  document.documentElement.classList.toggle('slow', state.settings.slowMode);

  if (!running && resetClockIfIdle) {
    remainingMs = getPhaseDurationMs(phase);
  }
  render();
}

// Event listeners
el.btnStart.addEventListener('click', () => start());
el.btnPause.addEventListener('click', () => pause());
el.btnReset.addEventListener('click', () => reset());
el.btnSkip.addEventListener('click', () => skipPhase());
el.btnMinus1?.addEventListener('click', () => nudgeRemainingMinutes(-1));
el.btnPlus1?.addEventListener('click', () => nudgeRemainingMinutes(1));

// Keyboard: space = start/pause, r = reset, e = export
document.addEventListener('keydown', (ev) => {
  const tag = (ev.target?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  if (ev.key === ' ' || ev.code === 'Space') {
    ev.preventDefault();
    running ? pause() : start();
  }
  if (ev.key?.toLowerCase() === 'r') {
    ev.preventDefault();
    reset();
  }
  if (ev.key?.toLowerCase() === 'e') {
    ev.preventDefault();
    drawShareCard();
    el.shareDialog.showModal();
  }
  if (ev.key?.toLowerCase() === 's') {
    ev.preventDefault();
    skipPhase();
  }
});

for (const btn of document.querySelectorAll('[data-preset]')) {
  btn.addEventListener('click', () => {
    const preset = btn.getAttribute('data-preset');
    if (preset === 'classic') {
      el.focusMin.value = '25';
      el.breakMin.value = '5';
      el.longEvery.value = '4';
      el.longBreakMin.value = '15';
    } else if (preset === 'deep') {
      el.focusMin.value = '50';
      el.breakMin.value = '10';
      el.longEvery.value = '2';
      el.longBreakMin.value = '20';
    } else if (preset === 'gentle') {
      el.focusMin.value = '15';
      el.breakMin.value = '5';
      el.longEvery.value = '0';
      el.longBreakMin.value = '15';
    }
    applySettingsFromUI();
    el.hint.textContent = 'Preset applied.';
  });
}

for (const input of [el.focusMin, el.breakMin, el.longEvery, el.longBreakMin, el.sound, el.tick, el.tickVol, el.slowMode, el.notify, el.keepAwake, el.autoStart]) {
  input.addEventListener('change', async () => {
    if (input === el.notify && input.checked && 'Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {}
    }
    applySettingsFromUI();
    if (running) {
      // apply wake lock preference immediately
      if (state.settings.keepAwake) ensureWakeLock();
      else releaseWakeLock();

      // If tick got enabled mid-session, we may need to create/resume audio.
      ensureTickAudio();
    }
  });
}

// Range sliders feel better when they apply while dragging.
el.tickVol.addEventListener('input', () => {
  applySettingsFromUI({ resetClockIfIdle: false });
});

el.btnClear.addEventListener('click', () => {
  if (!confirm('Clear local stats and settings on this device?')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = loadState();
  syncSettingsToUI();
  setPhase('focus');
  el.hint.textContent = 'Local stats cleared.';
});

el.btnShare.addEventListener('click', () => {
  // redraw fresh each open
  drawShareCard();
  el.shareDialog.showModal();
});

// Load share result from URL hash (optional)
(function initFromHash() {
  const m = location.hash.match(/#r=([A-Za-z0-9_-]+)/);
  if (!m) return;
  try {
    const parsed = JSON.parse(b64urlDecode(m[1]));
    if (parsed && typeof parsed === 'object') {
      state.lastResult = parsed;
      saveState();
      el.hint.textContent = 'Loaded your last result from the URL.';
    }
  } catch {}
})();

syncSettingsToUI();
document.documentElement.classList.toggle('slow', !!state.settings.slowMode);
setPhase('focus');
render();

// Re-acquire wake lock on visibility regain
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && running) ensureWakeLock();
});
