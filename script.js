const HOUR = 3600;
const MAX_SECONDS = 99 * HOUR + 59 * 60; // 99:59 is the most two cards can show

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
// 1 hour or more -> hours : minutes (minutes round up, so 1h 47m stays 1:47 until it drops to 1:46)
// under 1 hour   -> minutes : seconds
function partsFor(rem) {
  if (rem >= HOUR) {
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

  if (!animate) {
    top.textContent = newValue;
    bottom.textContent = newValue;
    topFlip.textContent = newValue;
    bottomFlip.textContent = newValue;
    return;
  }

  // 1. Prepare static bg
  top.textContent = newValue;
  bottom.textContent = newValue;

  // 2. Prepare flippers
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
    untilHint.textContent = t && t.tomorrow ? "(tomorrow)" : "";
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

  if (wasPreset) {
    // Pomodoro: after a moment, hop to the other mode (work <-> break), as before.
    doneTimeout = setTimeout(() => {
      isWork = !isWork;
      modeSelect.value = isWork ? "work" : "break";
      resetTimer();
    }, 1500);
  }
  // Custom / until: stay on 00:00 until the person presses Stop.
}

// --- Controls ---

function startTimer() {
  if (state === "running" || state === "done") return;

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
}

function resetTimer() {
  clearTimeout(doneTimeout);
  doneTimeout = null;

  state = "idle";
  setLocked(false);
  setButtons();
  refreshIdle();
}

// --- Event Listeners ---

startBtn.onclick = startTimer;
pauseBtn.onclick = pauseTimer;
resetBtn.onclick = resetTimer;

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



