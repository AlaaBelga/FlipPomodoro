const HOUR = 3600;
const MAX_SECONDS = 99 * HOUR + 59 * 60; // 99:59 is the most two cards can show

// Below this many seconds the cards show MM:SS (seconds flip every second).
// Two cards hold at most 99, so 100 minutes (6000s) is the highest sensible limit.
// At or above it the cards show HH:MM instead.
const HM_THRESHOLD = 100 * 60;

// --- State ---
let workMin = 25;
let breakMin = 5;
let isWork = true;

let state = "idle"; // idle | running | paused | done
let endTime = 0; // ms timestamp the countdown ends at (while running)
let pausedMs = 0; // ms left (while paused)
let shownFormat = null; // "ms" (minutes:seconds) or "hm" (hours:minutes)
let doneTimeout = null;

// --- DOM Elements ---
const startBtn = document.getElementById("start");
const pauseBtn = document.getElementById("pause");
const resetBtn = document.getElementById("reset");
const fullScreenBtn = document.getElementById("fullscreen");

const typeSelect = document.getElementById("timerType");
const modeSelect = document.getElementById("mode");
const durationSelect = document.getElementById("duration");
const customH = document.getElementById("customH");
const customM = document.getElementById("customM");
const untilInput = document.getElementById("untilTime");
const untilHint = document.getElementById("untilHint");

const labelA = document.getElementById("labelA");
const labelB = document.getElementById("labelB");

const lockables = [typeSelect, modeSelect, durationSelect, customH, customM, untilInput];

// --- Helpers ---

const pad = (n) => String(n).padStart(2, "0");

function clampInt(value, min, max) {
  const n = Math.floor(Number(value));
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// Next occurrence of the chosen clock time (today, or tomorrow if already passed).
function untilTarget(now = new Date()) {
  const [h, m] = untilInput.value.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;

  const target = new Date(now);
  target.setHours(h, m, 0, 0);

  let tomorrow = false;
  if (target <= now) {
    target.setDate(target.getDate() + 1);
    tomorrow = true;
  }
  return { time: target, tomorrow };
}

// Seconds the timer would run for if started right now.
function idleSeconds() {
  switch (typeSelect.value) {
    case "custom": {
      const h = clampInt(customH.value, 0, 99);
      const m = clampInt(customM.value, 0, 5999);
      return Math.min(h * HOUR + m * 60, MAX_SECONDS);
    }
    case "until": {
      const t = untilTarget();
      return t ? Math.min(Math.ceil((t.time - Date.now()) / 1000), MAX_SECONDS) : 0;
    }
    default: {
      const val = Number(durationSelect.value);
      workMin = val;
      breakMin = val / 5;
      return (isWork ? workMin : breakMin) * 60;
    }
  }
}

// What the two cards show for a given number of seconds left.
// Under 100 minutes -> minutes : seconds (seconds flip every second)
// 100 minutes or more -> hours : minutes (minutes round up)
function partsFor(rem) {
  if (rem >= HM_THRESHOLD) {
    const totalMin = Math.ceil(rem / 60);
    return { fmt: "hm", a: Math.floor(totalMin / 60), b: totalMin % 60 };
  }
  return { fmt: "ms", a: Math.floor(rem / 60), b: rem % 60 };
}

// --- Rendering ---

function updateCard(id, newValue, animate = true) {
  const card = document.getElementById(id);
  const top = card.querySelector(".top");
  const bottom = card.querySelector(".bottom");
  const topFlip = card.querySelector(".top-flip");
  const bottomFlip = card.querySelector(".bottom-flip");

  const currentValue = top.textContent;

  if (newValue === currentValue) return;

  const token = (card._flipToken = (card._flipToken || 0) + 1);

  if (!animate) {
    card.classList.remove("flipping");
    top.textContent = newValue;
    bottom.textContent = newValue;
    topFlip.textContent = newValue;
    bottomFlip.textContent = newValue;
    return;
  }

  // 1. Static halves: new number on top, old number stays below until the flip lands
  top.textContent = newValue;
  bottom.textContent = currentValue;

  // 2. Flippers: old number folds away, new number folds in
  topFlip.textContent = currentValue;
  bottomFlip.textContent = newValue;

  // 3. Trigger Animation
  card.classList.remove("flipping");
  void card.offsetWidth; // Force Reflow

  requestAnimationFrame(() => {
    card.classList.add("flipping");
  });

  // 4. Cleanup (matches the 0.8s CSS animation)
  setTimeout(() => {
    if (card._flipToken !== token) return; // a newer update took over
    bottom.textContent = newValue;
    topFlip.textContent = newValue;
    card.classList.remove("flipping");
  }, 800);
}

function render(rem, animate) {
  const p = partsFor(rem);
  const formatChanged = p.fmt !== shownFormat;

  if (formatChanged) {
    shownFormat = p.fmt;
    labelA.textContent = p.fmt === "hm" ? "HOURS" : "MINUTES";
    labelB.textContent = p.fmt === "hm" ? "MINUTES" : "SECONDS";
  }

  // Snap (no flip) when the meaning of the cards changes or when just previewing.
  const doAnimate = animate && !formatChanged;
  updateCard("cardA", pad(p.a), doAnimate);
  updateCard("cardB", pad(p.b), doAnimate);
}

function updateGroups() {
  document.querySelectorAll("[data-show]").forEach((el) => {
    el.hidden = el.dataset.show !== typeSelect.value;
  });
}

function setLocked(locked) {
  lockables.forEach((el) => (el.disabled = locked));
}

function setButtons() {
  startBtn.disabled = state === "running" || state === "done";
  pauseBtn.disabled = state !== "running";
  startBtn.textContent = state === "paused" ? "Resume" : "Start";
}

// Idle preview: shows what a Start press would run, and keeps "until" live.
function refreshIdle() {
  const secs = idleSeconds();
  render(secs, false);

  if (typeSelect.value === "until") {
    const t = untilTarget();
    if (t) {
      // Show how long the timer will really run, so a wrong AM/PM is obvious.
      const mins = Math.round((t.time - Date.now()) / 60000);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      untilHint.textContent = `(${t.tomorrow ? "tomorrow · " : ""}${h}h ${m}m)`;
    } else {
      untilHint.textContent = "";
    }
  }

  startBtn.disabled = secs <= 0;
}

// --- Countdown ---

function loop() {
  if (state === "running") {
    const msLeft = endTime - Date.now();
    if (msLeft <= 0) {
      finish();
      return;
    }
    render(Math.ceil(msLeft / 1000), true);
  } else if (state === "idle") {
    refreshIdle();
  }
}

function finish() {
  const wasPreset = typeSelect.value === "preset";
  state = "done";
  render(0, true);
  setButtons();
  keepAwake(false);
  playAlarm();

  if (wasPreset) {
    // Pomodoro: after a moment, hop to the other mode (work <-> break), as before.
    // The alarm keeps ringing until Stop / Start / a tap on the clock.
    doneTimeout = setTimeout(() => {
      isWork = !isWork;
      modeSelect.value = isWork ? "work" : "break";
      resetTimer(true);
    }, 1500);
  }
  // Custom / until: stay on 00:00 until the person presses Stop.
}

// --- Alarm sound (synthesized bell chime, no audio file needed) ---

let audioCtx = null;
let alarm = null; // { master, timeout }
let alarmPending = false; // alarm was due but iOS wouldn't let the audio run yet

// Called when the audio engine changes state (e.g. iOS lets it run again).
function onAudioStateChange() {
  if (audioCtx && audioCtx.state === "running" && alarmPending) playAlarm();
}

// Browsers only allow audio after a tap, so this runs from the Start button.
// It is safe to call again at any time (visibility change, taps) to revive the audio.
function unlockAudio() {
  try {
    // iOS 16.4+: treat audio as "playback" so the silent/ring switch doesn't mute it.
    if (navigator.audioSession) navigator.audioSession.type = "playback";

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    if (!audioCtx) {
      audioCtx = new AC();
      audioCtx.onstatechange = onAudioStateChange;

      // Play one silent sample inside the tap: this fully unlocks audio on iOS.
      try {
        const src = audioCtx.createBufferSource();
        src.buffer = audioCtx.createBuffer(1, 1, 22050);
        src.connect(audioCtx.destination);
        src.start(0);
      } catch (e) {}
    }

    // iOS uses "interrupted" (not just "suspended") after the screen locks / app is backgrounded.
    if (audioCtx.state !== "running") {
      const p = audioCtx.resume();
      if (p && p.catch) p.catch(() => {});
    }
  } catch (e) {}
}

// One bell strike: a fundamental plus a few overtones that fade at different speeds.
function strikeBell(ctx, out, freq, when, vol) {
  const partials = [
    [1, 1.0, 2.4],
    [2, 0.5, 1.6],
    [3, 0.28, 1.1],
    [4.2, 0.14, 0.7],
  ]; // [frequency multiple, loudness, decay seconds]

  partials.forEach(([mult, amp, decay]) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq * mult;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol * amp, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    osc.connect(g);
    g.connect(out);
    osc.start(when);
    osc.stop(when + decay + 0.05);
  });
}

function playAlarm() {
  stopAlarm(); // also clears alarmPending
  try {
    unlockAudio();
    const ctx = audioCtx;
    if (!ctx) return;

    // If iOS isn't letting the audio run right now, remember that the alarm is due.
    // It rings as soon as the audio comes back (page visible again, next tap, etc.).
    if (ctx.state !== "running") {
      alarmPending = true;
      return;
    }

    // Loud but clean: a compressor stops overlapping bells from distorting.
    const master = ctx.createGain();
    master.gain.value = 1;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    master.connect(comp);
    comp.connect(ctx.destination);

    // C major arpeggio going up, ending on a bright chord; repeated 5 times (~13s).
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    const t0 = ctx.currentTime + 0.05;
    const roundLen = 2.6;
    const rounds = 5;
    for (let r = 0; r < rounds; r++) {
      const start = t0 + r * roundLen;
      notes.forEach((f, i) => strikeBell(ctx, master, f, start + i * 0.2, 0.42));
      strikeBell(ctx, master, 1046.5, start + 0.9, 0.38); // C6
      strikeBell(ctx, master, 1318.5, start + 0.9, 0.34); // E6
      strikeBell(ctx, master, 1568.0, start + 0.9, 0.3); // G6
    }

    const total = rounds * roundLen + 3;
    alarm = { master, timeout: setTimeout(stopAlarm, total * 1000) };

    if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
  } catch (e) {}
}

function stopAlarm() {
  alarmPending = false;
  if (!alarm) return;
  const { master, timeout } = alarm;
  alarm = null;
  clearTimeout(timeout);
  try {
    master.gain.cancelScheduledValues(0);
    master.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
    setTimeout(() => master.disconnect(), 400);
  } catch (e) {}
  if (navigator.vibrate) navigator.vibrate(0);
}

// Ring a late alarm (one that was due while the phone was locked / audio was blocked).
function retryPendingAlarm() {
  if (alarmPending) playAlarm();
}

// --- Keep the screen awake while counting (so the alarm can sound) ---

let wakeLock = null;

async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) {}
}

// Coming back to the page: re-grab the wake lock, revive the audio, ring if an alarm is waiting.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (state === "running") keepAwake(true);
  unlockAudio();
  setTimeout(retryPendingAlarm, 200);
});

// Fallback: a tap anywhere (except buttons / the clock, which have their own meaning)
// is a user gesture, so iOS will allow a waiting alarm to ring.
document.addEventListener(
  "touchend",
  (e) => {
    if (!alarmPending) return;
    const t = e.target;
    if (t && t.closest && t.closest("button, .clock-container")) return;
    unlockAudio();
    setTimeout(retryPendingAlarm, 100);
  },
  { passive: true }
);

// --- Controls ---

function startTimer() {
  if (state === "running" || state === "done") return;

  unlockAudio(); // must happen inside this tap so the alarm is allowed to play later
  stopAlarm();
  keepAwake(true);

  if (state === "paused") {
    endTime = Date.now() + pausedMs;
  } else if (typeSelect.value === "until") {
    const t = untilTarget();
    if (!t) return;
    endTime = t.time.getTime();
  } else {
    const secs = idleSeconds();
    if (secs <= 0) return;
    endTime = Date.now() + secs * 1000;
  }

  state = "running";
  setLocked(true);
  setButtons();
  loop();
}

function pauseTimer() {
  if (state !== "running") return;

  pausedMs = Math.max(0, endTime - Date.now());
  state = "paused";
  setButtons();
  keepAwake(false);
}

function resetTimer(keepAlarm = false) {
  clearTimeout(doneTimeout);
  doneTimeout = null;
  if (keepAlarm !== true) stopAlarm();
  keepAwake(false);

  state = "idle";
  setLocked(false);
  setButtons();
  refreshIdle();
}

// --- Event Listeners ---

startBtn.onclick = startTimer;
pauseBtn.onclick = pauseTimer;
resetBtn.onclick = () => resetTimer();

typeSelect.onchange = () => {
  updateGroups();
  refreshIdle();
};

durationSelect.onchange = refreshIdle;

modeSelect.onchange = () => {
  isWork = modeSelect.value === "work";
  refreshIdle();
};

customH.oninput = refreshIdle;
customM.oninput = refreshIdle;
untilInput.oninput = refreshIdle;

document.getElementById("tileColor").oninput = (e) =>
  document.documentElement.style.setProperty("--tile", e.target.value);

document.getElementById("bgColor").oninput = (e) =>
  document.documentElement.style.setProperty("--bg", e.target.value);

// Fullscreen.
// Browsers with the Fullscreen API (desktop, Android) go truly fullscreen.
// iPhone Safari has no such API, so there the button switches to "focus mode":
// the controls hide and the clock fills the whole page.
const canNativeFullscreen = !!document.documentElement.requestFullscreen;
const isTouch = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

function setFocusMode(on) {
  document.body.classList.toggle("fullscreen-mode", on);
}

fullScreenBtn.onclick = () => {
  if (canNativeFullscreen) {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => setFocusMode(true));
    } else {
      document.exitFullscreen();
    }
  } else {
    setFocusMode(!document.body.classList.contains("fullscreen-mode"));
  }
};

document.addEventListener("fullscreenchange", () => {
  setFocusMode(!!document.fullscreenElement);
});

// Touch screens have no hover, so tapping the clock brings the controls back.
document.querySelector(".clock-container").addEventListener("click", () => {
  stopAlarm(); // a tap on the clock also silences the alarm
  if (!isTouch || !document.body.classList.contains("fullscreen-mode")) return;
  if (document.fullscreenElement) document.exitFullscreen();
  else setFocusMode(false);
});

// --- Init ---

// Default "until" time: the next full hour
(function setDefaultUntil() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  untilInput.value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
})();

updateGroups();
setButtons();
refreshIdle();
setInterval(loop, 200);


