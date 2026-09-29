import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  POWER_UP_ORDER,
  activatePowerUp,
  choosePowerUp,
  createGameState,
  mapPlayerTarget,
  spawnPowerUp,
  stepGame,
} from "../physics.js";

const fixedRandom = () => 0.25;

{
  const normal = mapPlayerTarget(0.2, 0.25, false);
  const reverse = mapPlayerTarget(0.2, 0.25, true);
  assert.ok(normal.x < 0.5, "normal control should stay on the same horizontal side");
  assert.ok(reverse.x > 0.5, "reverse mode should flip horizontal control");
  assert.ok(reverse.y > normal.y, "reverse mode should also flip depth inside the player zone");
}

{
  const game = createGameState(0, fixedRandom);
  for (const type of POWER_UP_ORDER) {
    activatePowerUp(game, type, 1_000, fixedRandom);
    assert.ok(game.activeEffects[type] > 1_000, `${type} should receive an expiry time`);
  }
  assert.ok(game.player.radius > game.player.baseRadius, "giant hand should enlarge the player paddle");
  assert.equal(game.pucks.length, 2, "multiball should add a second puck");
}

{
  const game = createGameState(0, fixedRandom);
  game.nextPowerUpAt = Number.POSITIVE_INFINITY;
  activatePowerUp(game, "freeze", 1_000, fixedRandom);
  game.ai.x = 0.25;
  game.ai.previousX = 0.25;
  stepGame(game, 1 / 60, 1_200, fixedRandom);
  assert.equal(game.ai.x, 0.25, "freeze should stop the AI paddle");
}

{
  const game = createGameState(0, fixedRandom);
  game.nextPowerUpAt = Number.POSITIVE_INFINITY;
  const puck = game.pucks[0];
  puck.x = 0.5;
  puck.y = 0.105;
  puck.vx = 0;
  puck.vy = -0.5;
  const events = stepGame(game, 1 / 60, 500, fixedRandom);
  assert.equal(game.scores.player, 1, "crossing the top goal should score for the player");
  assert.ok(events.some((event) => event.type === "goal" && event.scorer === "player"));
}

{
  const game = createGameState(0, fixedRandom);
  game.nextPowerUpAt = Number.POSITIVE_INFINITY;
  spawnPowerUp(game, 100, fixedRandom, "reverse");
  game.powerUp.x = game.player.x;
  game.powerUp.y = game.player.y;
  const events = stepGame(game, 1 / 120, 200, fixedRandom);
  assert.ok(events.some((event) => event.type === "powerup" && event.powerUp === "reverse"));
  assert.equal(game.totalPowerUps, 1, "touching a power-up should count one collection");
}

{
  const game = createGameState(0, fixedRandom);
  game.nextPowerUpAt = Number.POSITIVE_INFINITY;
  activatePowerUp(game, "giant_hand", 0, fixedRandom);
  stepGame(game, 1 / 60, 7_100, fixedRandom);
  assert.equal(game.player.radius, game.player.baseRadius, "giant hand should expire cleanly");
}

{
  const picked = choosePowerUp("giant_hand", () => 0);
  assert.notEqual(picked, "giant_hand", "the same power-up should not repeat immediately");
}

{
  const source = await readFile(new URL("../game.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(source, /new HandTracker\(/, "hand inference should use the background-worker tracker");
  assert.match(source, /HUD_INTERVAL_MS/, "high-frequency HUD work should be throttled");
  assert.doesNotMatch(source, /\.hands\.send\(/, "MediaPipe inference must not block the animation thread");
  assert.doesNotMatch(source, /replaceChildren\(/, "the HUD should update existing power-up chips in place");
  assert.doesNotMatch(html, /mediapipe-hands\/hands\.js/, "the legacy main-thread tracker should not load");
  assert.doesNotMatch(source, /questpass:completed/, "the standalone game should not depend on QuestPass");
}

console.log("Pulse Pong physics, five power-ups, and smooth-input checks passed.");
