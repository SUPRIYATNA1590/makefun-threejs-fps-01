// The game's look, in one table. Kestrel Relay is a desert relay station at dusk:
// warm sand and rust below, a violet sky above, amber for the Vipers and teal for
// the Sentinels. Lighting does the rest, so no colour is invented anywhere else in
// the code. The same keys are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#2f2438', // the dusk sky, also the page behind the game
  surface: '#3a2f26', // packed sand, concrete, the ground itself
  hairline: '#5c4a38', // crates, barriers, low cover
  ink: '#efe7d8', // sun-bleached walls, and the HUD text
  muted: '#9a8d7a', // shadows and distant metal
  accent: '#f0a830', // Viper amber: the spike, the shop, the tracers
  sentinel: '#7fb4c7', // Sentinel teal: enemy markers and site B
  rust: '#8a4a2a', // container rust and the antenna tower
  olive: '#6a6a4a', // sandbags and camo netting
};

// Look a colour up by name; world.js and weapons.js build their materials from it.
export function shade(name) {
  return PALETTE[name];
}
