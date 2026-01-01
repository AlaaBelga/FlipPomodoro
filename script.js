let workMin = 25;
let breakMin = 5;
let isWork = true;
let remaining;
let timer = null;
let isPaused = false;

// DOM Elements
const startBtn = document.getElementById("start");
const pauseBtn = document.getElementById("pause");
const resetBtn = document.getElementById("reset");
const durationSelect = document.getElementById("duration");
const modeSelect = document.getElementById("mode");
const fullScreenBtn = document.getElementById("fullscreen");

function init() {
  const val = Number(durationSelect.value);
  workMin = val;
  breakMin = val / 5;
  remaining = (isWork ? workMin : breakMin) * 60;
  
  // Set initial display without animation
  updateCard("min", String(Math.floor(remaining / 60)).padStart(2, "0"), false);
  updateCard("sec", String(remaining % 60).padStart(2, "0"), false);
}

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

  // 3. Trigger Animation (Optimized)
  card.classList.remove("flipping");
  void card.offsetWidth; // Force Reflow
  
  requestAnimationFrame(() => {
      card.classList.add("flipping");
  });

  // 4. Cleanup - Updated to 800ms to match CSS
  setTimeout(() => {
    topFlip.textContent = newValue;
    card.classList.remove("flipping");
  }, 800); 
}

function updateDisplay() {
  const min = String(Math.floor(remaining / 60)).padStart(2, "0");
  const sec = String(remaining % 60).padStart(2, "0");
  
  updateCard("min", min);
  updateCard("sec", sec);
}

function tick() {
  if (remaining <= 0) {
    clearInterval(timer);
    timer = null;
    isPaused = false;
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    
    isWork = !isWork;
    modeSelect.value = isWork ? "work" : "break";
    init(); 
    return;
  }
  
  remaining--;
  updateDisplay();
}

// --- Controls ---

function startTimer() {
  if (timer) return; 
  
  startBtn.disabled = true;
  pauseBtn.disabled = false;
  isPaused = false;
  
  timer = setInterval(tick, 1000);
}

function pauseTimer() {
  if (!timer) return;
  
  clearInterval(timer);
  timer = null;
  isPaused = true;
  
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  startBtn.textContent = "Resume";
}

function resetTimer() {
  clearInterval(timer);
  timer = null;
  isPaused = false;
  
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  startBtn.textContent = "Start";
  
  init(); 
}

// --- Event Listeners ---

startBtn.onclick = startTimer;
pauseBtn.onclick = pauseTimer;
resetBtn.onclick = resetTimer;

durationSelect.onchange = () => {
  if (!timer && !isPaused) init();
  else {
    const val = Number(durationSelect.value);
    workMin = val;
    breakMin = val / 5;
  }
};

modeSelect.onchange = () => {
  isWork = modeSelect.value === "work";
  resetTimer();
};

document.getElementById("tileColor").oninput = (e) =>
  document.documentElement.style.setProperty("--tile", e.target.value);

document.getElementById("bgColor").oninput = (e) =>
  document.documentElement.style.setProperty("--bg", e.target.value);

fullScreenBtn.onclick = () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
    document.body.classList.add("fullscreen-mode");
  } else {
    document.exitFullscreen();
    document.body.classList.remove("fullscreen-mode");
  }
};

init();



