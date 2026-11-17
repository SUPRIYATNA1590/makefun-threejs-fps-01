// One body, one rule for everyone. A capsule approximated by a box, resolved
// against the world's colliders one axis at a time, so a wall never swallows a
// body whole. The player and every bot move through this same code, with the same
// acceleration, friction, gravity, crouch and jump; only the source of the wishes
// differs — keys for the player, the brain for a bot.
import * as THREE from 'three';

const RADIUS = 0.34;
export const STAND_HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createBody(colliders, x, z, yaw = 0) {
  const body = {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    yaw,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
  };
  // Reused scratch, so stepping a body never allocates.
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  // Does a body of `height`, standing at (xPos, yPos, zPos), touch any collider?
  // `lift` trims the box top and bottom, so standing on the floor is not read as
  // walking into a wall, and a low ceiling does not read as a floor.
  function overlaps(xPos, yPos, zPos, height, lift) {
    probe.min.set(xPos - RADIUS, yPos + lift, zPos - RADIUS);
    probe.max.set(xPos + RADIUS, yPos + height - lift, zPos + RADIUS);
    for (const collider of colliders) {
      if (probe.intersectsBox(collider)) return collider;
    }
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function step(dt, input) {
    // Crouching is a state change, not a wish: stand back up only when the full
    // standing height fits where the body stands.
    if (input.crouch && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!input.crouch && body.crouching
      && !overlaps(body.position.x, body.position.y, body.position.z, STAND_HEIGHT, 0.02)) {
      body.crouching = false;
      body.height = STAND_HEIGHT;
    }
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    // Wish direction, rotated by the yaw: forward is -Z in the body's own frame.
    wish.set(0, 0, 0);
    if (input.forward || input.strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      wish.set(-sin * input.forward + cos * input.strafe, 0, -cos * input.forward - sin * input.strafe).normalize();
    }

    const speed = body.crouching ? CROUCH_SPEED : WALK_SPEED;
    const accel = body.onGround ? GROUND_ACCEL : AIR_ACCEL;
    const blend = Math.min(1, accel * dt / speed);
    body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
    if (body.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }

    if (input.jump && body.onGround) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;

    // Move one axis at a time; a blocked axis stops dead instead of sliding
    // through the wall, and the other axis still moves.
    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(nextX, body.position.y, body.position.z, body.height, 0.04)) {
      body.position.x = nextX;
    } else {
      body.velocity.x = 0;
    }
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nextZ, body.height, 0.04)) {
      body.position.z = nextZ;
    } else {
      body.velocity.z = 0;
    }

    // Vertical: land on a collider's top when falling onto it, stop under its
    // bottom when jumping into it, and never fall through the floor at y = 0.
    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    body.velocity.y = Math.max(-30, body.velocity.y);
  }

  return {
    state: body,
    step,
    look,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
    eyePosition(out) {
      out.set(body.position.x, body.position.y + body.eye, body.position.z);
      return out;
    },
  };
}
