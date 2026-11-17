// The bots: nine of them, four Vipers beside the player and five Sentinels
// against. One brain, three jobs: walk a route, hold a lane, win a fight. A bot
// sees through the world's segment test (a 100-degree cone out to 55 m), hears
// shots inside 25 m, and fights in bursts with a reaction time and an aim error
// set by its skill. It plants the spike when it carries it, defuses when the
// other team plants, and rotates to the sound of gunfire when it has nothing
// better to do. No bot knows anything the player could not know: no wallhacks,
// no perfect aim.
import * as THREE from "three";
import { createBody } from "./body.js";
import { WEAPONS } from "./config.js";
import { HOLDS } from "./world.js";

const NAMES = {
  vipers: ["Ash", "Bramble", "Cinder", "Dune"],
  sentinels: ["Frost", "Gale", "Heron", "Ivy", "Juno"],
};
const SKILLS = [
  { reaction: 0.8, error: 0.035, burst: 3, name: "rookie" },
  { reaction: 0.55, error: 0.022, burst: 4, name: "regular" },
  { reaction: 0.35, error: 0.013, burst: 5, name: "veteran" },
];
const SEE_RANGE = 55;
const HEAR_RANGE = 25;
const FOV_COS = 0.64; // cos(50 degrees): the half-cone a bot sees.

// The bot's visible body: torso and vest, head and helmet, two legs, a gun.
// The torso and head are the hitboxes; the rest is only for show.
function makeBotMesh(scene, team) {
  const group = new THREE.Group();
  const teamColor = team === "vipers" ? 0xd98a1f : 0x4f8a9e;
  const torsoMat = new THREE.MeshStandardMaterial({
    color: teamColor,
    roughness: 0.65,
    metalness: 0.05,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x22242a,
    roughness: 0.8,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xc9a184,
    roughness: 0.7,
  });
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.78, 0.3),
    torsoMat,
  );
  torso.position.y = 1.0;
  const vest = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.4, 0.34),
    darkMat,
  );
  vest.position.y = 1.05;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.155, 14, 10),
    skinMat,
  );
  head.position.y = 1.53;
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(
      0.17,
      14,
      10,
      0,
      Math.PI * 2,
      0,
      Math.PI / 2,
    ),
    darkMat,
  );
  helmet.position.y = 1.55;
  const legL = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.7, 0.2),
    darkMat,
  );
  legL.position.set(-0.13, 0.35, 0);
  const legR = legL.clone();
  legR.position.x = 0.13;
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.09, 0.5),
    darkMat,
  );
  gun.position.set(0.2, 1.15, -0.3);
  group.add(torso, vest, head, helmet, legL, legR, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  scene.add(group);
  return { group, torso, head, legL, legR };
}

export function createBots(scene, world, combat, hooks) {
  // Reused scratch vectors, so a bot's thinking allocates nothing per frame.
  const eye = new THREE.Vector3();
  const aimDir = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const bots = [];

  function makeBot(team, index, spawn) {
    const skill = SKILLS[index % 3];
    const weaponId = index === 4
      ? "sniper"
      : index === 3
        ? "smg"
        : "rifle";
    const parts = makeBotMesh(scene, team);
    const body = createBody(
      world.colliders,
      spawn[0],
      spawn[1],
      team === "vipers" ? Math.PI : 0,
    );
    parts.group.position.set(spawn[0], 0, spawn[1]);
    parts.group.rotation.y = team === "vipers" ? Math.PI : 0;
    const bot = {
      id: `${team}-${index}`,
      name: NAMES[team][index],
      team,
      skill,
      weaponId,
      def: WEAPONS[weaponId],
      mag: WEAPONS[weaponId].mag,
      reserve: WEAPONS[weaponId].reserve,
      body,
      parts,
      hitMeshes: [parts.torso, parts.head],
      health: 100,
      armor: false,
      alive: true,
      state: "route",
      route: [],
      routeIndex: 0,
      hold: null,
      target: null,
      lastSeen: null,
      lastSeenAt: -99,
      hearAt: null,
      hearAtTime: -99,
      reactUntil: 0,
      burstLeft: 0,
      burstPause: 0,
      cooldown: 0,
      strafeDir: 1,
      strafeAt: 0,
      thinkAt: Math.random() * 0.15,
      walkPhase: 0,
      fall: 0,
      plantAt: 0,
      defuseAt: 0,
    };
    parts.torso.userData.bot = bot;
    parts.torso.userData.part = "torso";
    parts.head.userData.bot = bot;
    parts.head.userData.part = "head";
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < 4; i += 1) {
    makeBot("vipers", i, world.spawns.vipers[i + 1]);
  }
  for (let i = 0; i < 5; i += 1) {
    makeBot("sentinels", i, world.spawns.sentinels[i]);
  }
  const vipers = bots.filter((b) => b.team === "vipers");
  const sentinels = bots.filter((b) => b.team === "sentinels");

  function routeTo(bot, waypointId) {
    const from = world.nearestWaypoint(
      bot.body.state.position.x,
      bot.body.state.position.z,
    );
    bot.route = world.route(from, waypointId);
    bot.routeIndex = 0;
    bot.state = "route";
  }

  // Round jobs: attackers send two bots to each site, one through mid, and
  // escort the spike carrier (the player). Defenders hold two on A, two on B,
  // one on mid.
  function assignRoundJobs(attackerSite) {
    const lanes = ["aSite", "bSite", "aSite", "bSite"];
    vipers.forEach((bot, i) => {
      bot.hold = null;
      routeTo(bot, lanes[i]);
    });
    const holds = ["aEast", "bEast", "aYard", "bDepot", "mid"];
    sentinels.forEach((bot, i) => {
      const hold = HOLDS[holds[i]];
      bot.hold = hold;
      routeTo(bot, hold.at);
      bot.state = "toHold";
    });
  }

  // Can this bot see this enemy? Range, then the vision cone, then the line of
  // sight through the world. Returns the sight line or null.
  function canSee(bot, enemy) {
    const body = bot.body.state;
    const ebody = enemy.body ? enemy.body.state : enemy;
    const dx = ebody.position.x - body.position.x;
    const dy = (ebody.position.y + 1.0) - (body.position.y + body.eye);
    const dz = ebody.position.z - body.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > SEE_RANGE) {
      return null;
    }
    forward.set(-Math.sin(body.yaw), 0, -Math.cos(body.yaw));
    if ((dx * forward.x + dz * forward.z) / (dist || 1) < FOV_COS) {
      return null;
    }
    if (
      world.segmentBlocked(
        body.position.x,
        body.position.y + body.eye,
        body.position.z,
        ebody.position.x,
        ebody.position.y + 1.0,
        ebody.position.z,
      )
    ) {
      return null;
    }
    return { dist, dx, dy, dz };
  }

  // Look for the nearest visible enemy. A fresh sighting starts the reaction
  // clock; an old target is dropped 1.2 s after it was last seen.
  function scan(bot, time, enemies) {
    let best = null;
    let bestDist = Infinity;
    for (const enemy of enemies) {
      if (!enemy.alive) {
        continue;
      }
      const seen = canSee(bot, enemy);
      if (seen && seen.dist < bestDist) {
        bestDist = seen.dist;
        best = { enemy, seen };
      }
    }
    if (best) {
      bot.target = best.enemy;
      bot.lastSeen = best.enemy;
      bot.lastSeenAt = time;
      if (bot.reactUntil < time) {
        bot.reactUntil = time + bot.skill.reaction;
      }
    } else if (bot.target && time - bot.lastSeenAt > 1.2) {
      bot.target = null;
    }
    return bot.target;
  }

  // Fire one burst round at the bot's target, with the skill's aim error. The
  // error grows with range, with the target's speed and with the bot's own speed.
  function shootAt(bot, time, dt) {
    const target = bot.target;
    if (!target || !target.alive) {
      return;
    }
    if (time < bot.reactUntil) {
      return;
    }
    bot.cooldown -= dt;
    if (bot.burstLeft <= 0) {
      bot.burstPause -= dt;
      if (bot.burstPause > 0) {
        return;
      }
      bot.burstLeft = bot.skill.burst;
      bot.burstPause = 0.35 + Math.random() * 0.45;
    }
    if (bot.cooldown > 0) {
      return;
    }
    if (bot.mag <= 0) {
      bot.mag = bot.def.mag;
      bot.cooldown = bot.def.reload;
      return;
    }
    bot.cooldown = bot.def.fireGap;
    bot.burstLeft -= 1;
    bot.mag -= 1;
    const body = bot.body.state;
    const tbody = target.body ? target.body.state : target;
    const aimHead = Math.random() < (
      bot.skill.name === "veteran" ? 0.25 : 0.15
    );
    const aimY = tbody.position.y + (aimHead ? 1.53 : 1.0);
    const dx = tbody.position.x - body.position.x;
    const dy = aimY - (body.position.y + body.eye);
    const dz = tbody.position.z - body.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const targetSpeed = target.body ? target.body.groundSpeed() : 0;
    const error = bot.skill.error
      * (1 + dist / 40)
      * (1 + targetSpeed * 0.08)
      * (bot.body.groundSpeed() > 1 ? 1.6 : 1);
    aimDir
      .set(
        dx / dist + (Math.random() * 2 - 1) * error,
        dy / dist + (Math.random() * 2 - 1) * error,
        dz / dist + (Math.random() * 2 - 1) * error,
      )
      .normalize();
    bot.body.eyePosition(eye);
    const hit = combat.fire(eye, aimDir, bot.def, {
      bots,
      playerBody: hooks.playerBody ? hooks.playerBody() : null,
      exclude: bot,
    });
    hooks.onBotShot(bot, hit);
    if (hit && hit.kind === "bot" && hit.target !== bot) {
      hooks.damage(hit.target, hit.damage, bot, hit.part);
    } else if (hit && hit.kind === "player") {
      hooks.damage("player", hit.damage, bot, hit.part);
    }
  }

  function stepBot(bot, dt, time, player, spike) {
    const body = bot.body.state;
    if (!bot.alive) {
      // A dead bot falls over in 0.4 s and stays down.
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.parts.group.rotation.x = -bot.fall * 1.45;
      return;
    }
    bot.thinkAt -= dt;
    const enemies = bots.filter((b) => b.team !== bot.team && b.alive);
    const allEnemies = bot.team === "vipers"
      ? enemies
      : [...enemies, player];
    if (bot.thinkAt <= 0) {
      bot.thinkAt = 0.15;
      scan(bot, time, allEnemies);
    }
    const input = { forward: 0, strafe: 0, crouch: false, jump: false };
    // The spike decides the job: the carrier plants, the defenders defuse, and
    // everyone else fights or rotates to the last sound.
    if (
      spike.status === "planted"
      && bot.team === "sentinels"
      && bot.state !== "rotate"
      && bot.state !== "defuse"
    ) {
      routeTo(bot, spike.site === "A" ? "aSite" : "bSite");
      bot.state = "rotate";
    }
    if (
      spike.status === "dropped"
      && bot.team === "vipers"
      && bot.state !== "fetch"
    ) {
      routeTo(bot, world.nearestWaypoint(spike.x, spike.z));
      bot.state = "fetch";
    }
    if (bot.state === "fetch" && spike.status === "dropped") {
      const dx = spike.x - body.position.x;
      const dz = spike.z - body.position.z;
      if (dx * dx + dz * dz < 2.25) {
        hooks.pickupSpike(bot);
        routeTo(bot, spike.site === "A" ? "aSite" : "bSite");
        bot.state = "plant";
      }
    }
    if (bot.state === "plant" && hooks.carrierIs(bot)) {
      const site = world.sites[spike.site];
      const dx = site.center.x - body.position.x;
      const dz = site.center.z - body.position.z;
      if (dx * dx + dz * dz < site.radius * site.radius) {
        bot.plantAt += dt;
        if (bot.plantAt > 3.5) {
          hooks.plantSpike(bot, spike.site);
          bot.plantAt = 0;
        }
      } else {
        bot.plantAt = 0;
      }
    }
    if (
      bot.state === "rotate"
      && spike.status === "planted"
      && bot.team === "sentinels"
    ) {
      const site = world.sites[spike.site];
      const dx = site.center.x - body.position.x;
      const dz = site.center.z - body.position.z;
      if (dx * dx + dz * dz < 4) {
        bot.defuseAt += dt;
        if (bot.defuseAt > 5) {
          hooks.defuseSpike(bot);
          bot.defuseAt = 0;
        }
      } else {
        bot.defuseAt = 0;
      }
    }
    if (bot.target) {
      // Fight: strafe, face the target, fire in bursts.
      if (time > bot.strafeAt) {
        bot.strafeAt = time + 0.7 + Math.random() * 0.7;
        bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
      }
      input.strafe = bot.strafeDir;
      const tbody = bot.target.body
        ? bot.target.body.state
        : bot.target;
      const dx = tbody.position.x - body.position.x;
      const dz = tbody.position.z - body.position.z;
      body.yaw = Math.atan2(-dx, -dz);
      shootAt(bot, time, dt);
    } else if (
      bot.state === "route"
      || bot.state === "toHold"
      || bot.state === "rotate"
      || bot.state === "fetch"
      || bot.state === "plant"
    ) {
      // Walk the route one waypoint at a time, turning toward the next node
      // and moving only once roughly facing it.
      const node = bot.route[bot.routeIndex];
      if (!node) {
        if (bot.state === "toHold" && bot.hold) {
          bot.state = "hold";
          body.yaw = bot.hold.yaw;
        } else if (bot.state === "plant") {
          // At the site, waiting for the plant: keep scanning the entrance.
          body.yaw += dt * 0.4;
        } else {
          bot.state = "hold";
        }
      } else {
        const point = world.waypoints.get(node);
        const dx = point.x - body.position.x;
        const dz = point.z - body.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.2) {
          bot.routeIndex += 1;
        } else {
          const wantYaw = Math.atan2(-dx, -dz);
          let diff = wantYaw - body.yaw;
          while (diff > Math.PI) {
            diff -= Math.PI * 2;
          }
          while (diff < -Math.PI) {
            diff += Math.PI * 2;
          }
          body.yaw += Math.max(-2.4 * dt, Math.min(2.4 * dt, diff));
          if (Math.abs(diff) < 0.6) {
            input.forward = 1;
          }
        }
      }
    } else if (bot.state === "hold") {
      // Hold: watch the lane, and turn toward the last sound heard.
      if (
        bot.hearAt
        && time - bot.hearAtTime < 4
        && time - bot.lastSeenAt > 2
      ) {
        const dx = bot.hearAt.x - body.position.x;
        const dz = bot.hearAt.z - body.position.z;
        body.yaw = Math.atan2(-dx, -dz);
      }
    }
    bot.body.step(dt, input);
    // The mesh follows the body: legs swing with the stride, the gun points
    // where the bot looks.
    const group = bot.parts.group;
    group.position.set(body.position.x, body.position.y, body.position.z);
    group.rotation.y = body.yaw;
    group.rotation.x = 0;
    const speed = bot.body.groundSpeed();
    bot.walkPhase += dt * speed * 2.2;
    const swing = Math.min(0.5, speed * 0.09) * Math.sin(bot.walkPhase);
    bot.parts.legL.rotation.x = swing;
    bot.parts.legR.rotation.x = -swing;
  }

  return {
    bots,
    assignRoundJobs,
    spawnRound(attackerSite) {
      for (const bot of bots) {
        const spawn = bot.team === "vipers"
          ? world.spawns.vipers[vipers.indexOf(bot) + 1]
          : world.spawns.sentinels[sentinels.indexOf(bot)];
        bot.body.state.position.set(spawn[0], 0, spawn[1]);
        bot.body.state.velocity.set(0, 0, 0);
        bot.body.state.yaw = bot.team === "vipers" ? Math.PI : 0;
        bot.health = 100;
        bot.armor = false;
        bot.alive = true;
        bot.mag = bot.def.mag;
        bot.reserve = bot.def.reserve;
        bot.target = null;
        bot.lastSeen = null;
        bot.hearAt = null;
        bot.fall = 0;
        bot.plantAt = 0;
        bot.defuseAt = 0;
        bot.parts.group.rotation.set(0, bot.body.state.yaw, 0);
        bot.parts.group.position.set(spawn[0], 0, spawn[1]);
      }
      assignRoundJobs(attackerSite);
    },
    step(dt, time, player, spike) {
      for (const bot of bots) {
        stepBot(bot, dt, time, player, spike);
      }
    },
    // A shot tells every living enemy within earshot where it came from.
    notifyShot(position, team, time) {
      for (const bot of bots) {
        if (!bot.alive || bot.team === team) {
          continue;
        }
        const dx = position.x - bot.body.state.position.x;
        const dz = position.z - bot.body.state.position.z;
        if (dx * dx + dz * dz < HEAR_RANGE * HEAR_RANGE) {
          bot.hearAt = { x: position.x, z: position.z };
          bot.hearAtTime = time;
        }
      }
    },
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    reset() {
      for (const bot of bots) {
        bot.alive = true;
        bot.health = 100;
        bot.parts.group.rotation.set(0, 0, 0);
      }
    },
  };
}
