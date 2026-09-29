export const ARENA = Object.freeze({
  left: 0.08,
  right: 0.92,
  top: 0.1,
  bottom: 0.9,
  centreY: 0.5,
  goalLeft: 0.36,
  goalRight: 0.64,
  playerMinY: 0.56,
  playerMaxY: 0.84,
  aiMinY: 0.16,
  aiMaxY: 0.44,
});

export const POWER_UPS = Object.freeze({
  giant_hand: { label: "GIANT HAND", shortLabel: "GIANT", symbol: "◎", colour: "#67e8f9", durationMs: 7_000 },
  multiball: { label: "MULTIBALL PANIC", shortLabel: "2X PUCK", symbol: "✦", colour: "#c8ff62", durationMs: 8_000 },
  freeze: { label: "AI FROZEN", shortLabel: "FREEZE", symbol: "❄", colour: "#a5f3fc", durationMs: 4_500 },
  speed_glitch: { label: "SPEED GLITCH", shortLabel: "TURBO", symbol: "⚡", colour: "#fb7185", durationMs: 5_000 },
  reverse: { label: "REVERSE MODE", shortLabel: "REVERSE", symbol: "↺", colour: "#c084fc", durationMs: 3_500 },
});

export const POWER_UP_ORDER = Object.freeze(Object.keys(POWER_UPS));

const BASE_PUCK_SPEED = 0.44;
const MAX_PUCK_SPEED = 0.88;
const PLAYER_RADIUS = 0.052;
const AI_RADIUS = 0.048;
const PUCK_RADIUS = 0.019;

export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function randomBetween(minimum, maximum, rng = Math.random) {
  return minimum + rng() * (maximum - minimum);
}

export function mapPlayerTarget(x, y, reversed = false) {
  const safeX = clamp(x, 0, 1);
  const safeY = clamp(y, 0, 1);
  const mappedX = reversed ? 1 - safeX : safeX;
  const mappedY = reversed ? 1 - safeY : safeY;

  return {
    x: clamp(mappedX, ARENA.left + PLAYER_RADIUS, ARENA.right - PLAYER_RADIUS),
    y: ARENA.playerMinY + mappedY * (ARENA.playerMaxY - ARENA.playerMinY),
  };
}

function launchVelocity(direction, rng = Math.random, speed = BASE_PUCK_SPEED) {
  const angle = randomBetween(-0.58, 0.58, rng);
  return { vx: Math.sin(angle) * speed, vy: Math.cos(angle) * speed * direction };
}

export function createPuck(id = "main", direction = -1, rng = Math.random) {
  const velocity = launchVelocity(direction, rng);
  return {
    id,
    x: 0.5,
    y: 0.5,
    vx: velocity.vx,
    vy: velocity.vy,
    radius: PUCK_RADIUS,
    active: true,
    serveAt: 0,
    trail: [],
  };
}

export function createGameState(now = 0, rng = Math.random) {
  return {
    scores: { player: 0, ai: 0 },
    player: {
      x: 0.5, y: 0.76, previousX: 0.5, previousY: 0.76, vx: 0, vy: 0,
      radius: PLAYER_RADIUS, baseRadius: PLAYER_RADIUS, targetX: 0.5, targetY: 0.76,
    },
    ai: {
      x: 0.5, y: 0.24, previousX: 0.5, previousY: 0.24, vx: 0, vy: 0,
      radius: AI_RADIUS, baseRadius: AI_RADIUS,
    },
    pucks: [createPuck("main", rng() > 0.5 ? 1 : -1, rng)],
    powerUp: null,
    activeEffects: {},
    nextPowerUpAt: now + randomBetween(4_800, 6_800, rng),
    lastPowerUpType: null,
    totalPowerUps: 0,
    longestRally: 0,
    rallyHits: 0,
    goals: [],
  };
}

export function choosePowerUp(lastType = null, rng = Math.random) {
  const choices = POWER_UP_ORDER.filter((type) => type !== lastType);
  return choices[Math.floor(rng() * choices.length)] || POWER_UP_ORDER[0];
}

export function spawnPowerUp(game, now, rng = Math.random, forcedType = null) {
  if (game.powerUp) return game.powerUp;
  const type = forcedType || choosePowerUp(game.lastPowerUpType, rng);
  game.powerUp = {
    type,
    x: randomBetween(ARENA.left + 0.11, ARENA.right - 0.11, rng),
    y: randomBetween(0.58, 0.79, rng),
    radius: 0.036,
    spawnedAt: now,
    expiresAt: now + 7_000,
  };
  return game.powerUp;
}

function addMultiball(game, now, rng = Math.random) {
  if (game.pucks.some((puck) => puck.id === "bonus")) return;
  const bonus = createPuck("bonus", rng() > 0.5 ? 1 : -1, rng);
  bonus.x = randomBetween(0.39, 0.61, rng);
  bonus.y = 0.5;
  bonus.bonusUntil = now + POWER_UPS.multiball.durationMs;
  game.pucks.push(bonus);
}

export function activatePowerUp(game, type, now, rng = Math.random) {
  const definition = POWER_UPS[type];
  if (!definition) throw new Error(`Unknown power-up: ${type}`);

  game.lastPowerUpType = type;
  game.totalPowerUps += 1;
  game.activeEffects[type] = now + definition.durationMs;
  if (type === "giant_hand") game.player.radius = game.player.baseRadius * 1.62;
  if (type === "multiball") addMultiball(game, now, rng);
  game.powerUp = null;
  game.nextPowerUpAt = now + randomBetween(6_000, 8_500, rng);
  return { type, definition };
}

function expireEffects(game, now) {
  for (const [type, expiresAt] of Object.entries(game.activeEffects)) {
    if (now < expiresAt) continue;
    delete game.activeEffects[type];
    if (type === "giant_hand") game.player.radius = game.player.baseRadius;
  }
  game.pucks = game.pucks.filter((puck) => puck.id !== "bonus" || now < (puck.bonusUntil || 0));
}

function updatePaddleVelocity(paddle, deltaSeconds) {
  const safeDelta = Math.max(deltaSeconds, 1 / 240);
  paddle.vx = (paddle.x - paddle.previousX) / safeDelta;
  paddle.vy = (paddle.y - paddle.previousY) / safeDelta;
  paddle.previousX = paddle.x;
  paddle.previousY = paddle.y;
}

function updatePlayer(game, deltaSeconds) {
  const player = game.player;
  // The landmarks are already filtered before they reach the physics layer.
  // Keep only a short visual ease here so the paddle feels attached to the
  // palm instead of trailing behind it.
  const response = 1 - Math.exp(-deltaSeconds * 34);
  player.x += (player.targetX - player.x) * response;
  player.y += (player.targetY - player.y) * response;
  player.x = clamp(player.x, ARENA.left + player.radius, ARENA.right - player.radius);
  player.y = clamp(player.y, ARENA.playerMinY, ARENA.playerMaxY);
  updatePaddleVelocity(player, deltaSeconds);
}

function targetPuckForAI(game) {
  const active = game.pucks.filter((puck) => puck.active);
  return active.reduce((closest, puck) => {
    if (!closest) return puck;
    return Math.abs(puck.y - game.ai.y) < Math.abs(closest.y - game.ai.y) ? puck : closest;
  }, null);
}

function updateAI(game, deltaSeconds, now) {
  const ai = game.ai;
  const frozen = (game.activeEffects.freeze || 0) > now;
  const puck = targetPuckForAI(game);
  const targetX = puck ? clamp(puck.x + puck.vx * 0.13, 0.17, 0.83) : 0.5;
  const targetY = puck && puck.y < 0.52 ? clamp(puck.y - 0.08, 0.2, 0.4) : 0.24;
  const maxMove = (frozen ? 0 : 0.36) * deltaSeconds;
  const dx = targetX - ai.x;
  const dy = targetY - ai.y;
  const distance = Math.hypot(dx, dy) || 1;
  const movement = Math.min(distance, maxMove);
  ai.x += (dx / distance) * movement;
  ai.y += (dy / distance) * movement;
  ai.x = clamp(ai.x, ARENA.left + ai.radius, ARENA.right - ai.radius);
  ai.y = clamp(ai.y, ARENA.aiMinY, ARENA.aiMaxY);
  updatePaddleVelocity(ai, deltaSeconds);
}

function collidePuckWithPaddle(puck, paddle, isPlayer) {
  if (!puck.active) return false;
  const dx = puck.x - paddle.x;
  const dy = puck.y - paddle.y;
  const minimumDistance = puck.radius + paddle.radius;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared >= minimumDistance * minimumDistance) return false;

  const distance = Math.sqrt(distanceSquared) || minimumDistance;
  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = minimumDistance - distance;
  puck.x += nx * overlap;
  puck.y += ny * overlap;

  const approaching = puck.vx * nx + puck.vy * ny;
  if (approaching < 0) {
    puck.vx -= 2 * approaching * nx;
    puck.vy -= 2 * approaching * ny;
  }
  puck.vx += paddle.vx * 0.12;
  puck.vy += paddle.vy * 0.10;
  if (isPlayer) puck.vy = Math.min(puck.vy, -0.24);
  else puck.vy = Math.max(puck.vy, 0.24);

  const speed = clamp(Math.hypot(puck.vx, puck.vy) * 1.035, BASE_PUCK_SPEED, MAX_PUCK_SPEED);
  const angle = Math.atan2(puck.vy, puck.vx);
  puck.vx = Math.cos(angle) * speed;
  puck.vy = Math.sin(angle) * speed;
  return true;
}

function resetPuckAfterGoal(puck, scoringSide, now, rng = Math.random) {
  const direction = scoringSide === "player" ? 1 : -1;
  const velocity = launchVelocity(direction, rng);
  puck.x = 0.5;
  puck.y = 0.5;
  puck.vx = velocity.vx;
  puck.vy = velocity.vy;
  puck.active = false;
  puck.serveAt = now + 780;
  puck.trail = [];
}

function updatePuck(game, puck, deltaSeconds, now, rng, events) {
  if (!puck.active) {
    if (now >= puck.serveAt) puck.active = true;
    else return;
  }
  const speedMultiplier = (game.activeEffects.speed_glitch || 0) > now ? 1.52 : 1;
  puck.x += puck.vx * deltaSeconds * speedMultiplier;
  puck.y += puck.vy * deltaSeconds * speedMultiplier;

  if (puck.x - puck.radius <= ARENA.left) {
    puck.x = ARENA.left + puck.radius;
    puck.vx = Math.abs(puck.vx);
    events.push({ type: "wall", puckId: puck.id });
  } else if (puck.x + puck.radius >= ARENA.right) {
    puck.x = ARENA.right - puck.radius;
    puck.vx = -Math.abs(puck.vx);
    events.push({ type: "wall", puckId: puck.id });
  }

  const insideGoal = puck.x > ARENA.goalLeft && puck.x < ARENA.goalRight;
  if (puck.y - puck.radius <= ARENA.top) {
    if (insideGoal) {
      game.scores.player += 1;
      game.goals.push("player");
      game.longestRally = Math.max(game.longestRally, game.rallyHits);
      game.rallyHits = 0;
      events.push({ type: "goal", scorer: "player", puckId: puck.id });
      resetPuckAfterGoal(puck, "player", now, rng);
      return;
    }
    puck.y = ARENA.top + puck.radius;
    puck.vy = Math.abs(puck.vy);
    events.push({ type: "wall", puckId: puck.id });
  } else if (puck.y + puck.radius >= ARENA.bottom) {
    if (insideGoal) {
      game.scores.ai += 1;
      game.goals.push("ai");
      game.longestRally = Math.max(game.longestRally, game.rallyHits);
      game.rallyHits = 0;
      events.push({ type: "goal", scorer: "ai", puckId: puck.id });
      resetPuckAfterGoal(puck, "ai", now, rng);
      return;
    }
    puck.y = ARENA.bottom - puck.radius;
    puck.vy = -Math.abs(puck.vy);
    events.push({ type: "wall", puckId: puck.id });
  }

  if (collidePuckWithPaddle(puck, game.player, true)) {
    game.rallyHits += 1;
    events.push({ type: "paddle", side: "player", puckId: puck.id });
  }
  if (collidePuckWithPaddle(puck, game.ai, false)) {
    game.rallyHits += 1;
    events.push({ type: "paddle", side: "ai", puckId: puck.id });
  }
  puck.trail.push({ x: puck.x, y: puck.y, at: now });
  if (puck.trail.length > 11) puck.trail.shift();
}

function collectPowerUpIfTouched(game, now, rng, events) {
  const powerUp = game.powerUp;
  if (!powerUp) return;
  if (now >= powerUp.expiresAt) {
    game.powerUp = null;
    game.nextPowerUpAt = now + randomBetween(2_500, 4_000, rng);
    events.push({ type: "powerup-missed", powerUp: powerUp.type });
    return;
  }
  const distance = Math.hypot(game.player.x - powerUp.x, game.player.y - powerUp.y);
  if (distance <= game.player.radius + powerUp.radius) {
    const activated = activatePowerUp(game, powerUp.type, now, rng);
    events.push({ type: "powerup", powerUp: activated.type });
  }
}

export function stepGame(game, deltaSeconds, now, rng = Math.random) {
  const safeDelta = clamp(deltaSeconds, 0, 1 / 30);
  const events = [];
  expireEffects(game, now);
  updatePlayer(game, safeDelta);
  updateAI(game, safeDelta, now);
  if (!game.powerUp && now >= game.nextPowerUpAt) {
    const spawned = spawnPowerUp(game, now, rng);
    events.push({ type: "powerup-spawned", powerUp: spawned.type });
  }
  collectPowerUpIfTouched(game, now, rng, events);
  for (const puck of game.pucks) updatePuck(game, puck, safeDelta, now, rng, events);
  return events;
}

export function activeEffectLabels(game, now) {
  return Object.entries(game.activeEffects)
    .filter(([, expiresAt]) => expiresAt > now)
    .map(([type, expiresAt]) => ({
      type,
      label: POWER_UPS[type].shortLabel,
      colour: POWER_UPS[type].colour,
      remainingMs: expiresAt - now,
    }));
}
