// Keyboard, mouse and pointer lock, nothing else. The game asks the canvas for
// pointer lock and reads movementX/Y while it holds it, so the mouse becomes the
// look control. `state.keys` holds the keys currently down; `state.pressed` holds
// the ones tapped since the last frame, and main.js drains it once per frame, so a
// tap of B or G is never read twice and never missed.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  const state = {
    keys,
    pressed,
    locked: false,
    firing: false,
    lookX: 0,
    lookY: 0,
  };

  function onKey(event, down) {
    if (down) {
      if (!keys.has(event.code)) {
        pressed.add(event.code);
      }
      keys.add(event.code);
    } else {
      keys.delete(event.code);
    }
    if (event.code === "Space") {
      event.preventDefault();
    }
  }

  window.addEventListener("keydown", (event) => onKey(event, true));
  window.addEventListener("keyup", (event) => onKey(event, false));
  window.addEventListener("blur", () => {
    keys.clear();
    pressed.clear();
  });
  window.addEventListener("mousemove", (event) => {
    if (!state.locked) {
      return;
    }
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener("mousedown", (event) => {
    if (state.locked && event.button === 0) {
      state.firing = true;
    }
  });
  window.addEventListener("mouseup", (event) => {
    if (event.button === 0) {
      state.firing = false;
    }
  });
  document.addEventListener("pointerlockchange", () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    // The mouse movement since the last frame, then zero it out.
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    // The keys tapped since the last frame, then zero the set out.
    takePressed() {
      const out = [...pressed];
      pressed.clear();
      return out;
    },
  };
}
