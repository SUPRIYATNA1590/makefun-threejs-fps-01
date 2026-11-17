// The look of Kestrel Relay, in one table. A desert relay station at dusk:
// warm sand and rust below, a violet sky above, amber for the Vipers and teal
// for the Sentinels. Lighting does the rest, so no colour is invented anywhere
// else in the code. The same keys are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: "#2f2438",
  surface: "#3a2f26",
  hairline: "#5c4a38",
  ink: "#efe7d8",
  muted: "#9a8d7a",
  accent: "#f0a830",
  sentinel: "#7fb4c7",
  rust: "#8a4a2a",
  olive: "#6a6a4a",
};

// What each colour is for:
// canvas — the dusk sky, also the page behind the game
// surface — packed sand, concrete, the ground itself
// hairline — crates, barriers, low cover
// ink — sun-bleached walls, and the HUD text
// muted — shadows and distant metal
// accent — Viper amber: the spike, the shop, the tracers
// sentinel — Sentinel teal: enemy markers and site B
// rust — container rust and the antenna tower
// olive — sandbags and camo netting

// Look a colour up by name; world.js and weapons.js build materials from it.
export function shade(name) {
  return PALETTE[name];
}
