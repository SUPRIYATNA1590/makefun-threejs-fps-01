// Kestrel Relay's balance sheet. One module holds every number the game runs
// on, so the shop, the HUD and the simulation can never disagree about a price,
// a timer or a damage value. Tune the game by editing the numbers below; the
// systems that read them need no other change.
//
// Match shape: 100-second rounds, an 8-second freeze to buy in, first team to
// 5 round wins, never more than 9 rounds in a match.
export const CONFIG = {
  roundSeconds: 100,
  freezeSeconds: 8,
  roundsToWin: 5,
  maxRounds: 9,
  // The spike: 3.5 s held to plant it, 5 s held to defuse it, 35 s from the
  // plant to the blast.
  plantSeconds: 3.5,
  defuseSeconds: 5,
  spikeSeconds: 35,
  // Money: $800 at the start, $300 for a kill, $300 for a plant, $3,250 for
  // a round won and $1,900 for a round lost.
  startMoney: 800,
  killReward: 300,
  plantReward: 300,
  winReward: 3250,
  lossReward: 1900,
  // Bodies: 100 health each, and kevlar absorbs half of every hit.
  health: 100,
  armorReduction: 0.5,
};

// The four guns. `auto` means hold-to-fire, `headMult` multiplies headshot
// damage, `spreadStill` and `spreadMove` are the firing cone standing still
// and on the move, `kick` is the recoil per shot, `range` the distance past
// which damage starts to fall off.
export const WEAPONS = {
  pistol: {
    name: "P9 Sidearm",
    price: 0,
    auto: false,
    damage: 26,
    headMult: 4,
    mag: 12,
    reserve: 36,
    fireGap: 0.16,
    reload: 1.4,
    spreadStill: 0.004,
    spreadMove: 0.03,
    kick: 0.006,
    range: 55,
    tracer: 0xe8c25a,
  },
  smg: {
    name: "VK-9 Ripper",
    price: 1500,
    auto: true,
    damage: 22,
    headMult: 4,
    mag: 28,
    reserve: 84,
    fireGap: 0.075,
    reload: 1.9,
    spreadStill: 0.006,
    spreadMove: 0.034,
    kick: 0.007,
    range: 48,
    tracer: 0xe8c25a,
  },
  rifle: {
    name: "AR-77 Longshot",
    price: 2700,
    auto: true,
    damage: 33,
    headMult: 4,
    mag: 30,
    reserve: 90,
    fireGap: 0.096,
    reload: 1.9,
    spreadStill: 0.0022,
    spreadMove: 0.028,
    kick: 0.009,
    range: 80,
    tracer: 0xf0a830,
  },
  sniper: {
    name: "LRS-50 Warden",
    price: 4750,
    auto: false,
    damage: 110,
    headMult: 4,
    mag: 5,
    reserve: 15,
    fireGap: 1.1,
    reload: 2.8,
    spreadStill: 0.0004,
    spreadMove: 0.06,
    kick: 0.03,
    range: 120,
    tracer: 0x9fd8ff,
  },
};

// The two consumables: a frag grenade and a kevlar vest.
export const GRENADE = {
  name: "Frag grenade",
  price: 300,
  radius: 6.5,
  maxDamage: 95,
  fuse: 1.6,
};

export const ARMOR = {
  name: "Kevlar vest",
  price: 650,
};

// The teams: amber Vipers attack from the south, teal Sentinels defend the north.
export const TEAMS = {
  vipers: {
    name: "Vipers",
    color: 0xf0a830,
    spawn: { x: 0, z: 20 },
  },
  sentinels: {
    name: "Sentinels",
    color: 0x7fb4c7,
    spawn: { x: 0, z: -20 },
  },
};
