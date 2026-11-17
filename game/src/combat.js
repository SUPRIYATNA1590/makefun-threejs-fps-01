// Combat: the one place a shot is resolved. A hitscan ray against the world's
// meshes and the bots' hitboxes, a ray-against-a-body test for the player, tracers
// and impact sparks from fixed pools (nothing is allocated in a hot loop), and
// grenades that fly, bounce and burst. It returns what a shot hit and how hard;
// main.js applies the damage to whoever was hit.
import * as THREE from 'three';
import { GRENADE } from './config.js';

const TRACERS = 20;
const SPARKS = 24;
const GRAVITY = 12;

export function createCombat(scene, world) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 140;
  // Reused scratch vectors: firing a shot allocates nothing.
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const point = new THREE.Vector3();
  const chest = new THREE.Vector3();
  const toTarget = new THREE.Vector3();

  // Tracer pool: thin stretched boxes, one per recent shot, fading in 60 ms.
  const tracers = [];
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < TRACERS; i += 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1), tracerMat);
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, left: 0 });
  }
  let tracerNext = 0;

  // Spark pool: tiny boxes that burst from an impact and fall away.
  const sparks = [];
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc46b });
  for (let i = 0; i < SPARKS; i += 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), sparkMat);
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, velocity: new THREE.Vector3(), left: 0 });
  }
  let sparkNext = 0;

  // One explosion flash, reused by every grenade.
  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  blast.visible = false;
  scene.add(blast);
  let blastLeft = 0;

  const grenades = [];
  const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x2c2f22), roughness: 0.6, metalness: 0.3 });
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  // One reusable mesh list for the raycaster: shooting must not allocate per shot.
  const meshList = [];
  const nextPos = new THREE.Vector3();

  function showTracer(from, to, color) {
    const tracer = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % TRACERS;
    const length = from.distanceTo(to);
    tracer.mesh.position.copy(from).add(to).multiplyScalar(0.5);
    tracer.mesh.lookAt(to);
    tracer.mesh.scale.set(1, 1, Math.max(0.1, length));
    tracer.mesh.material = tracerMat;
    tracer.mesh.visible = true;
    tracer.left = 0.06;
  }

  function burstSparks(at, count) {
    for (let i = 0; i < count; i += 1) {
      const spark = sparks[sparkNext];
      sparkNext = (sparkNext + 1) % SPARKS;
      spark.mesh.position.copy(at);
      spark.velocity.set((Math.random() * 2 - 1) * 4, Math.random() * 4 + 1, (Math.random() * 2 - 1) * 4);
      spark.mesh.visible = true;
      spark.left = 0.4 + Math.random() * 0.2;
    }
  }

  // Ray against one body: a torso box first, then a head sphere. Returns
  // { part, distance } for the nearer of the two, or null on a miss.
  function rayVsBody(from, dir, body) {
    const feet = body.position.y;
    // Torso: a box 0.52 wide, 0.78 tall, 0.3 deep, centred 1.0 m above the feet.
    chest.set(body.position.x, feet + 1.0, body.position.z);
    const half = { x: 0.26, y: 0.39, z: 0.15 };
    let tmin = 0;
    let tmax = 140;
    for (const [o, d, lo, hi] of [[from.x, dir.x, chest.x - half.x, chest.x + half.x], [from.y, dir.y, chest.y - half.y, chest.y + half.y], [from.z, dir.z, chest.z - half.z, chest.z + half.z]]) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) return null;
      } else {
        let t1 = (lo - o) / d;
        let t2 = (hi - o) / d;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return null;
      }
    }
    let best = { part: 'torso', distance: tmin };
    // Head: a sphere 0.155 m across, centred 1.53 m above the feet.
    toTarget.set(body.position.x, feet + 1.53, body.position.z).sub(from);
    const along = toTarget.dot(dir);
    if (along > 0 && along < 140) {
      const closestX = from.x + dir.x * along - body.position.x;
      const closestY = from.y + dir.y * along - (feet + 1.53);
      const closestZ = from.z + dir.z * along - body.position.z;
      const distSq = closestX * closestX + closestY * closestY + closestZ * closestZ;
      if (distSq < 0.155 * 0.155) {
        const headDist = along - Math.sqrt(0.155 * 0.155 - distSq);
        if (headDist < best.distance) best = { part: 'head', distance: headDist };
      }
    }
    return best;
  }

  return {
    // One shot. `targets` is { bots, playerBody, exclude }: bots carry their
    // hitMeshes, playerBody is the player's body state (or null when the player
    // shot). Returns { kind, target, part, point, distance, damage } or null
    // for a clean miss into the sky; a world hit returns kind 'world'.
    fire(from, dir, def, targets) {
      origin.copy(from);
      direction.copy(dir).normalize();
      raycaster.set(origin, direction);
      meshList.length = 0;
      for (const mesh of world.shootables) meshList.push(mesh);
      for (const bot of targets.bots) {
        if (bot === targets.exclude) continue;
        for (const mesh of bot.hitMeshes) meshList.push(mesh);
      }
      const hit = raycaster.intersectObjects(meshList, false)[0];
      let best = null;
      if (hit) {
        const mesh = hit.object;
        if (mesh.userData.bot) best = { kind: 'bot', target: mesh.userData.bot, part: mesh.userData.part, point: hit.point, distance: hit.distance };
        else best = { kind: 'world', point: hit.point, distance: hit.distance };
      }
      if (targets.playerBody && targets.exclude !== 'player') {
        const bodyHit = rayVsBody(origin, direction, targets.playerBody);
        if (bodyHit && (!best || bodyHit.distance < best.distance)) {
          point.copy(origin).addScaledVector(direction, bodyHit.distance);
          best = { kind: 'player', part: bodyHit.part, point: point.clone(), distance: bodyHit.distance };
        }
      }
      const end = best ? best.point : point.copy(origin).addScaledVector(direction, 80);
      // The ray starts at the eye for an honest hit, but the tracer starts at
      // the muzzle when the caller knows it, so it reads as a shot from the gun.
      showTracer(targets.muzzle || from, end, def.tracer);
      if (!best) return null;
      if (best.kind === 'world') {
        burstSparks(best.point, 4);
        return best;
      }
      let damage = def.damage * (best.part === 'head' ? def.headMult : 1);
      if (best.distance > 40) damage *= 0.75;
      best.damage = Math.round(damage);
      return best;
    },
    throwGrenade(from, dir) {
      const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
      mesh.position.copy(from);
      scene.add(mesh);
      grenades.push({
        mesh,
        velocity: new THREE.Vector3(dir.x * 14 + (Math.random() - 0.5), dir.y * 14 + 4.5, dir.z * 14 + (Math.random() - 0.5)),
        fuse: GRENADE.fuse,
      });
    },
    // Step grenades and effects. Returns the explosions this step, each with a
    // position, for main.js to damage and shake with.
    step(dt) {
      const explosions = [];
      for (let i = grenades.length - 1; i >= 0; i -= 1) {
        const g = grenades[i];
        g.fuse -= dt;
        g.velocity.y -= GRAVITY * dt;
        nextPos.copy(g.mesh.position).addScaledVector(g.velocity, dt);
        // Bounce: test the next position against the world boxes, flip the
        // fastest axis and stay where the grenade was.
        for (const c of world.colliders) {
          if (nextPos.x > c.min.x - 0.09 && nextPos.x < c.max.x + 0.09 && nextPos.y > c.min.y - 0.09 && nextPos.y < c.max.y + 0.09 && nextPos.z > c.min.z - 0.09 && nextPos.z < c.max.z + 0.09) {
            if (Math.abs(g.velocity.x) > Math.abs(g.velocity.y) && Math.abs(g.velocity.x) > Math.abs(g.velocity.z)) { g.velocity.x *= -0.4; nextPos.x = g.mesh.position.x; }
            else if (Math.abs(g.velocity.y) > Math.abs(g.velocity.z)) { g.velocity.y *= -0.4; nextPos.y = g.mesh.position.y; }
            else { g.velocity.z *= -0.4; nextPos.z = g.mesh.position.z; }
          }
        }
        g.mesh.position.copy(nextPos);
        if (g.fuse <= 0) {
          explosions.push({ position: g.mesh.position.clone() });
          blast.position.copy(g.mesh.position);
          blast.visible = true;
          blastLeft = 0.35;
          burstSparks(g.mesh.position, 12);
          scene.remove(g.mesh);
          grenades.splice(i, 1);
        }
      }
      for (const tracer of tracers) {
        if (tracer.left > 0) {
          tracer.left -= dt;
          if (tracer.left <= 0) tracer.mesh.visible = false;
        }
      }
      for (const spark of sparks) {
        if (spark.left > 0) {
          spark.left -= dt;
          spark.velocity.y -= 9 * dt;
          spark.mesh.position.addScaledVector(spark.velocity, dt);
          if (spark.left <= 0) spark.mesh.visible = false;
        }
      }
      if (blastLeft > 0) {
        blastLeft -= dt;
        const scale = 1 + (0.35 - blastLeft) * 22;
        blast.scale.setScalar(scale);
        blast.material.opacity = Math.max(0, blastLeft / 0.35) * 0.7;
        if (blastLeft <= 0) blast.visible = false;
      }
      return explosions;
    },
    // Grenade damage at a body: full at the centre, fading to a flat 15 at the
    // edge of the blast radius, nothing beyond it.
    grenadeDamage(position, body) {
      const dx = body.position.x - position.x;
      const dy = (body.position.y + 1.0) - position.y;
      const dz = body.position.z - position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > GRENADE.radius) return 0;
      return Math.round(GRENADE.maxDamage * (1 - dist / GRENADE.radius) + 15);
    },
    reset() {
      for (const g of grenades) scene.remove(g.mesh);
      grenades.length = 0;
      for (const tracer of tracers) { tracer.mesh.visible = false; tracer.left = 0; }
      for (const spark of sparks) { spark.mesh.visible = false; spark.left = 0; }
      blast.visible = false;
      blastLeft = 0;
    },
  };
}
