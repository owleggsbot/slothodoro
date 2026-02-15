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

  focusMin: $('focusMin'),
  breakMin: $('breakMin'),
  longEvery: $('longEvery'),
  longBreakMin: $('longBreakMin'),
  sound: $('sound'),
  slowMode: $('slowMode'),

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
    slowMode: false,
  },
  stats: {
    focusSessions: 0,
    focusMinutes: 0,
    streakDate: null,
    streakCount: 0,
  },
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
  raf = null;
  render();
}

function start() {
  if (running) return;
  running = true;
  endAt = Date.now() + remainingMs;
  tick();
  render();
}

function pause() {
  if (!running) return;
  running = false;
  remainingMs = Math.max(0, endAt - Date.now());
  endAt = null;
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  render();
}

function reset() {
  pause();
  remainingMs = getPhaseDurationMs(phase);
  render();
}

function tick() {
  if (!running) return;
  remainingMs = Math.max(0, endAt - Date.now());
  if (remainingMs <= 0) {
    running = false;
    endAt = null;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    onPhaseComplete();
    return;
  }
  render();
  raf = requestAnimationFrame(tick);
}

// -------------------------
// Sound
// -------------------------
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

function onPhaseComplete() {
  softChime();

  if (phase === 'focus') {
    const minutes = clamp(state.settings.focusMin, 1, 180);
    state.stats.focusSessions += 1;
    state.stats.focusMinutes += minutes;
    bumpStreak();

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
    const le = Number(state.settings.longEvery || 0);
    if (le > 0) {
      state.cyclesSinceLong = (state.cyclesSinceLong || 0) + 1;
      if (state.cyclesSinceLong >= le) {
        state.cyclesSinceLong = 0;
        saveState();
        setPhase('longbreak');
        el.hint.textContent = 'Long break time. You earned it.';
        return;
      }
    }

    saveState();
    setPhase('break');
    el.hint.textContent = 'Break time. Blink slowly. Hydrate.';
    return;
  }

  // Completed a break
  saveState();
  setPhase('focus');
  el.hint.textContent = 'Back to focus. Slow and steady.';
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
function renderStats() {
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
  el.slowMode.checked = !!state.settings.slowMode;
}

function applySettingsFromUI({ resetClockIfIdle = true } = {}) {
  state.settings.focusMin = clamp(Number(el.focusMin.value || 25), 1, 180);
  state.settings.breakMin = clamp(Number(el.breakMin.value || 5), 1, 60);
  state.settings.longEvery = clamp(Number(el.longEvery.value || 0), 0, 8);
  state.settings.longBreakMin = clamp(Number(el.longBreakMin.value || 15), 5, 90);
  state.settings.sound = !!el.sound.checked;
  state.settings.slowMode = !!el.slowMode.checked;
  saveState();

  if (!running && resetClockIfIdle) {
    remainingMs = getPhaseDurationMs(phase);
  }
  render();
}

// Event listeners
el.btnStart.addEventListener('click', () => start());
el.btnPause.addEventListener('click', () => pause());
el.btnReset.addEventListener('click', () => reset());

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

for (const input of [el.focusMin, el.breakMin, el.longEvery, el.longBreakMin, el.sound, el.slowMode]) {
  input.addEventListener('change', () => applySettingsFromUI());
}

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
setPhase('focus');
render();
