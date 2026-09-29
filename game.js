import {
  ARENA,
  POWER_UPS,
  activeEffectLabels,
  createGameState,
  mapPlayerTarget,
  stepGame,
} from "./physics.js?v=20260929-smooth1";
import { OneEuroFilter } from "./input.js";
import { HandTracker } from "./hand.js";

const ROUND_DURATION_MS = 40_000;
const FIXED_STEP_SECONDS = 1 / 90;
const MAX_FRAME_SECONDS = 0.05;
const HUD_INTERVAL_MS = 100;
const MAX_PREDICTION_SECONDS = 0.045;

const POWER_UP_LINES = Object.freeze({
  giant_hand: "Your defence just downloaded the premium upgrade.",
  multiball: "One puck was apparently too peaceful.",
  freeze: "The AI is buffering. Take the shot.",
  speed_glitch: "Physics has left the group chat.",
  reverse: "Your own hand has switched teams.",
});

const PLAYER_GOAL_LINES = [
  ["AI GOT COOKED", "That goal had absolutely no adult supervision."],
  ["DEFENCE DELETED", "Somebody restart the robot."],
  ["TOP CORNER TAX", "The AI paid it in full."],
  ["GOAL DETECTED", "Confidence level: unnecessarily high."],
];

const AI_GOAL_LINES = [
  ["GOAL SECURITY FAILED", "Your defence was on its lunch break."],
  ["THE AI CLAPPED BACK", "Okay. That one was personal."],
  ["SYSTEM BREACH", "Quick—pretend the camera lagged."],
];

const elements = {
  app: document.querySelector("#app"),
  video: document.querySelector("#camera"),
  canvas: document.querySelector("#gameCanvas"),
  hud: document.querySelector("#hud"),
  setupOverlay: document.querySelector("#setupOverlay"),
  resultOverlay: document.querySelector("#resultOverlay"),
  errorOverlay: document.querySelector("#errorOverlay"),
  errorText: document.querySelector("#errorText"),
  startButton: document.querySelector("#startButton"),
  mouseButton: document.querySelector("#mouseButton"),
  retryButton: document.querySelector("#retryButton"),
  errorMouseButton: document.querySelector("#errorMouseButton"),
  cameraStatus: document.querySelector("#cameraStatus"),
  countdown: document.querySelector("#countdown"),
  countdownValue: document.querySelector("#countdownValue"),
  playerScore: document.querySelector("#playerScore"),
  aiScore: document.querySelector("#aiScore"),
  timerValue: document.querySelector("#timerValue"),
  effectTray: document.querySelector("#effectTray"),
  trackingPill: document.querySelector("#trackingPill"),
  trackingText: document.querySelector("#trackingText"),
  soundButton: document.querySelector("#soundButton"),
  momentBanner: document.querySelector("#momentBanner"),
  momentKicker: document.querySelector("#momentKicker"),
  momentTitle: document.querySelector("#momentTitle"),
  momentSubtitle: document.querySelector("#momentSubtitle"),
  resultTitle: document.querySelector("#resultTitle"),
  resultSubtitle: document.querySelector("#resultSubtitle"),
  finalPlayerScore: document.querySelector("#finalPlayerScore"),
  finalAiScore: document.querySelector("#finalAiScore"),
  powerUpsStat: document.querySelector("#powerUpsStat"),
  rallyStat: document.querySelector("#rallyStat"),
  bestScoreStat: document.querySelector("#bestScoreStat"),
  playAgainButton: document.querySelector("#playAgainButton"),
  menuButton: document.querySelector("#menuButton"),
  pauseCard: document.querySelector("#pauseCard"),
};

const ctx = elements.canvas.getContext("2d", { alpha: true, desynchronized: true });

const state = {
  phase: "setup",
  inputMode: "camera",
  cameraReady: false,
  lastHandSeenAt: 0,
  handTracked: false,
  openPalm: false,
  rawInput: { x: 0.5, y: 0.72 },
  inputVelocity: { x: 0, y: 0 },
  lastInputSampleAt: 0,
  game: createGameState(performance.now()),
  countdownEndsAt: 0,
  roundEndsAt: 0,
  pausedAt: 0,
  lastFrameAt: performance.now(),
  accumulator: 0,
  dpr: 1,
  soundEnabled: true,
  particles: [],
  bannerTimer: 0,
  lastHudAt: 0,
};

let audioContext = null;
const handFilterX = new OneEuroFilter(2.8, 0.8);
const handFilterY = new OneEuroFilter(2.8, 0.8);
const handTracker = new HandTracker(
  elements.video,
  receiveHandLandmarks,
  (message) => {
    state.cameraReady = false;
    if (state.inputMode === "camera" && state.phase === "playing") {
      showRuntimeCameraError(new Error(message));
    } else {
      elements.cameraStatus.textContent = message;
      elements.cameraStatus.classList.remove("ready");
      elements.startButton.disabled = true;
      elements.startButton.textContent = "Camera unavailable";
    }
  },
);

function setHidden(element, hidden) {
  element.classList.toggle("hidden", hidden);
}

function setText(element, value) {
  const text = String(value);
  if (element.textContent !== text) element.textContent = text;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function choose(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function ensureAudio() {
  if (!state.soundEnabled) return null;
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

function playTone(frequency, duration = 0.08, volume = 0.045, type = "sine", endFrequency = null) {
  const audio = ensureAudio();
  if (!audio) return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const now = audio.currentTime;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

function playGoalSound(playerScored) {
  if (playerScored) {
    playTone(420, 0.12, 0.06, "triangle", 720);
    window.setTimeout(() => playTone(680, 0.16, 0.055, "triangle", 1_100), 95);
  } else {
    playTone(180, 0.22, 0.055, "sawtooth", 70);
  }
}

function playPowerUpSound(type) {
  const base = { giant_hand: 290, multiball: 520, freeze: 740, speed_glitch: 190, reverse: 360 }[type] || 420;
  playTone(base, 0.12, 0.05, "square", base * 1.45);
  window.setTimeout(() => playTone(base * 1.6, 0.11, 0.04, "triangle", base * 2.05), 80);
}

function resizeCanvas() {
  const rect = elements.canvas.getBoundingClientRect();
  state.dpr = Math.min(window.devicePixelRatio || 1, 1.25);
  const width = Math.max(1, Math.round(rect.width * state.dpr));
  const height = Math.max(1, Math.round(rect.height * state.dpr));
  if (elements.canvas.width !== width || elements.canvas.height !== height) {
    elements.canvas.width = width;
    elements.canvas.height = height;
  }
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  return { width: rect.width, height: rect.height };
}

function worldToCanvas(x, y, width, height) {
  return { x: x * width, y: y * height };
}

function worldRadius(radius, width, height) {
  return radius * Math.min(width, height * 1.18);
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawArena(width, height) {
  const left = ARENA.left * width;
  const right = ARENA.right * width;
  const top = ARENA.top * height;
  const bottom = ARENA.bottom * height;
  const arenaWidth = right - left;
  const arenaHeight = bottom - top;

  ctx.save();
  const fill = ctx.createLinearGradient(0, top, 0, bottom);
  fill.addColorStop(0, "rgba(56, 30, 112, 0.48)");
  fill.addColorStop(0.47, "rgba(8, 30, 61, 0.56)");
  fill.addColorStop(1, "rgba(2, 79, 104, 0.38)");
  roundedRect(ctx, left, top, arenaWidth, arenaHeight, 28);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(125, 211, 252, 0.48)";
  ctx.shadowColor = "rgba(56, 189, 248, 0.32)";
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.beginPath();
  ctx.moveTo(left + 20, ARENA.centreY * height);
  ctx.lineTo(right - 20, ARENA.centreY * height);
  ctx.strokeStyle = "rgba(226, 232, 240, 0.24)";
  ctx.setLineDash([8, 10]);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(width / 2, ARENA.centreY * height, Math.min(width, height) * 0.08, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(226, 232, 240, 0.19)";
  ctx.stroke();

  const goalLeft = ARENA.goalLeft * width;
  const goalWidth = (ARENA.goalRight - ARENA.goalLeft) * width;
  const goalDepth = Math.max(13, height * 0.026);
  const drawGoal = (y, colour, flip) => {
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 4;
    ctx.shadowColor = colour;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(goalLeft, y);
    ctx.lineTo(goalLeft, y + goalDepth * flip);
    ctx.lineTo(goalLeft + goalWidth, y + goalDepth * flip);
    ctx.lineTo(goalLeft + goalWidth, y);
    ctx.stroke();
    ctx.restore();
  };
  drawGoal(top, "#a78bfa", -1);
  drawGoal(bottom, "#67e8f9", 1);

  ctx.font = "800 11px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(196, 181, 253, 0.72)";
  ctx.fillText("AI ZONE", left + 18, top + 24);
  ctx.fillStyle = "rgba(165, 243, 252, 0.76)";
  ctx.fillText("YOUR ZONE", left + 18, bottom - 17);
  ctx.restore();
}

function drawPaddle(paddle, colour, label, width, height, frozen = false) {
  const point = worldToCanvas(paddle.x, paddle.y, width, height);
  const radius = worldRadius(paddle.radius, width, height);
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.shadowColor = colour;
  ctx.shadowBlur = frozen ? 30 : 20;
  const gradient = ctx.createRadialGradient(-radius * 0.28, -radius * 0.3, radius * 0.1, 0, 0, radius);
  gradient.addColorStop(0, "rgba(255,255,255,0.92)");
  gradient.addColorStop(0.18, colour);
  gradient.addColorStop(1, "rgba(6, 14, 35, 0.9)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(2, radius * 0.09);
  ctx.strokeStyle = colour;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = frozen ? "#e0f2fe" : "rgba(255,255,255,0.9)";
  ctx.font = `900 ${Math.max(9, radius * 0.3)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(frozen ? "FROZEN" : label, 0, 0);
  ctx.restore();
}

function drawPuck(puck, width, height, now) {
  if (!puck.active) {
    const remaining = Math.max(0, puck.serveAt - now);
    const pulse = 0.75 + Math.sin(now / 80) * 0.16;
    const centre = worldToCanvas(0.5, 0.5, width, height);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = "#f8fbff";
    ctx.font = "900 13px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(remaining > 350 ? "READY" : "GO", centre.x, centre.y + 40);
    ctx.restore();
    return;
  }

  ctx.save();
  for (let index = 0; index < puck.trail.length; index += 1) {
    const trail = puck.trail[index];
    const point = worldToCanvas(trail.x, trail.y, width, height);
    const alpha = ((index + 1) / puck.trail.length) * 0.25;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = puck.id === "bonus" ? "#c084fc" : "#c8ff62";
    ctx.beginPath();
    ctx.arc(point.x, point.y, worldRadius(puck.radius, width, height) * (0.35 + alpha), 0, Math.PI * 2);
    ctx.fill();
  }

  const point = worldToCanvas(puck.x, puck.y, width, height);
  const radius = worldRadius(puck.radius, width, height);
  const colour = puck.id === "bonus" ? "#c084fc" : "#c8ff62";
  ctx.globalAlpha = 1;
  ctx.shadowColor = colour;
  ctx.shadowBlur = 24;
  ctx.fillStyle = "#f8fbff";
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = colour;
  ctx.stroke();
  ctx.restore();
}

function drawPowerUp(powerUp, width, height, now) {
  if (!powerUp) return;
  const definition = POWER_UPS[powerUp.type];
  const point = worldToCanvas(powerUp.x, powerUp.y, width, height);
  const radius = worldRadius(powerUp.radius, width, height);
  const pulse = 1 + Math.sin((now - powerUp.spawnedAt) / 150) * 0.09;
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.scale(pulse, pulse);
  ctx.strokeStyle = definition.colour;
  ctx.fillStyle = "rgba(3, 10, 28, 0.9)";
  ctx.lineWidth = 3;
  ctx.shadowColor = definition.colour;
  ctx.shadowBlur = 28;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = definition.colour;
  ctx.font = `900 ${Math.max(15, radius * 0.9)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(definition.symbol, 0, 1);
  ctx.font = "900 9px Inter, system-ui, sans-serif";
  ctx.fillText(definition.shortLabel, 0, radius + 13);
  ctx.restore();
}

function spawnParticles(x, y, colour, count = 18) {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.07 + Math.random() * 0.19;
    state.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      colour,
      bornAt: performance.now(),
      lifeMs: 480 + Math.random() * 420,
      radius: 1.5 + Math.random() * 3.5,
    });
  }
}

function updateAndDrawParticles(now, deltaSeconds, width, height) {
  state.particles = state.particles.filter((particle) => now - particle.bornAt < particle.lifeMs);
  for (const particle of state.particles) {
    particle.x += particle.vx * deltaSeconds;
    particle.y += particle.vy * deltaSeconds;
    particle.vy += 0.12 * deltaSeconds;
    const life = 1 - (now - particle.bornAt) / particle.lifeMs;
    const point = worldToCanvas(particle.x, particle.y, width, height);
    ctx.save();
    ctx.globalAlpha = Math.max(0, life);
    ctx.fillStyle = particle.colour;
    ctx.shadowColor = particle.colour;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(point.x, point.y, particle.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function showMoment(kicker, title, subtitle, colour = "#67e8f9") {
  window.clearTimeout(state.bannerTimer);
  elements.momentKicker.textContent = kicker;
  elements.momentTitle.textContent = title;
  elements.momentSubtitle.textContent = subtitle;
  elements.momentBanner.style.setProperty("--moment-colour", colour);
  setHidden(elements.momentBanner, true);
  void elements.momentBanner.offsetWidth;
  setHidden(elements.momentBanner, false);
  state.bannerTimer = window.setTimeout(() => setHidden(elements.momentBanner, true), 1_550);
}

function animateApp(className) {
  elements.app.classList.remove(className);
  void elements.app.offsetWidth;
  elements.app.classList.add(className);
  window.setTimeout(() => elements.app.classList.remove(className), 450);
}

function handleGameEvents(events, now) {
  for (const event of events) {
    if (event.type === "paddle") {
      playTone(event.side === "player" ? 260 : 220, 0.045, 0.018, "square", 360);
    } else if (event.type === "goal") {
      const playerScored = event.scorer === "player";
      const [title, subtitle] = choose(playerScored ? PLAYER_GOAL_LINES : AI_GOAL_LINES);
      showMoment("Goal", title, subtitle, playerScored ? "#67e8f9" : "#fb7185");
      spawnParticles(0.5, playerScored ? ARENA.top : ARENA.bottom, playerScored ? "#67e8f9" : "#fb7185", 34);
      playGoalSound(playerScored);
      animateApp(playerScored ? "goal-flash" : "shake");
      updateScoreUI();
    } else if (event.type === "powerup") {
      const power = POWER_UPS[event.powerUp];
      showMoment("Power-up collected", power.label, POWER_UP_LINES[event.powerUp], power.colour);
      spawnParticles(state.game.player.x, state.game.player.y, power.colour, 24);
      playPowerUpSound(event.powerUp);
      updateEffectTray(now);
    } else if (event.type === "powerup-spawned") {
      playTone(640, 0.08, 0.025, "sine", 870);
    }
  }
}

function updateScoreUI() {
  setText(elements.playerScore, state.game.scores.player);
  setText(elements.aiScore, state.game.scores.ai);
}

function updateEffectTray(now) {
  const effects = activeEffectLabels(state.game, now);
  const existing = new Map(
    [...elements.effectTray.children].map((chip) => [chip.dataset.type, chip]),
  );
  const activeTypes = new Set();
  for (const effect of effects) {
    activeTypes.add(effect.type);
    let chip = existing.get(effect.type);
    if (!chip) {
      chip = document.createElement("div");
      chip.dataset.type = effect.type;
      chip.className = "effect-chip";
      chip.textContent = effect.label;
      chip.style.setProperty("--chip", effect.colour);
      elements.effectTray.append(chip);
    }
    const total = POWER_UPS[effect.type].durationMs;
    chip.style.setProperty("--life", String(clamp(effect.remainingMs / total, 0, 1)));
  }
  for (const [type, chip] of existing) {
    if (!activeTypes.has(type)) chip.remove();
  }
}

function updateInputTarget(now) {
  const handFresh = now - state.lastHandSeenAt < 520;
  if (state.inputMode === "camera") {
    state.handTracked = handFresh;
    elements.trackingPill.classList.toggle("ready", handFresh);
    setText(elements.trackingText, handFresh
      ? (state.openPalm ? "Palm locked · defend your goal" : "Hand locked · open your palm for control")
      : "Show one open palm");
  } else {
    elements.trackingPill.classList.add("ready");
    setText(elements.trackingText, "Mouse / touch control active");
  }

  if (state.inputMode === "camera" && !handFresh) return;
  const reversed = (state.game.activeEffects.reverse || 0) > now;
  const sampleAge = state.inputMode === "camera"
    ? clamp(now / 1_000 - state.lastInputSampleAt + 0.012, 0, MAX_PREDICTION_SECONDS)
    : 0;
  const predictedX = clamp(state.rawInput.x + state.inputVelocity.x * sampleAge, 0, 1);
  const predictedY = clamp(state.rawInput.y + state.inputVelocity.y * sampleAge, 0, 1);
  const target = mapPlayerTarget(predictedX, predictedY, reversed);
  state.game.player.targetX = target.x;
  state.game.player.targetY = target.y;
}

function drawFrame(now, deltaSeconds) {
  const { width, height } = resizeCanvas();
  ctx.clearRect(0, 0, width, height);
  if (!["countdown", "playing", "results"].includes(state.phase)) return;

  drawArena(width, height);
  drawPowerUp(state.game.powerUp, width, height, now);
  const frozen = (state.game.activeEffects.freeze || 0) > now;
  drawPaddle(state.game.ai, "#a78bfa", "AI", width, height, frozen);
  drawPaddle(state.game.player, "#67e8f9", "YOU", width, height, false);
  for (const puck of state.game.pucks) drawPuck(puck, width, height, now);
  updateAndDrawParticles(now, deltaSeconds, width, height);
}

function finishRound() {
  if (state.phase !== "playing") return;
  state.phase = "results";
  state.game.longestRally = Math.max(state.game.longestRally, state.game.rallyHits);
  const { player, ai } = state.game.scores;
  const best = Math.max(Number(localStorage.getItem("neuroverse:pulse-pong-best") || 0), player);
  localStorage.setItem("neuroverse:pulse-pong-best", String(best));

  let title;
  let subtitle;
  if (player > ai) {
    [title, subtitle] = choose([
      ["YOU COOKED THE AI", "That robot is updating its résumé after this."],
      ["HUMANITY SURVIVES", "The machines will remember this disrespect."],
      ["PALM OF THE MATCH", "Your defence had main-character energy."],
    ]);
  } else if (player < ai) {
    [title, subtitle] = choose([
      ["THE AI GOT TOO COMFORTABLE", "Run it back before it starts posting highlights."],
      ["ROBOT WON. BARELY.", "We are blaming the lighting and moving on."],
      ["REVENGE ROUND REQUIRED", "That score cannot be allowed to leave this screen."],
    ]);
  } else {
    [title, subtitle] = choose([
      ["UNRESOLVED BEEF", "Even the scoreboard refused to choose a side."],
      ["PERFECTLY CHAOTIC", "Nobody won, but the power-ups definitely did."],
    ]);
  }

  elements.resultTitle.textContent = title;
  elements.resultSubtitle.textContent = subtitle;
  elements.finalPlayerScore.textContent = String(player);
  elements.finalAiScore.textContent = String(ai);
  elements.powerUpsStat.textContent = String(state.game.totalPowerUps);
  elements.rallyStat.textContent = String(state.game.longestRally);
  elements.bestScoreStat.textContent = String(best);
  setHidden(elements.resultOverlay, false);
  setHidden(elements.momentBanner, true);
  playTone(player >= ai ? 440 : 180, 0.35, 0.05, "triangle", player >= ai ? 880 : 82);
}

function beginCountdown(inputMode) {
  ensureAudio();
  state.inputMode = inputMode;
  state.game = createGameState(performance.now());
  state.game.player.targetX = 0.5;
  state.game.player.targetY = 0.76;
  state.rawInput = { x: 0.5, y: 0.72 };
  state.inputVelocity = { x: 0, y: 0 };
  state.lastInputSampleAt = 0;
  handFilterX.reset();
  handFilterY.reset();
  state.particles = [];
  state.phase = "countdown";
  state.countdownEndsAt = performance.now() + 3_050;
  state.lastFrameAt = performance.now();
  state.accumulator = 0;
  state.lastHudAt = 0;
  setHidden(elements.setupOverlay, true);
  setHidden(elements.resultOverlay, true);
  setHidden(elements.errorOverlay, true);
  setHidden(elements.hud, false);
  setHidden(elements.countdown, false);
  updateScoreUI();
  updateEffectTray(performance.now());
}

function updateCountdown(now) {
  const remaining = state.countdownEndsAt - now;
  if (remaining <= 0) {
    state.phase = "playing";
    state.roundEndsAt = now + ROUND_DURATION_MS;
    state.lastFrameAt = now;
    setHidden(elements.countdown, true);
    showMoment("Round live", "DEFEND YOUR GOAL", "Power-ups spawn in your half. Go get them.", "#c8ff62");
    playTone(520, 0.18, 0.05, "triangle", 980);
    return;
  }
  setText(elements.countdownValue, Math.max(1, Math.ceil(remaining / 1_000)));
}

function gameLoop(now) {
  const frameSeconds = Math.min(Math.max(0, (now - state.lastFrameAt) / 1_000), MAX_FRAME_SECONDS);
  state.lastFrameAt = now;

  if (state.phase === "countdown") updateCountdown(now);
  if (state.phase === "playing") {
    updateInputTarget(now);
    state.accumulator += frameSeconds;
    while (state.accumulator >= FIXED_STEP_SECONDS) {
      const events = stepGame(state.game, FIXED_STEP_SECONDS, now);
      if (events.length) handleGameEvents(events, now);
      state.accumulator -= FIXED_STEP_SECONDS;
    }

    const remaining = Math.max(0, state.roundEndsAt - now);
    if (now - state.lastHudAt >= HUD_INTERVAL_MS) {
      setText(elements.timerValue, (remaining / 1_000).toFixed(1));
      updateEffectTray(now);
      state.lastHudAt = now;
    }
    if (remaining <= 0) finishRound();
  }

  drawFrame(now, frameSeconds);
  requestAnimationFrame(gameLoop);
}

function pointerInput(event) {
  if (state.inputMode !== "pointer" || !["countdown", "playing"].includes(state.phase)) return;
  const rect = elements.canvas.getBoundingClientRect();
  state.rawInput.x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  state.rawInput.y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
  state.inputVelocity.x = 0;
  state.inputVelocity.y = 0;
}

function palmOpenness(landmarks) {
  const wrist = landmarks[0];
  const pairs = [[8, 6], [12, 10], [16, 14], [20, 18]];
  return pairs.reduce((count, [tip, joint]) => {
    const tipDistance = Math.hypot(landmarks[tip].x - wrist.x, landmarks[tip].y - wrist.y);
    const jointDistance = Math.hypot(landmarks[joint].x - wrist.x, landmarks[joint].y - wrist.y);
    return count + (tipDistance > jointDistance * 1.08 ? 1 : 0);
  }, 0);
}

function receiveHandLandmarks(landmarks, sampleTime) {
  if (!landmarks) {
    state.openPalm = false;
    return;
  }
  const palmIndices = [0, 5, 9, 13, 17];
  const palm = palmIndices.reduce((sum, index) => ({
    x: sum.x + landmarks[index].x,
    y: sum.y + landmarks[index].y,
  }), { x: 0, y: 0 });
  const targetX = 1 - palm.x / palmIndices.length;
  const targetY = palm.y / palmIndices.length;
  const reacquired = !state.handTracked || sampleTime - state.lastInputSampleAt > 0.28;
  if (reacquired) {
    handFilterX.reset();
    handFilterY.reset();
    state.inputVelocity = { x: 0, y: 0 };
  }
  const filteredX = handFilterX.filter(targetX * 1_000, sampleTime) / 1_000;
  const filteredY = handFilterY.filter(targetY * 1_000, sampleTime) / 1_000;
  const delta = sampleTime - state.lastInputSampleAt;
  if (!reacquired && delta > 0.004 && delta < 0.2) {
    const measuredX = clamp((filteredX - state.rawInput.x) / delta, -3.2, 3.2);
    const measuredY = clamp((filteredY - state.rawInput.y) / delta, -3.2, 3.2);
    state.inputVelocity.x += (measuredX - state.inputVelocity.x) * 0.58;
    state.inputVelocity.y += (measuredY - state.inputVelocity.y) * 0.58;
  }
  state.rawInput.x = filteredX;
  state.rawInput.y = filteredY;
  state.openPalm = palmOpenness(landmarks) >= 3;
  state.handTracked = true;
  state.lastInputSampleAt = sampleTime;
  state.lastHandSeenAt = performance.now();
}

function friendlyCameraError(error) {
  if (error?.name === "NotAllowedError") return "Camera permission was blocked. Allow it in the browser, or use mouse / touch.";
  if (error?.name === "NotReadableError") return "The camera is being used by another app. Close it there, or use mouse / touch.";
  if (error?.name === "NotFoundError") return "No camera was found. Mouse / touch mode is ready instead.";
  if (error?.message) return error.message;
  return `Camera could not start. ${error?.message || "Mouse / touch mode is still available."}`;
}

function showRuntimeCameraError(error) {
  setText(elements.errorText, friendlyCameraError(error));
  setHidden(elements.errorOverlay, false);
}

function stopCamera() {
  handTracker.stop();
  state.cameraReady = false;
  state.handTracked = false;
  state.openPalm = false;
  state.lastHandSeenAt = 0;
  state.inputVelocity = { x: 0, y: 0 };
  state.lastInputSampleAt = 0;
  handFilterX.reset();
  handFilterY.reset();
}

async function setupCamera() {
  elements.startButton.disabled = true;
  elements.startButton.textContent = "Preparing camera…";
  elements.cameraStatus.textContent = "Starting local hand tracking…";
  elements.cameraStatus.classList.remove("ready");
  setHidden(elements.errorOverlay, true);

  try {
    stopCamera();
    const ready = await handTracker.start((status) => setText(elements.cameraStatus, status));
    if (!ready) return;
    state.cameraReady = true;
    elements.startButton.disabled = false;
    elements.startButton.textContent = "Start 40-second match";
    elements.cameraStatus.textContent = "Camera ready · your video stays on this device";
    elements.cameraStatus.classList.add("ready");
  } catch (error) {
    elements.cameraStatus.textContent = friendlyCameraError(error);
    elements.startButton.textContent = "Camera unavailable";
  }
}

function shiftPausedTimes(duration) {
  state.roundEndsAt += duration;
  state.countdownEndsAt += duration;
  state.game.nextPowerUpAt += duration;
  if (state.game.powerUp) {
    state.game.powerUp.spawnedAt += duration;
    state.game.powerUp.expiresAt += duration;
  }
  for (const type of Object.keys(state.game.activeEffects)) state.game.activeEffects[type] += duration;
  for (const puck of state.game.pucks) {
    if (puck.serveAt) puck.serveAt += duration;
    if (puck.bonusUntil) puck.bonusUntil += duration;
  }
}

elements.startButton.addEventListener("click", () => beginCountdown("camera"));
elements.mouseButton.addEventListener("click", () => beginCountdown("pointer"));
elements.errorMouseButton.addEventListener("click", () => {
  setHidden(elements.errorOverlay, true);
  beginCountdown("pointer");
});
elements.retryButton.addEventListener("click", () => void setupCamera());
elements.playAgainButton.addEventListener("click", () => beginCountdown(state.inputMode));
elements.menuButton.addEventListener("click", () => {
  state.phase = "setup";
  setHidden(elements.resultOverlay, true);
  setHidden(elements.hud, true);
  setHidden(elements.setupOverlay, false);
  setHidden(elements.momentBanner, true);
  state.particles = [];
});
elements.soundButton.addEventListener("click", () => {
  state.soundEnabled = !state.soundEnabled;
  elements.soundButton.setAttribute("aria-pressed", String(!state.soundEnabled));
  elements.soundButton.textContent = state.soundEnabled ? "♪" : "×";
  elements.soundButton.setAttribute("aria-label", state.soundEnabled ? "Mute sound" : "Enable sound");
});

elements.canvas.addEventListener("pointerdown", (event) => {
  elements.canvas.setPointerCapture?.(event.pointerId);
  pointerInput(event);
});
elements.canvas.addEventListener("pointermove", pointerInput);
window.addEventListener("resize", resizeCanvas, { passive: true });
window.addEventListener("neuroverse:viewportchange", resizeCanvas);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && ["playing", "countdown"].includes(state.phase)) {
    state.pausedAt = performance.now();
    setHidden(elements.pauseCard, false);
  } else if (!document.hidden && state.pausedAt) {
    const duration = performance.now() - state.pausedAt;
    shiftPausedTimes(duration);
    state.pausedAt = 0;
    state.lastFrameAt = performance.now();
    setHidden(elements.pauseCard, true);
  }
});
window.addEventListener("beforeunload", stopCamera);
window.addEventListener("error", (event) => {
  if (event.message && state.phase === "setup") elements.cameraStatus.textContent = `Game setup issue: ${event.message}`;
});

resizeCanvas();
requestAnimationFrame(gameLoop);
void setupCamera();
