// Kestrel Relay: a desert relay station at dusk, 64 x 48 m. Two spike sites sit
// north, near the defenders: site A in the container yard by the antenna tower,
// site B in the fuel depot. Three lanes join them to the attackers' south spawn:
// the west yard lane, the east depot lane, and the mid lane through the relay hall.
// Every box and cylinder below is a collider for bodies and a surface a bullet
// stops on; the waypoint graph at the top is how the bots walk the map. Plain
// geometry only — no models, no textures.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// The waypoint graph: id, x, z, then the ids it links to (both ways). Bots route
// over it with a breadth-first search, so a route never cuts a corner through a
// wall.
const WAYPOINTS = [
  ['attSpawn', 0, 21, ['attA', 'attB', 'attMid']],
  ['attA', -18, 16, ['attSpawn', 'aYard']],
  ['attB', 18, 16, ['attSpawn', 'bDepot']],
  ['attMid', 0, 13, ['attSpawn', 'midHall']],
  ['aYard', -24, 4, ['attA', 'aSite', 'aDoor']],
  ['aSite', -25, -15, ['aYard', 'connWest', 'defA']],
  ['aDoor', -14, -8, ['aYard', 'midHall']],
  ['bDepot', 24, 4, ['attB', 'bSite', 'bDoor']],
  ['bSite', 25, -15, ['bDepot', 'connEast', 'defB']],
  ['bDoor', 14, -8, ['bDepot', 'midHall']],
  ['midHall', 0, 0, ['attMid', 'midNorth', 'aDoor', 'bDoor']],
  ['midNorth', 0, -11, ['midHall', 'connMid', 'defSpawn']],
  ['connWest', -14, -14, ['aSite', 'connMid', 'defA']],
  ['connEast', 14, -14, ['bSite', 'connMid', 'defB']],
  ['connMid', 0, -14, ['connWest', 'connEast', 'midNorth']],
  ['defSpawn', 0, -20, ['midNorth', 'defA', 'defB']],
  ['defA', -12, -19, ['defSpawn', 'aSite', 'connWest']],
  ['defB', 12, -19, ['defSpawn', 'bSite', 'connEast']],
];

// Where a bot stops to watch a lane: the waypoint it stands on and the yaw it
// faces while it holds there.
export const HOLDS = {
  aEast: { at: 'aDoor', yaw: -Math.PI / 2 },
  aYard: { at: 'aYard', yaw: Math.PI },
  bEast: { at: 'bDoor', yaw: Math.PI / 2 },
  bDepot: { at: 'bDepot', yaw: Math.PI },
  mid: { at: 'midNorth', yaw: 0 },
  conn: { at: 'connMid', yaw: Math.PI },
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  // One standard material per palette colour: accent and ink a little glossier,
  // rust a little metallic, everything else almost matte.
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: name === 'rust' ? 0.25 : 0.03,
    });
  }

  const colliders = [];
  const shootables = [];
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff4444 }),
  );

  // A solid box: it casts and receives shadows, it blocks bodies, it stops
  // bullets, and its box is recorded as a collider.
  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Same, as a cylinder (tanks, pipes, the tower mast, the lamp poles).
  function cylinder(radius, height, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 18), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Visual only: ground paint, the sun, distant mesas. No collider, never a
  // bullet stop.
  function visual(mesh) {
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  // The ground and the four walls. The room is open to the dusk sky, so one low
  // sun reaches every corner.
  box(64.4, 0.4, 48.4, 0, -0.2, 0, 'surface');
  box(0.4, 4.6, 48.4, -32.2, 2.3, 0, 'surface');
  box(0.4, 4.6, 48.4, 32.2, 2.3, 0, 'surface');
  box(64.4, 4.6, 0.4, 0, 2.3, -24.2, 'surface');
  box(64.4, 4.6, 0.4, 0, 2.3, 24.2, 'surface');

  // Worn concrete aprons along the three lanes, painted flat on the sand.
  visual(new THREE.Mesh(new THREE.BoxGeometry(6, 0.04, 44), materials.hairline)).position.set(-20, 0.02, 0);
  visual(new THREE.Mesh(new THREE.BoxGeometry(6, 0.04, 44), materials.hairline)).position.set(20, 0.02, 0);
  visual(new THREE.Mesh(new THREE.BoxGeometry(8, 0.04, 44), materials.hairline)).position.set(0, 0.02, 0);

  // The relay hall, mid: side walls, north and south walls with a 2.4 m door
  // each, and a server block for cover in the middle.
  box(0.4, 3.4, 14, -7, 1.7, 0, 'ink');
  box(0.4, 3.4, 14, 7, 1.7, 0, 'ink');
  box(5.8, 3.4, 0.4, -4.1, 1.7, -7, 'ink');
  box(5.8, 3.4, 0.4, 4.1, 1.7, -7, 'ink');
  box(2.4, 1.0, 0.4, 0, 2.9, -7, 'ink');
  box(5.8, 3.4, 0.4, -4.1, 1.7, 7, 'ink');
  box(5.8, 3.4, 0.4, 4.1, 1.7, 7, 'ink');
  box(2.4, 1.0, 0.4, 0, 2.9, 7, 'ink');
  box(2.0, 2.2, 1.0, 0, 1.1, 0, 'hairline');
  box(1.2, 0.9, 0.8, -3.4, 0.45, 3.4, 'hairline');
  box(1.2, 0.9, 0.8, 3.4, 0.45, -3.4, 'hairline');

  // Site A, the container yard: rust containers, crates and sandbags, and a
  // raised pad under the antenna tower.
  box(8, 0.5, 8, -25, 0.25, -15, 'surface');
  box(6, 2.6, 2.4, -24, 1.3, 2, 'rust');
  box(6, 2.6, 2.4, -24, 3.9, 2, 'olive');
  box(2.4, 2.6, 6, -18, 1.3, 8, 'rust');
  box(6, 2.6, 2.4, -26, 1.3, -6, 'rust');
  box(2.4, 2.6, 2.4, -28, 1.3, -8, 'rust');
  box(1.2, 1.2, 1.2, -20, 0.6, -10, 'hairline');
  box(1.2, 1.2, 1.2, -20, 0.6, -8.8, 'hairline');
  box(1.2, 1.2, 1.2, -20, 1.8, -9.4, 'hairline');
  box(2.4, 1.1, 0.8, -14, 0.55, -12, 'olive');
  box(2.4, 1.1, 0.8, -16, 0.55, 12, 'olive');
  box(0.9, 1.6, 0.9, -10.4, 0.8, 8.4, 'hairline');
  box(0.9, 1.6, 0.9, -29.4, 0.8, 10.4, 'hairline');

  // The antenna tower over site A: two mast sections, two crossbars, and the
  // blinking beacon on top.
  cylinder(0.28, 9, -28.5, 4.5, -19.5, 'rust');
  cylinder(0.2, 5, -28.5, 11, -19.5, 'rust');
  box(2.2, 0.12, 0.12, -28.5, 8.5, -19.5, 'rust');
  box(1.6, 0.12, 0.12, -28.5, 11.5, -19.5, 'rust');
  beacon.position.set(-28.5, 13.7, -19.5);
  group.add(beacon);

  // Site B, the fuel depot: two tanks, a pipe along the east wall, crates and
  // sandbags.
  cylinder(2.0, 3.0, 26, 1.5, -4, 'rust');
  cylinder(2.0, 3.0, 20, 1.5, 6, 'rust');
  cylinder(0.3, 10, 30, 1.0, -10, 'hairline').rotation.x = Math.PI / 2;
  box(6, 2.6, 2.4, 26, 1.3, 10, 'rust');
  box(2.4, 2.6, 6, 16, 1.3, -2, 'rust');
  box(1.2, 1.2, 1.2, 20, 0.6, -10, 'hairline');
  box(1.2, 1.2, 1.2, 21.2, 0.6, -10, 'hairline');
  box(2.4, 1.1, 0.8, 14, 0.55, -12, 'olive');
  box(2.4, 1.1, 0.8, 16, 0.55, 12, 'olive');
  box(0.9, 1.6, 0.9, 10.4, 0.8, -8.4, 'hairline');

  // The north connector: low barrier walls that turn the straight walk between
  // the sites into corners worth holding.
  box(8, 2.2, 0.4, -10, 1.1, -14, 'hairline');
  box(8, 2.2, 0.4, 10, 1.1, -14, 'hairline');
  box(1.2, 1.1, 3.6, -7.4, 0.55, -18, 'hairline');
  box(1.2, 1.1, 3.6, 7.4, 0.55, -18, 'hairline');

  // Spawn cover: crates each team starts behind.
  box(2.4, 1.1, 1.2, -4, 0.55, 18, 'hairline');
  box(2.4, 1.1, 1.2, 4, 0.55, 18, 'hairline');
  box(2.4, 1.1, 1.2, -4, 0.55, -18, 'hairline');
  box(2.4, 1.1, 1.2, 4, 0.55, -18, 'hairline');

  // Floodlight poles at the four corners of the mid yard.
  for (const [x, z] of [[-11, 11], [11, 11], [-11, -11], [11, -11]]) {
    cylinder(0.09, 5.5, x, 2.75, z, 'hairline');
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0xffe2a0 }));
    lamp.position.set(x, 5.5, z);
    group.add(lamp);
  }

  // The dusk sky: a low sun disc in the west, mesas beyond the walls, and the
  // fog that swallows the far corners.
  const sun = new THREE.Mesh(new THREE.CircleGeometry(6, 24), new THREE.MeshBasicMaterial({ color: 0xffb347, fog: false }));
  sun.position.set(-70, 22, -30);
  sun.lookAt(0, 2, 0);
  group.add(sun);
  for (const [w, h, x, z] of [[40, 7, -20, -46], [30, 9, 30, -48], [36, 6, 55, -20], [30, 8, -58, 10]]) {
    const mesa = new THREE.Mesh(new THREE.BoxGeometry(w, h, 6), new THREE.MeshBasicMaterial({ color: 0x2a1d16, fog: false }));
    mesa.position.set(x, h / 2 - 0.5, z);
    group.add(mesa);
  }

  // Site rings, flat on the ground where the spike goes: amber for A, teal for
  // B. Site A sits on a raised pad (top at y 0.5), so its ring rides on the pad;
  // site B is at ground level, so its ring sits just above the sand.
  const siteRings = [
    { site: 'A', color: 0xf0a830, center: [-25, -15], height: 0.56 },
    { site: 'B', color: 0x7fb4c7, center: [25, -15], height: 0.06 },
  ];
  for (const entry of siteRings) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.0, 32),
      new THREE.MeshBasicMaterial({ color: entry.color, transparent: true, opacity: 0.65, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(entry.center[0], entry.height, entry.center[1]);
    group.add(ring);
  }

  // Light: a low warm sun from the west, a violet dusk fill from the east, and
  // the sky itself. The sun sits high enough that the west wall's shadow does
  // not swallow site A.
  const sky = new THREE.HemisphereLight(new THREE.Color(0x8a7bb8), new THREE.Color(PALETTE.surface), 1.05);
  scene.add(sky);
  const sunLight = new THREE.DirectionalLight(new THREE.Color(0xffb347), 2.4);
  sunLight.position.set(-30, 24, 10);
  sunLight.target.position.set(0, 0, 0);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -36;
  sunLight.shadow.camera.right = 36;
  sunLight.shadow.camera.top = 36;
  sunLight.shadow.camera.bottom = -36;
  sunLight.shadow.camera.far = 90;
  sunLight.shadow.bias = -0.0006;
  scene.add(sunLight, sunLight.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(0x7fb4c7), 0.5);
  fill.position.set(20, 12, -14);
  scene.add(fill);
  const yardLight = new THREE.PointLight(new THREE.Color(0xffe2a0), 24, 26);
  yardLight.position.set(0, 5.5, 0);
  scene.add(yardLight);

  const waypoints = new Map();
  for (const [id, x, z, links] of WAYPOINTS) waypoints.set(id, { id, x, z, links });

  return {
    colliders,
    shootables,
    group,
    waypoints,
    sites: {
      A: { center: { x: -25, z: -15 }, radius: 3.0 },
      B: { center: { x: 25, z: -15 }, radius: 3.0 },
    },
    spawns: {
      vipers: [[-4, 21], [-2, 22], [0, 21], [2, 22], [4, 21]],
      sentinels: [[-4, -21], [-2, -20], [0, -21], [2, -20], [4, -21]],
    },
    // Breadth-first route over the waypoint graph: a list of waypoint ids from
    // `from` to `to`, inclusive. Bots walk it one node at a time, so no route
    // cuts a wall.
    route(from, to) {
      if (from === to) return [to];
      const prev = new Map([[from, null]]);
      const queue = [from];
      while (queue.length) {
        const current = queue.shift();
        for (const next of waypoints.get(current).links) {
          if (prev.has(next)) continue;
          prev.set(next, current);
          if (next === to) {
            const path = [to];
            let node = current;
            while (node) { path.unshift(node); node = prev.get(node); }
            return path;
          }
          queue.push(next);
        }
      }
      return [from, to];
    },
    nearestWaypoint(x, z) {
      let best = null;
      let bestDist = Infinity;
      for (const point of waypoints.values()) {
        const dist = (point.x - x) ** 2 + (point.z - z) ** 2;
        if (dist < bestDist) { bestDist = dist; best = point.id; }
      }
      return best;
    },
    // Segment against every collider, slab method, no allocations: true when a
    // wall, a container or a tank stands between the two points. Bots see
    // through this test.
    segmentBlocked(ax, ay, az, bx, by, bz) {
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      for (const c of colliders) {
        let tmin = 0;
        let tmax = 1;
        let ok = true;
        for (const [origin, dir, lo, hi] of [[ax, dx, c.min.x, c.max.x], [ay, dy, c.min.y, c.max.y], [az, dz, c.min.z, c.max.z]]) {
          if (Math.abs(dir) < 1e-9) {
            if (origin < lo || origin > hi) { ok = false; break; }
          } else {
            let t1 = (lo - origin) / dir;
            let t2 = (hi - origin) / dir;
            if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
            if (t1 > tmin) tmin = t1;
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) { ok = false; break; }
          }
        }
        if (ok) return true;
      }
      return false;
    },
    step(time) {
      // The tower beacon blinks once a second.
      beacon.material.color.setHex(Math.floor(time * 2) % 2 === 0 ? 0xff4444 : 0x551111);
    },
  };
}
