// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. main.js is the glue: it owns the match flow (menu, freeze,
// live, round end, match end), the player's trigger, the damage ledger and the
// HUD sync. The rules live in rounds.js, the aiming in bots.js, the ray in
// combat.js; this file only connects them.
//
// ?shot=play|buy|plant|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { CONFIG } from './config.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createBots } from './bots.js';
import { createCombat } from './combat.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

// Deterministic random for captures: the same seed, the same spread, the same
// bot bursts, so a screenshot can be reproduced exactly.
function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = shot ? mulberry32(seed) : Math.random;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const world = createWorld(scene);
const combat = createCombat(scene, world);
const rounds = createRounds(world);
const player = createPlayer(world, camera);
const hud = createHud();
const audio = createAudio();
const input = createInput(renderer.domElement, onLockChange);

// Reused scratch vectors: the frame loop allocates nothing.
const direction = new THREE.Vector3();
const eye = new THREE.Vector3();
const muzzle = new THREE.Vector3();

const bots = createBots(scene, world, combat, {
  playerBody: () => (player.alive ? player.body.state : null),
  damage: (victim, amount, attacker, part) => applyDamage(victim, amount, attacker, part),
  onBotShot: (bot, hit) => {
    const dist = bot.body.state.position.distanceTo(player.body.state.position);
    audio.enemyShot(dist);
    bots.notifyShot(bot.body.state.position, bot.team, elapsed);
  },
  pickupSpike: (bot) => rounds.pickupSpike(bot),
  carrierIs: (bot) => rounds.carrierIs(bot),
  plantSpike: (bot, site) => {
    if (rounds.plantSpike(bot, site)) handleEvent({ type: 'spikePlanted', site });
  },
  defuseSpike: (bot) => {
    if (rounds.defuseSpike()) handleEvent({ type: 'spikeDefused', site: rounds.state.spike.site });
  },
});

let elapsed = 0;
let started = false;
let frozen = false;
let prevFiring = false;
let shake = 0;
let spectate = null;
let grenadeThrowAt = -1;
let accumulator = 0;
let lastTime = performance.now();
let beepAt = 0;

hud.setHealth(player.health, player.armor);
hud.setMoney(rounds.state.money);
hud.setScore(0, 0, 1);
hud.setTimer(CONFIG.roundSeconds);

// The damage ledger: one place where every hit lands. A bot's kevlar halves
// the hit here; the player's own damage() does the same for the player.
function applyDamage(victim, amount, attacker, part, weaponName) {
  if (victim === 'player') {
    if (!player.alive) return;
    const died = player.damage(amount);
    hud.damageFlash();
    audio.hurt();
    if (died) {
      rounds.state.deaths += 1;
      rounds.dropSpike(player.body.state.position.x, player.body.state.position.z);
      const killerName = attacker && attacker.name ? attacker.name : 'the spike';
      const killerTeam = attacker && attacker.team ? attacker.team : 'sentinels';
      hud.killfeed(killerName, killerTeam, 'You', 'vipers', weaponName || (attacker && attacker.def ? attacker.def.name : 'Spike'), part === 'head');
      hud.showOverlay('dead');
      if (document.pointerLockElement) document.exitPointerLock();
      spectate = null;
    }
    return;
  }
  const bot = victim;
  if (!bot.alive) return;
  const taken = bot.armor ? Math.round(amount * (1 - CONFIG.armorReduction)) : amount;
  bot.health -= taken;
  if (bot.health <= 0) {
    bot.health = 0;
    bot.alive = false;
    const killerName = attacker === player ? 'You' : attacker && attacker.name ? attacker.name : 'the spike';
    const killerTeam = attacker === player ? 'vipers' : attacker && attacker.team ? attacker.team : 'sentinels';
    hud.killfeed(killerName, killerTeam, bot.name, bot.team, weaponName || (attacker && attacker.def ? attacker.def.name : 'Spike'), part === 'head');
    if (attacker === player) {
      rounds.awardKill();
      audio.kill();
      hud.hitMarker(true, 400);
    }
  } else if (attacker === player) {
    audio.hit();
    hud.hitMarker(false, 90);
  }
}

// Every round event becomes a banner, a sound, a score update, or damage.
function handleEvent(event) {
  const rs = rounds.state;
  if (event.type === 'roundStart') {
    bots.spawnRound(event.site);
    player.respawn();
    combat.reset();
    spectate = null;
    hud.setScore(rs.score.vipers, rs.score.sentinels, rs.round);
    hud.setHealth(player.health, player.armor);
    hud.banner(`Round ${rs.round}`, `Plant the spike at site ${event.site} — first to ${CONFIG.roundsToWin} rounds wins the match.`, 3200);
    hud.setBuyHint('B — Buy menu');
  } else if (event.type === 'live') {
    hud.hideBuy();
    hud.setBuyHint('');
  } else if (event.type === 'roundEnd') {
    const won = event.winner === 'vipers';
    const reason = { elimination: 'the other team is wiped out', spike: 'the spike blew', defuse: 'the spike was defused', time: 'time ran out' }[event.reason];
    hud.banner(won ? 'Vipers win the round' : 'Sentinels win the round', `Round ${rs.round}: ${reason}.`, 3600);
    if (won) audio.roundWin(); else audio.roundLose();
    hud.setScore(rs.score.vipers, rs.score.sentinels, rs.round);
    hud.hideBuy();
    hud.setBuyHint('');
  } else if (event.type === 'matchEnd') {
    hud.showMatchEnd(event.winner, event.score);
    if (document.pointerLockElement) document.exitPointerLock();
  } else if (event.type === 'spikePlanted') {
    hud.banner('Spike planted', `Site ${event.site} — defend it for ${CONFIG.spikeSeconds} seconds.`, 3000);
    audio.plantBeep();
  } else if (event.type === 'spikeExploded') {
    audio.explosion();
    const site = world.sites[event.site];
    const victims = [...bots.bots.filter((b) => b.alive)];
    for (const bot of victims) {
      const dx = bot.body.state.position.x - site.center.x;
      const dz = bot.body.state.position.z - site.center.z;
      if (dx * dx + dz * dz < 144) applyDamage(bot, 200, null, 'torso');
    }
    if (player.alive) {
      const dx = player.body.state.position.x - site.center.x;
      const dz = player.body.state.position.z - site.center.z;
      if (dx * dx + dz * dz < 144) applyDamage('player', 200, null, 'torso');
      else if (dx * dx + dz * dz < 400) shake = 0.5;
    }
  } else if (event.type === 'spikeDefused') {
    hud.banner('Spike defused', 'The Sentinels held the site.', 3000);
  }
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    audio.unlock();
  } else if (rounds.state.phase === 'matchEnd') {
    // The match-end panel stays up.
  } else if (player.alive && started) {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (!started || rounds.state.phase === 'matchEnd') {
    started = true;
    player.resetMatch();
    const event = rounds.startMatch();
    handleEvent(event);
    hud.hideOverlay();
    input.requestLock();
  } else {
    hud.hideOverlay();
    input.requestLock();
  }
});

// Which site ring (x, z) stands in, or null outside both rings.
function plantSiteAt(x, z) {
  for (const name of ['A', 'B']) {
    const site = world.sites[name];
    const dx = x - site.center.x;
    const dz = z - site.center.z;
    if (dx * dx + dz * dz < site.radius * site.radius) return name;
  }
  return null;
}

// The player's trigger: spend a round, fire a ray with this gun's spread,
// resolve the hit, play the shot, kick the view, and tell the bots where the
// shot came from.
function shoot(spread) {
  const arsenal = player.arsenal;
  if (!arsenal.takeRound()) {
    audio.dryFire();
    return false;
  }
  const def = arsenal.currentDef();
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  player.eyePosition(eye);
  arsenal.muzzlePosition(muzzle);
  const hit = combat.fire(eye, direction, def, { bots: bots.bots, playerBody: null, exclude: 'player', muzzle });
  if (hit && hit.kind === 'bot') applyDamage(hit.target, hit.damage, player, hit.part);
  audio.shot(arsenal.state.current, 0);
  bots.notifyShot(player.body.state.position, 'vipers', elapsed);
  arsenal.pullTrigger();
  player.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  hud.setAmmo(arsenal.owned[arsenal.state.current].mag, arsenal.owned[arsenal.state.current].reserve, arsenal.currentName());
  return hit;
}

function throwGrenade() {
  const arsenal = player.arsenal;
  if (arsenal.state.grenades <= 0) return;
  if (!arsenal.equipGrenade()) return;
  arsenal.throwGrenade();
  grenadeThrowAt = elapsed;
  camera.getWorldDirection(direction);
  player.eyePosition(eye);
  combat.throwGrenade(eye, direction);
}

function buy(item) {
  const result = rounds.buy(item);
  if (!result.ok) {
    audio.denied();
    hud.setBuyHint(result.reason);
    return;
  }
  const arsenal = player.arsenal;
  if (item === 'grenade') arsenal.addGrenade();
  else if (item === 'armor') player.buyArmor();
  else if (arsenal.buy(item)) arsenal.equip(item);
  audio.buy();
  hud.setMoney(rounds.state.money);
  hud.showBuy({ smg: arsenal.has('smg'), rifle: arsenal.has('rifle'), sniper: arsenal.has('sniper'), grenade: arsenal.state.grenades > 0, armor: player.armor });
  hud.setAmmo(arsenal.owned[arsenal.state.current].mag, arsenal.owned[arsenal.state.current].reserve, arsenal.currentName());
  hud.setHealth(player.health, player.armor);
}

// The camera follows the player's eyes; dead, it spectates a living Viper, or
// watches from above when nobody is left.
function syncCamera() {
  if (!player.alive) {
    if (!spectate || !spectate.alive) {
      spectate = bots.bots.find((b) => b.team === 'vipers' && b.alive) || null;
    }
    if (spectate) {
      spectate.body.eyePosition(eye);
      camera.position.copy(eye);
      camera.rotation.set(spectate.body.state.pitch, spectate.body.state.yaw, 0, 'YXZ');
    } else {
      camera.position.set(0, 20, 12);
      camera.lookAt(0, 0, -4);
    }
    return;
  }
  const body = player.body.state;
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  if (shake > 0) {
    camera.rotation.x += (random() * 2 - 1) * shake * 0.02;
    camera.rotation.y += (random() * 2 - 1) * shake * 0.02;
  }
}

// Push the whole simulation state into the HUD once a frame.
function syncHud() {
  const rs = rounds.state;
  hud.setHealth(player.health, player.armor);
  hud.setMoney(rs.money);
  hud.setTimer(rs.timer);
  hud.setScore(rs.score.vipers, rs.score.sentinels, Math.max(1, rs.round));
  const arsenal = player.arsenal;
  const slot = arsenal.owned[arsenal.state.current];
  hud.setAmmo(slot.mag, slot.reserve, arsenal.currentName());
  const spike = rs.spike;
  if (rs.phase === 'live' || rs.phase === 'freeze') {
    if (spike.status === 'planted') {
      hud.setSpike(`SPIKE PLANTED AT ${spike.site} — ${Math.ceil(spike.explodeIn)}s`, null);
    } else if (spike.status === 'carried' && spike.carrier === 'player') {
      const site = plantSiteAt(player.body.state.position.x, player.body.state.position.z);
      hud.setSpike(site ? `<span class="plant-hint">HOLD E TO PLANT AT ${site}</span>` : 'YOU CARRY THE SPIKE — PLANT AT A OR B', null);
      hud.setPlantProgress(spike.progress / CONFIG.plantSeconds);
    } else if (spike.status === 'carried') {
      hud.setSpike(`${spike.carrier.name.toUpperCase()} CARRIES THE SPIKE`, null);
    } else if (spike.status === 'dropped') {
      hud.setSpike('SPIKE DROPPED — A TEAMMATE WILL FETCH IT', null);
    } else {
      hud.setSpike('', null);
    }
  } else {
    hud.setSpike('', null);
  }
}

// One fixed step: the round clock, the player, the arsenal, the bots, the world
// beacon, and any grenade that bursts this step.
function step(dt) {
  elapsed += dt;
  const rs = rounds.state;
  const frozenPhase = rs.phase !== 'live';
  const planting = input.state.keys.has('KeyE') && rs.phase === 'live' && rs.spike.status === 'carried' && rs.spike.carrier === 'player';
  const plantSite = planting ? plantSiteAt(player.body.state.position.x, player.body.state.position.z) : null;
  const field = {
    planting: Boolean(plantSite),
    plantSite,
    playerX: player.body.state.position.x,
    playerZ: player.body.state.position.z,
    vipersAlive: bots.aliveCount('vipers') + (player.alive ? 1 : 0),
    sentinelsAlive: bots.aliveCount('sentinels'),
    playerAlive: player.alive,
  };
  for (const event of rounds.step(dt, field)) handleEvent(event);
  player.step(dt, input.state.keys, frozenPhase);
  player.arsenal.step(dt);
  if (rs.phase === 'live') bots.step(dt, elapsed, player, rs.spike);
  world.step(elapsed);
  for (const explosion of combat.step(dt)) {
    audio.explosion();
    const victims = [...bots.bots.filter((b) => b.alive)];
    for (const bot of victims) {
      const damage = combat.grenadeDamage(explosion.position, bot.body.state);
      if (damage > 0) applyDamage(bot, damage, player, 'torso', 'Frag grenade');
    }
    if (player.alive) {
      const damage = combat.grenadeDamage(explosion.position, player.body.state);
      if (damage > 0) applyDamage('player', damage, player, 'torso', 'Frag grenade');
      const dist = player.body.state.position.distanceTo(explosion.position);
      if (dist < 15) shake = 0.4;
    }
  }
  if (grenadeThrowAt >= 0 && elapsed - grenadeThrowAt > 0.5) {
    player.arsenal.unequipGrenade();
    grenadeThrowAt = -1;
  }
  if (rs.spike.status === 'planted' && elapsed > beepAt) {
    beepAt = elapsed + 1;
    audio.spikeBeep();
  }
  shake = Math.max(0, shake - dt * 1.2);
}

// Keys tapped this frame: the buy menu, mute, weapon slots, grenade, reload.
function handlePressed(codes) {
  const rs = rounds.state;
  for (const code of codes) {
    if (code === 'KeyB') {
      if (hud.buyOpen()) hud.hideBuy();
      else if (rs.phase === 'freeze' || rs.phase === 'roundEnd') {
        hud.showBuy({ smg: player.arsenal.has('smg'), rifle: player.arsenal.has('rifle'), sniper: player.arsenal.has('sniper'), grenade: player.arsenal.state.grenades > 0, armor: player.armor });
      } else hud.setBuyHint('The buy menu opens between rounds.');
    } else if (code === 'Escape') {
      hud.hideBuy();
    } else if (code === 'KeyM') {
      audio.toggleMute();
    } else if (hud.buyOpen() && ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(code)) {
      buy(['smg', 'rifle', 'sniper', 'grenade', 'armor'][Number(code.slice(5)) - 1]);
    } else if (code === 'Digit1') player.arsenal.equip('pistol');
    else if (code === 'Digit2' && player.arsenal.has('smg')) player.arsenal.equip('smg');
    else if (code === 'Digit3' && player.arsenal.has('rifle')) player.arsenal.equip('rifle');
    else if (code === 'Digit4' && player.arsenal.has('sniper')) player.arsenal.equip('sniper');
    else if (code === 'KeyG') throwGrenade();
    else if (code === 'KeyR') player.arsenal.reload();
  }
}

// The frame loop: look, tapped keys, the trigger, then up to five fixed steps,
// then the camera and the HUD, then the render.
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (player.alive) player.look(look.x, look.y);
    handlePressed(input.takePressed());
    const def = player.arsenal.currentDef();
    const firingEdge = input.state.firing && !prevFiring;
    prevFiring = input.state.firing;
    if (started && player.alive && rounds.state.phase === 'live' && input.state.firing && (def.auto || firingEdge) && player.arsenal.canFire()) {
      shoot(player.arsenal.spread(player.groundSpeed()));
    }
    if (input.state.keys.has('KeyR')) player.arsenal.reload();
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    syncHud();
  }
  renderer.render(scene, camera);
}

// Run the simulation forward without rendering: captures use it to settle.
function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

// Point the player's view at a world point (used by the captures).
function aimAt(point) {
  const body = player.body.state;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

// Build one capture frame. Each shot sets up its own scene: where the player
// stands, what the round state is, and what the HUD shows.
function runShot(name) {
  // Captures must show the HUD at full strength, not mid-fade: transitions off.
  document.getElementById('banner').style.transition = 'none';
  document.getElementById('hitmarker').style.transition = 'none';
  hud.hideOverlay();
  hud.hideBuy();
  started = true;
  player.resetMatch();
  const event = rounds.startMatch();
  handleEvent(event);
  const sentinels = bots.bots.filter((b) => b.team === 'sentinels');
  if (name === 'start') {
    player.body.state.position.set(0.6, 0, 18.6);
    player.body.state.yaw = Math.PI;
    settle(20);
    hud.showOverlay('start');
  } else if (name === 'play') {
    // Jump into a live round: the freeze is skipped, a Sentinel holds mid, and
    // the player fires once, so the tracer and the hit marker are in the frame.
    rounds.state.phase = 'live';
    rounds.state.timer = 82;
    player.body.state.position.set(0, 0, 6);
    player.body.state.yaw = Math.PI;
    settle(20);
    // Place the marks AFTER the settle: the bots walk during the sim, so
    // placing them first would leave the aim point stale and the shot would
    // miss. The scene has not rendered yet, so force the matrices current or
    // the raycast would test the bots where they stood at spawn, not where
    // they stand now. The mark stands in the open hall floor, clear of the
    // server block.
    const bot = sentinels[0];
    bot.body.state.position.set(3, 0, -2);
    bot.body.state.yaw = 0;
    bot.parts.group.position.set(3, 0, -2);
    const bot2 = sentinels[1];
    bot2.body.state.position.set(-5, 0, -9);
    bot2.body.state.yaw = Math.PI / 2;
    bot2.parts.group.position.set(-5, 0, -9);
    scene.updateMatrixWorld(true);
    player.arsenal.buy('rifle');
    player.arsenal.equip('rifle');
    aimAt(new THREE.Vector3(3, 1.1, -2));
    const hit = shoot(0);
    // No settle after the shot: the tracer lives 60 ms and the hit marker
    // 90 ms, and paintTwiceThenReady renders within ~2 frames, so both stay
    // in the frame. The marker's own timer would still hide it before the
    // capture, so hold it open for the shot: the round hit, so the mark is
    // earned, not staged.
    if (hit && hit.kind === 'bot') hud.hitMarker(false, 60000);
  } else if (name === 'buy') {
    hud.showBuy({ smg: false, rifle: false, sniper: false, grenade: false, armor: false });
    player.body.state.position.set(0, 0, 18);
    player.body.state.yaw = Math.PI;
    settle(20);
  } else if (name === 'plant') {
    rounds.state.phase = 'live';
    rounds.state.timer = 64;
    // Stand just south of the ring and look down across it toward the tower:
    // the amber ring reads in the foreground, the mast rising behind it.
    player.body.state.position.set(-25, 0.5, -12.5);
    player.body.state.yaw = Math.PI;
    aimAt(new THREE.Vector3(-25.5, 0.8, -16.5));
    settle(10);
    rounds.state.spike.progress = CONFIG.plantSeconds * 0.6;
    syncHud();
    hud.setSpike('<span class="plant-hint">HOLD E TO PLANT AT A</span>', null);
    hud.setPlantProgress(0.6);
  } else if (name === 'end') {
    rounds.state.phase = 'roundEnd';
    rounds.state.score.vipers = 2;
    rounds.state.score.sentinels = 1;
    rounds.state.round = 3;
    // Hold the banner open for the capture: software rendering is slow enough
    // that the usual 4 s hold can expire before the pixels are taken.
    hud.banner('Vipers win the round', 'Round 3: the other team is wiped out.', 60000);
    player.body.state.position.set(0, 0, 8);
    player.body.state.yaw = Math.PI;
    settle(10);
  }
  syncCamera();
  syncHud();
  paintTwiceThenReady();
}

// Render twice, then freeze the frame and tell the capture tool it is ready.
function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
