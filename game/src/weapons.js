// The arsenal: four guns and a grenade, one box-built view model each. It owns
// the magazines, the reloads and the spread that punishes firing on the move;
// combat.js owns the ray and the damage. Switching guns is instant; a new round
// refills every magazine and reserve, so the buy menu sells guns, not bullets.
import * as THREE from 'three';
import { WEAPONS, GRENADE } from './config.js';
import { PALETTE } from './palette.js';

const ORDER = ['pistol', 'smg', 'rifle', 'sniper'];

// Receiver, barrel and stock lengths per gun, plus how far forward it sits.
const GUN_SIZES = {
  pistol: { receiver: [0.08, 0.09, 0.26], barrel: [0.04, 0.04, 0.16], stock: [0.06, 0.07, 0.1], z: -0.36 },
  smg: { receiver: [0.09, 0.1, 0.36], barrel: [0.04, 0.04, 0.3], stock: [0.07, 0.08, 0.18], z: -0.4 },
  rifle: { receiver: [0.09, 0.1, 0.42], barrel: [0.045, 0.045, 0.4], stock: [0.075, 0.08, 0.22], z: -0.42 },
  sniper: { receiver: [0.09, 0.11, 0.5], barrel: [0.04, 0.04, 0.62], stock: [0.08, 0.09, 0.26], z: -0.46 },
};

function buildGun(id, accent) {
  const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x111214), roughness: 0.6, metalness: 0.3 });
  const group = new THREE.Group();
  const s = GUN_SIZES[id];
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(...s.receiver), bodyMat);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(...s.barrel), gripMat);
  barrel.position.set(0, 0.025, -s.z - 0.1);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(...s.stock), gripMat);
  stock.position.set(0, -0.02, s.receiver[2] / 2 + 0.06);
  group.add(receiver, barrel, stock);
  if (id === 'sniper') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), darkMat);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.09, -0.05);
    group.add(scope);
  }
  if (id === 'smg' || id === 'rifle') {
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.08), darkMat);
    mag.position.set(0, -0.12, -0.05);
    group.add(mag);
  }
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.012, 0.1), new THREE.MeshBasicMaterial({ color: accent }));
  stripe.position.set(0, 0.055, 0.05);
  group.add(stripe);
  group.position.set(0.24, -0.2, s.z);
  return group;
}

export function createArsenal(camera) {
  const models = {};
  for (const id of ORDER) {
    const model = buildGun(id, WEAPONS[id].tracer);
    model.visible = false;
    camera.add(model);
    models[id] = model;
  }

  // The grenade the player holds while throwing: one dark sphere.
  const grenadeModel = new THREE.Group();
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 12, 10),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0x2c2f22), roughness: 0.6, metalness: 0.3 }),
  );
  grenadeModel.add(ball);
  grenadeModel.position.set(0.24, -0.2, -0.4);
  grenadeModel.visible = false;
  camera.add(grenadeModel);

  // Muzzle flash: a flat amber quad plus a point light, both lit for one frame.
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  // Only the guns the player owns: the pistol is always there, the rest come
  // from the buy menu.
  const owned = { pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve } };
  const state = { current: 'pistol', cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, grenades: 0, throwing: 0 };

  function currentDef() {
    return WEAPONS[state.current];
  }

  // Per-frame: cool the trigger down, fade the flash, settle the kick, animate
  // the reload dip, and finish a reload when its timer runs out.
  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.throwing = Math.max(0, state.throwing - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.current];
    if (model) {
      model.position.z = -0.42 + state.kick;
      model.rotation.x = state.kick * 2.2;
      if (state.reloadLeft > 0) model.rotation.x = -0.55 * Math.min(1, (currentDef().reload - state.reloadLeft) * 2);
    }
    grenadeModel.rotation.x = state.throwing > 0 ? -1.2 * (1 - state.throwing / 0.5) : 0;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      if (state.reloadLeft === 0) {
        const def = currentDef();
        const slot = owned[state.current];
        const take = Math.min(def.mag - slot.mag, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
  }

  return {
    state,
    owned,
    step,
    defs: WEAPONS,
    currentDef,
    currentName() {
      return currentDef().name;
    },
    // Where the barrel ends in world space. The tracer is drawn from here to
    // the hit, so a shot reads as coming out of the gun and not the camera.
    // localToWorld refreshes the camera matrix, so this is right even before
    // the first render.
    muzzlePosition(out) {
      return camera.localToWorld(out.set(0.24, -0.18, -0.95));
    },
    has(id) {
      return Boolean(owned[id]);
    },
    buy(id) {
      if (owned[id]) return false;
      owned[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      return true;
    },
    equip(id) {
      if (!owned[id] || state.current === id) return false;
      state.current = id;
      state.reloadLeft = 0;
      for (const key of ORDER) models[key].visible = key === id;
      grenadeModel.visible = false;
      return true;
    },
    equipGrenade() {
      if (state.grenades <= 0) return false;
      for (const key of ORDER) models[key].visible = false;
      grenadeModel.visible = true;
      return true;
    },
    unequipGrenade() {
      grenadeModel.visible = false;
      models[state.current].visible = true;
    },
    addGrenade() {
      state.grenades += 1;
    },
    ready() {
      return state.reloadLeft === 0 && state.cooldown === 0 && state.throwing === 0;
    },
    canFire() {
      return owned[state.current].mag > 0 && this.ready();
    },
    takeRound() {
      const slot = owned[state.current];
      if (slot.mag <= 0) return false;
      slot.mag -= 1;
      return true;
    },
    pullTrigger() {
      state.cooldown = currentDef().fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    reload() {
      const def = currentDef();
      const slot = owned[state.current];
      if (state.reloadLeft > 0 || slot.mag === def.mag || slot.reserve === 0) return;
      state.reloadLeft = def.reload;
    },
    // The firing cone: the still spread plus the moving spread, scaled by how
    // fast the body is travelling.
    spread(speed) {
      const def = currentDef();
      return def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove;
    },
    throwGrenade() {
      if (state.grenades <= 0) return false;
      state.grenades -= 1;
      state.throwing = 0.5;
      return true;
    },
    refill() {
      for (const id of Object.keys(owned)) {
        owned[id].mag = WEAPONS[id].mag;
        owned[id].reserve = WEAPONS[id].reserve;
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.throwing = 0;
      models.pistol.visible = state.current === 'pistol';
      models.smg.visible = state.current === 'smg';
      models.rifle.visible = state.current === 'rifle';
      models.sniper.visible = state.current === 'sniper';
      grenadeModel.visible = false;
    },
  };
}
