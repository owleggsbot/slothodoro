const $ = (id) => document.getElementById(id);

const state = {
  phase: 'focus',
  running: false,
  remainingSec: 25 * 60,
  focusMin: 25,
  breakMin: 5,
  longEvery: 4,
  longBreakMin: 15,
  focusCompleted: 0,
  sound: true,
  slowMode: false,
  tickHandle: null,
  lastTickMs: null,
};

const storageKey = 'slothodoro:v1';

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function pad2(n){ return String(n).padStart(2, '0'); }
function format(sec){
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function nowLocalDateKey(){
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

function loadStats(){
  try{
    const raw = localStorage.getItem(storageKey);
    if(!raw) return { focusSessions: 0, focusedMinutes: 0, streak: 0, lastDay: null };
    const parsed = JSON.parse(raw);
    return {
      focusSessions: Number(parsed.focusSessions||0),
      focusedMinutes: Number(parsed.focusedMinutes||0),
      streak: Number(parsed.streak||0),
      lastDay: parsed.lastDay || null,
    };
  }catch{ return { focusSessions: 0, focusedMinutes: 0, streak: 0, lastDay: null }; }
}

function saveStats(stats){
  localStorage.setItem(storageKey, JSON.stringify(stats));
}

function updateStatsUI(){
  const stats = loadStats();
  $('statFocus').textContent = String(stats.focusSessions);
  $('statMinutes').textContent = String(stats.focusedMinutes);
  $('statStreak').textContent = String(stats.streak);
}

function setPhase(phase){
  state.phase = phase;
  $('modeLabel').textContent = phase === 'focus' ? 'Focus' : (phase === 'longbreak' ? 'Long break' : 'Break');
  document.title = `${format(state.remainingSec)} • ${$('modeLabel').textContent} — Slothodoro`;
}

function applyDurations(){
  state.focusMin = clamp(parseInt($('focusMin').value||'25',10), 1, 180);
  state.breakMin = clamp(parseInt($('breakMin').value||'5',10), 1, 60);
  state.longEvery = clamp(parseInt($('longEvery').value||'0',10), 0, 12);
  state.longBreakMin = clamp(parseInt($('longBreakMin').value||'15',10), 5, 90);
  state.sound = $('sound').checked;
  state.slowMode = $('slowMode').checked;
}

function phaseDurationSec(phase){
  if(phase === 'focus') return state.focusMin * 60;
  if(phase === 'longbreak') return state.longBreakMin * 60;
  return state.breakMin * 60;
}

function resetTimer(toPhase = 'focus'){
  applyDurations();
  state.running = false;
  clearInterval(state.tickHandle);
  state.tickHandle = null;
  state.lastTickMs = null;
  state.remainingSec = phaseDurationSec(toPhase);
  setPhase(toPhase);
  $('time').textContent = format(state.remainingSec);
  $('btnStart').disabled = false;
  $('btnPause').disabled = true;
}

function softChime(){
  if(!state.sound) return;
  // tiny WebAudio chime (no files)
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = 880;
  g.gain.value = 0.0001;
  o.connect(g);
  g.connect(ctx.destination);
  const t0 = ctx.currentTime;
  g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
  o.frequency.exponentialRampToValueAtTime(660, t0 + 0.18);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
  o.start(t0);
  o.stop(t0 + 0.4);
  setTimeout(()=>ctx.close().catch(()=>{}), 800);
}

function completeFocusSession(){
  const stats = loadStats();
  stats.focusSessions += 1;
  stats.focusedMinutes += state.focusMin;

  const today = nowLocalDateKey();
  if(stats.lastDay === today){
    // already counted streak today
  } else {
    // streak: if lastDay was yesterday, +1; otherwise reset to 1
    const d = new Date();
    const y = new Date(d); y.setDate(d.getDate()-1);
    const yKey = `${y.getFullYear()}-${pad2(y.getMonth()+1)}-${pad2(y.getDate())}`;
    stats.streak = (stats.lastDay === yKey) ? (stats.streak + 1) : 1;
    stats.lastDay = today;
  }

  saveStats(stats);
  updateStatsUI();
}

function nextPhase(){
  if(state.phase === 'focus'){
    completeFocusSession();
    state.focusCompleted += 1;
    if(state.longEvery > 0 && state.focusCompleted % state.longEvery === 0){
      return 'longbreak';
    }
    return 'break';
  }
  return 'focus';
}

function tick(){
  const ms = performance.now();
  if(state.lastTickMs == null) state.lastTickMs = ms;
  const delta = ms - state.lastTickMs;
  state.lastTickMs = ms;

  // Sloth Mode: time bleeds a bit (still honest-ish; we just ease transitions)
  const speed = state.slowMode ? 0.92 : 1.0;
  const dec = delta / 1000 * speed;
  state.remainingSec = Math.max(0, state.remainingSec - dec);

  const rounded = Math.ceil(state.remainingSec);
  $('time').textContent = format(rounded);
  document.title = `${format(rounded)} • ${$('modeLabel').textContent} — Slothodoro`;

  if(state.remainingSec <= 0.0001){
    softChime();
    const np = nextPhase();
    state.remainingSec = phaseDurationSec(np);
    setPhase(np);
    if(!state.slowMode){
      // quick little flash
      $('hint').textContent = np === 'focus' ? 'Back to focus. Slow and steady.' : 'Time to rest. Sloth approved.';
    } else {
      $('hint').textContent = 'Sloth Mode: gentle transitions. No sudden vibes.';
    }
  }
}

function start(){
  applyDurations();
  if(state.running) return;
  state.running = true;
  $('btnStart').disabled = true;
  $('btnPause').disabled = false;
  state.lastTickMs = null;
  state.tickHandle = setInterval(tick, 200);
}

function pause(){
  if(!state.running) return;
  state.running = false;
  $('btnStart').disabled = false;
  $('btnPause').disabled = true;
  clearInterval(state.tickHandle);
  state.tickHandle = null;
}

function setPreset(name){
  if(name === 'classic'){
    $('focusMin').value = 25; $('breakMin').value = 5; $('longEvery').value = 4; $('longBreakMin').value = 15;
  }
  if(name === 'deep'){
    $('focusMin').value = 50; $('breakMin').value = 10; $('longEvery').value = 2; $('longBreakMin').value = 20;
  }
  if(name === 'gentle'){
    $('focusMin').value = 15; $('breakMin').value = 5; $('longEvery').value = 0; $('longBreakMin').value = 15;
  }
  resetTimer('focus');
}

function drawShareCard(){
  const canvas = $('shareCanvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  // background
  const g1 = ctx.createRadialGradient(w*0.2,h*0.2, 50, w*0.2,h*0.2, w*0.9);
  g1.addColorStop(0, 'rgba(123,211,137,0.28)');
  g1.addColorStop(1, 'rgba(11,15,20,1)');
  ctx.fillStyle = g1;
  ctx.fillRect(0,0,w,h);

  const g2 = ctx.createRadialGradient(w*0.85,h*0.1, 50, w*0.85,h*0.1, w*0.8);
  g2.addColorStop(0, 'rgba(106,167,255,0.22)');
  g2.addColorStop(1, 'rgba(11,15,20,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0,0,w,h);

  // card
  ctx.fillStyle = 'rgba(17,25,38,0.86)';
  roundRect(ctx, 70, 70, w-140, h-140, 26);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // title
  ctx.fillStyle = '#e8eef6';
  ctx.font = '700 56px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
  ctx.fillText('Slothodoro', 120, 160);

  const stats = loadStats();
  const lines = [
    `Local focus sessions: ${stats.focusSessions}`,
    `Minutes focused: ${stats.focusedMinutes}`,
    `Current streak: ${stats.streak}`,
    `Mode: ${$('modeLabel').textContent}`,
  ];

  ctx.fillStyle = 'rgba(232,238,246,0.86)';
  ctx.font = '500 34px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  let y = 240;
  for(const l of lines){
    ctx.fillText(l, 120, y);
    y += 52;
  }

  ctx.fillStyle = 'rgba(169,183,199,0.95)';
  ctx.font = '500 24px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
  ctx.fillText('Slow and steady progress. No accounts. No keys.', 120, h-160);
  ctx.fillStyle = 'rgba(106,167,255,0.95)';
  ctx.fillText('github.com/owleggsbot/slothodoro', 120, h-120);

  // tiny sloth mark
  ctx.save();
  ctx.translate(w-210, 130);
  ctx.scale(2.4, 2.4);
  drawSlothMark(ctx);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r){
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}

function drawSlothMark(ctx){
  // simple sloth face icon
  ctx.fillStyle = 'rgba(123,211,137,0.95)';
  ctx.beginPath();
  ctx.ellipse(30, 30, 24, 22, 0, 0, Math.PI*2);
  ctx.fill();

  ctx.fillStyle = 'rgba(11,15,20,0.9)';
  ctx.beginPath();
  ctx.ellipse(22, 28, 6, 7, 0, 0, Math.PI*2);
  ctx.ellipse(38, 28, 6, 7, 0, 0, Math.PI*2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(11,15,20,0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(30, 36, 9, 0.1*Math.PI, 0.9*Math.PI);
  ctx.stroke();
}

function openShare(){
  drawShareCard();
  const d = $('shareDialog');
  if(typeof d.showModal === 'function') d.showModal();
  else alert('Your browser does not support <dialog>.');
}

// wire up
$('btnStart').addEventListener('click', start);
$('btnPause').addEventListener('click', pause);
$('btnReset').addEventListener('click', ()=>resetTimer(state.phase));
$('btnShare').addEventListener('click', openShare);
$('btnClear').addEventListener('click', ()=>{ localStorage.removeItem(storageKey); updateStatsUI(); });

for(const el of document.querySelectorAll('.pill')){
  el.addEventListener('click', ()=> setPreset(el.dataset.preset));
}

for(const id of ['focusMin','breakMin','longEvery','longBreakMin','sound','slowMode']){
  $(id).addEventListener('change', ()=>{ if(!state.running) resetTimer('focus'); });
}

updateStatsUI();
resetTimer('focus');
