/* Slothodoro — no trackers, no accounts, just a calm timer.
   Everything is client-side + localStorage. */

const $ = (id) => document.getElementById(id);

const els = {
  time: $("time"),
  label: $("label"),
  hint: $("hint"),
  startPause: $("startPause"),
  reset: $("reset"),
  modeFocus: $("modeFocus"),
  modeBreak: $("modeBreak"),
  focusMinutes: $("focusMinutes"),
  breakMinutes: $("breakMinutes"),
  sound: $("sound"),

  statSessions: $("statSessions"),
  statMinutes: $("statMinutes"),
  statStreak: $("statStreak"),
  clearStats: $("clearStats"),

  exportCard: $("exportCard"),
  copyLink: $("copyLink"),
  canvas: $("cardCanvas"),
  downloadPng: $("downloadPng"),

  help: $("help"),
  openHelp: $("openHelp"),
  closeHelp: $("closeHelp"),
};

const STORAGE_KEY = "slothodoro:v1";

const defaultState = {
  settings: {
    focusMin: 25,
    breakMin: 5,
    sound: true,
  },
  stats: {
    focusSessions: 0,
    focusMinutes: 0,
    // streak counts focus sessions completed today
    streakDate: null,
    streakCount: 0,
  },
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

let mode = "focus"; // 'focus' | 'break'
let remainingMs = state.settings.focusMin * 60 * 1000;
let running = false;
let tickTimer = null;
let endAt = null;

function fmt(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function setMode(next) {
  mode = next;
  const isFocus = mode === "focus";
  els.modeFocus.setAttribute("aria-selected", String(isFocus));
  els.modeBreak.setAttribute("aria-selected", String(!isFocus));
  els.label.textContent = isFocus ? "Focus time" : "Break time";

  if (!running) {
    const mins = isFocus ? Number(els.focusMinutes.value) : Number(els.breakMinutes.value);
    remainingMs = mins * 60 * 1000;
    render();
  }
}

function setHint(msg) {
  els.hint.textContent = msg || "";
}

function render() {
  els.time.textContent = fmt(remainingMs);
  els.startPause.textContent = running ? "Pause" : "Start";

  els.exportCard.disabled = !state.lastResult;
  els.copyLink.setAttribute("aria-disabled", state.lastResult ? "false" : "true");
  els.copyLink.style.pointerEvents = state.lastResult ? "auto" : "none";

  els.statSessions.textContent = String(state.stats.focusSessions);
  els.statMinutes.textContent = String(state.stats.focusMinutes);
  els.statStreak.textContent = String(state.stats.streakCount);

  renderCardPreview();
}

function applySettingsFromUI() {
  const focusMin = clampInt(els.focusMinutes.value, 1, 180);
  const breakMin = clampInt(els.breakMinutes.value, 1, 60);
  const sound = !!els.sound.checked;

  state.settings = { focusMin, breakMin, sound };
  saveState();

  if (!running) {
    remainingMs = (mode === "focus" ? focusMin : breakMin) * 60 * 1000;
  }
  render();
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function start() {
  if (running) return;
  running = true;
  endAt = Date.now() + remainingMs;
  setHint(mode === "focus" ? "Sloth says: one tiny step at a time." : "Break time. Hydrate, stretch, blink." );

  tickTimer = window.setInterval(tick, 250);
  render();
}

function pause() {
  if (!running) return;
  running = false;
  window.clearInterval(tickTimer);
  tickTimer = null;
  remainingMs = Math.max(0, endAt - Date.now());
  endAt = null;
  setHint("Paused. Your sloth will wait." );
  render();
}

function reset() {
  pause();
  remainingMs = (mode === "focus" ? state.settings.focusMin : state.settings.breakMin) * 60 * 1000;
  setHint("Reset." );
  render();
}

function tick() {
  remainingMs = Math.max(0, endAt - Date.now());
  els.time.textContent = fmt(remainingMs);

  if (remainingMs <= 0) {
    complete();
  }
}

function bell() {
  if (!state.settings.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();

    // gentle envelope
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.stop(t + 0.62);

    o.onended = () => ctx.close();
  } catch {
    // ignore
  }
}

function complete() {
  pause();
  bell();

  if (mode === "focus") {
    const minutes = state.settings.focusMin;

    // streak: only counts focus sessions completed today
    const tk = todayKey();
    if (state.stats.streakDate !== tk) {
      state.stats.streakDate = tk;
      state.stats.streakCount = 0;
    }
    state.stats.streakCount += 1;

    state.stats.focusSessions += 1;
    state.stats.focusMinutes += minutes;

    state.lastResult = {
      kind: "focus",
      minutes,
      completedAt: new Date().toISOString(),
      streakCount: state.stats.streakCount,
      totalSessions: state.stats.focusSessions,
      totalMinutes: state.stats.focusMinutes,
    };

    saveState();
    setHint(`Nice. You completed ${minutes} minutes of focus. (Streak today: ${state.stats.streakCount})`);
    setMode("break");
  } else {
    setHint("Break complete. Back to focus when you’re ready." );
    setMode("focus");
  }

  updateResultLink();
  render();
}

function updateResultLink() {
  if (!state.lastResult) return;
  const data = encodeURIComponent(btoa(JSON.stringify(state.lastResult)));
  const url = `${location.origin}${location.pathname}#r=${data}`;
  els.copyLink.dataset.url = url;
}

function tryLoadResultFromHash() {
  const hash = location.hash || "";
  const m = hash.match(/#r=([^&]+)/);
  if (!m) return;
  try {
    const obj = JSON.parse(atob(decodeURIComponent(m[1])));
    if (obj && obj.kind === "focus" && typeof obj.minutes === "number") {
      state.lastResult = obj;
      saveState();
    }
  } catch {
    // ignore
  }
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function renderCardPreview() {
  const c = els.canvas;
  const ctx = c.getContext("2d");
  const W = c.width;
  const H = c.height;

  // background
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#0b0d18");
  grad.addColorStop(1, "#151a33");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // glow blobs
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#9ff0d3";
  ctx.beginPath(); ctx.ellipse(280, 120, 260, 180, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffd59e";
  ctx.beginPath(); ctx.ellipse(930, 170, 290, 210, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  // card container
  ctx.fillStyle = "rgba(255,255,255,.06)";
  ctx.strokeStyle = "rgba(255,255,255,.14)";
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, 70, 70, W - 140, H - 140, 32);
  ctx.fill();
  ctx.stroke();

  // title
  ctx.fillStyle = "#f3f4ff";
  ctx.font = "700 60px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
  ctx.fillText("Slothodoro", 130, 170);

  // subtitle
  ctx.fillStyle = "rgba(243,244,255,.78)";
  ctx.font = "400 28px ui-sans-serif, system-ui";
  ctx.fillText("slow focus, gentle stats", 130, 218);

  // sloth face (simple)
  const sx = W - 280;
  const sy = 135;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.fillStyle = "#bca88b";
  drawRoundedRect(ctx, -80, -70, 160, 140, 40);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.18)";
  ctx.stroke();
  ctx.fillStyle = "#1b1b1b";
  ctx.beginPath(); ctx.arc(-32, -10, 11, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc( 32, -10, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.65)";
  ctx.beginPath(); ctx.arc(-28, -14, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc( 36, -14, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#3a2b20";
  drawRoundedRect(ctx, -13, 12, 26, 16, 10);
  ctx.fill();
  ctx.restore();

  // result text
  const r = state.lastResult;
  ctx.fillStyle = "rgba(243,244,255,.88)";
  ctx.font = "600 44px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace";
  const main = r ? `${r.minutes} minutes focused` : "Complete a focus session";
  ctx.fillText(main, 130, 330);

  ctx.fillStyle = "rgba(243,244,255,.70)";
  ctx.font = "400 26px ui-sans-serif, system-ui";
  const line2 = r ? `Streak today: ${r.streakCount} • Total sessions: ${r.totalSessions}` : "to unlock an exportable session card";
  ctx.fillText(line2, 130, 380);

  ctx.fillStyle = "rgba(243,244,255,.55)";
  ctx.font = "400 22px ui-sans-serif, system-ui";
  ctx.fillText("owleggsbot.github.io/slothodoro", 130, H - 120);

  // update download link
  if (r) {
    const dataUrl = c.toDataURL("image/png");
    els.downloadPng.href = dataUrl;
    els.downloadPng.setAttribute("aria-disabled", "false");
    els.downloadPng.style.pointerEvents = "auto";
  } else {
    els.downloadPng.href = "#";
    els.downloadPng.setAttribute("aria-disabled", "true");
    els.downloadPng.style.pointerEvents = "none";
  }
}

function exportCard() {
  if (!state.lastResult) return;
  // ensure latest render
  renderCardPreview();
  const dataUrl = els.canvas.toDataURL("image/png");
  els.downloadPng.href = dataUrl;
  els.downloadPng.click();
}

async function copyResultLink() {
  if (!state.lastResult) return;
  updateResultLink();
  const url = els.copyLink.dataset.url;
  try {
    await navigator.clipboard.writeText(url);
    setHint("Result link copied." );
  } catch {
    // fallback
    prompt("Copy this link:", url);
  }
}

function clearStats() {
  if (!confirm("Clear Slothodoro stats on this device?")) return;
  state.stats = structuredClone(defaultState.stats);
  state.lastResult = null;
  saveState();
  setHint("Stats cleared." );
  render();
}

function hookEvents() {
  els.modeFocus.addEventListener("click", () => setMode("focus"));
  els.modeBreak.addEventListener("click", () => setMode("break"));

  els.startPause.addEventListener("click", () => (running ? pause() : start()));
  els.reset.addEventListener("click", reset);

  [els.focusMinutes, els.breakMinutes, els.sound].forEach((el) => {
    el.addEventListener("change", applySettingsFromUI);
    el.addEventListener("input", () => {
      // preview values but avoid spamming localStorage
      if (el.type === "number" && !running) {
        const focusMin = clampInt(els.focusMinutes.value, 1, 180);
        const breakMin = clampInt(els.breakMinutes.value, 1, 60);
        remainingMs = (mode === "focus" ? focusMin : breakMin) * 60 * 1000;
        render();
      }
    });
  });

  els.exportCard.addEventListener("click", exportCard);
  els.copyLink.addEventListener("click", (e) => {
    e.preventDefault();
    copyResultLink();
  });
  els.clearStats.addEventListener("click", clearStats);

  // help dialog
  els.openHelp.addEventListener("click", (e) => { e.preventDefault(); els.help.showModal(); });
  els.closeHelp.addEventListener("click", () => els.help.close());

  // keyboard
  window.addEventListener("keydown", (e) => {
    if ((e.key === " " || e.key === "Enter") && (document.activeElement === els.startPause)) {
      return; // normal
    }
    if (e.key === " ") {
      // space toggles start/pause if focus isn't in an input
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag !== "input" && tag !== "textarea") {
        e.preventDefault();
        running ? pause() : start();
      }
    }
  });
}

function initFromState() {
  els.focusMinutes.value = String(state.settings.focusMin);
  els.breakMinutes.value = String(state.settings.breakMin);
  els.sound.checked = !!state.settings.sound;

  remainingMs = state.settings.focusMin * 60 * 1000;
  setMode("focus");
  updateResultLink();
}

tryLoadResultFromHash();
initFromState();
hookEvents();
render();
