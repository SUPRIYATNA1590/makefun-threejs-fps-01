// Rounds: the match itself. First team to 5 round wins takes it, at most 9
// rounds. A round is won by eliminating the other team, by the spike blowing up,
// or by the defenders defusing it; the clock alone hands the round to the
// defenders. Between rounds the buy menu sells guns, grenades and armour with the
// money kills and round wins earned. This module owns the timer, the score, the
// money and the spike; main.js owns the bodies, and the two talk through the
// events step() returns.
import { CONFIG, WEAPONS, GRENADE, ARMOR } from './config.js';

export function createRounds(world) {
  const state = {
    phase: 'menu',
    round: 0,
    score: { vipers: 0, sentinels: 0 },
    timer: 0,
    money: CONFIG.startMoney,
    buyOpen: false,
    spike: { status: 'none', carrier: null, x: 0, z: 0, site: null, progress: 0, explodeIn: 0 },
    targetSite: 'A',
    kills: 0,
    deaths: 0,
    banner: null,
    bannerAt: 0,
  };

  // A new round: the freeze starts, the buy menu opens, the spike goes to the
  // player, and the target site alternates A, B, A, B with the round number.
  function startRound() {
    state.round += 1;
    state.phase = 'freeze';
    state.timer = CONFIG.freezeSeconds;
    state.targetSite = state.round % 2 === 1 ? 'A' : 'B';
    state.spike = { status: 'carried', carrier: 'player', x: 0, z: 0, site: state.targetSite, progress: 0, explodeIn: 0 };
    state.buyOpen = true;
    return { type: 'roundStart', round: state.round, site: state.targetSite };
  }

  // Close a round: pay the winner, wait 5 seconds, and end the match when
  // somebody reached 5 wins or 9 rounds have been played.
  function endRound(winner, reason) {
    state.score[winner] += 1;
    state.money += winner === 'vipers' ? CONFIG.winReward : CONFIG.lossReward;
    state.phase = 'roundEnd';
    state.timer = 5;
    state.buyOpen = false;
    const events = [{ type: 'roundEnd', winner, reason, score: { ...state.score } }];
    if (state.score[winner] >= CONFIG.roundsToWin || state.round >= CONFIG.maxRounds) {
      state.phase = 'matchEnd';
      state.timer = 0;
      events.push({ type: 'matchEnd', winner, score: { ...state.score } });
    }
    return events;
  }

  return {
    state,
    startMatch() {
      state.round = 0;
      state.score = { vipers: 0, sentinels: 0 };
      state.money = CONFIG.startMoney;
      state.kills = 0;
      state.deaths = 0;
      return startRound();
    },
    nextRound() {
      return startRound();
    },
    // One step of the clock. `field` is what the round needs to know: who is
    // alive, where the player stands, whether the player holds the plant key.
    step(dt, field) {
      const events = [];
      if (state.phase === 'freeze') {
        state.timer -= dt;
        if (state.timer <= 0) {
          state.phase = 'live';
          state.timer = CONFIG.roundSeconds;
          state.buyOpen = false;
          events.push({ type: 'live' });
        }
        return events;
      }
      if (state.phase !== 'live') {
        if (state.phase === 'roundEnd') {
          state.timer -= dt;
          if (state.timer <= 0 && state.phase === 'roundEnd') {
            events.push(...(state.score.vipers >= CONFIG.roundsToWin || state.score.sentinels >= CONFIG.roundsToWin || state.round >= CONFIG.maxRounds ? [] : [startRound()]));
          }
        }
        return events;
      }
      // Live: the clock, the spike, and the win conditions.
      state.timer -= dt;
      const spike = state.spike;
      if (spike.status === 'planted') {
        spike.explodeIn -= dt;
        if (spike.explodeIn <= 0) {
          spike.status = 'none';
          events.push({ type: 'spikeExploded', site: spike.site });
          events.push(...endRound('vipers', 'spike'));
          return events;
        }
      } else if (spike.status === 'carried' && spike.carrier === 'player' && field.planting) {
        // The player plants by holding E inside a site ring.
        const site = world.sites[field.plantSite];
        if (site) {
          const dx = field.playerX - site.center.x;
          const dz = field.playerZ - site.center.z;
          if (dx * dx + dz * dz < site.radius * site.radius) {
            spike.progress += dt;
            if (spike.progress >= CONFIG.plantSeconds) {
              spike.status = 'planted';
              spike.site = field.plantSite;
              spike.explodeIn = CONFIG.spikeSeconds;
              spike.progress = 0;
              state.money += CONFIG.plantReward;
              events.push({ type: 'spikePlanted', site: spike.site });
            }
          } else spike.progress = 0;
        }
      } else {
        spike.progress = 0;
      }
      // Elimination wins only while the spike is not planted: after a plant the
      // round is decided by the explosion or the defuse.
      if (spike.status !== 'planted') {
        if (field.sentinelsAlive === 0) {
          events.push(...endRound('vipers', 'elimination'));
          return events;
        }
        if (field.vipersAlive === 0) {
          events.push(...endRound('sentinels', 'elimination'));
          return events;
        }
      } else if (field.vipersAlive === 0) {
        // Nobody left to defend the spike: the defuse is a formality, but the
        // round still ends by defuse, not by elimination.
        events.push({ type: 'spikeDefused', site: spike.site });
        spike.status = 'none';
        events.push(...endRound('sentinels', 'defuse'));
        return events;
      }
      if (state.timer <= 0 && spike.status !== 'planted') {
        events.push(...endRound('sentinels', 'time'));
        return events;
      }
      return events;
    },
    // The player was killed while carrying the spike: it drops where they fell.
    dropSpike(x, z) {
      if (state.spike.status === 'carried' && state.spike.carrier === 'player') {
        state.spike.status = 'dropped';
        state.spike.carrier = null;
        state.spike.x = x;
        state.spike.z = z;
        state.spike.progress = 0;
      }
    },
    pickupSpike(bot) {
      if (state.spike.status !== 'dropped') return;
      state.spike.status = 'carried';
      state.spike.carrier = bot;
    },
    carrierIs(bot) {
      return state.spike.status === 'carried' && state.spike.carrier === bot;
    },
    plantSpike(bot, site) {
      if (state.spike.status !== 'carried' || state.spike.carrier !== bot) return false;
      state.spike.status = 'planted';
      state.spike.site = site;
      state.spike.explodeIn = CONFIG.spikeSeconds;
      state.spike.progress = 0;
      return true;
    },
    defuseSpike() {
      if (state.spike.status !== 'planted') return false;
      state.spike.status = 'none';
      return true;
    },
    awardKill() {
      state.money += CONFIG.killReward;
      state.kills += 1;
    },
    // Buying is only open between rounds. Returns { ok, reason } so the HUD
    // can say why a purchase was refused.
    buy(item) {
      if (state.phase !== 'freeze' && state.phase !== 'roundEnd') return { ok: false, reason: 'The buy menu is only open between rounds.' };
      const price = item === 'grenade' ? GRENADE.price : item === 'armor' ? ARMOR.price : WEAPONS[item].price;
      if (state.money < price) return { ok: false, reason: 'Not enough money.' };
      state.money -= price;
      return { ok: true, item, price };
    },
  };
}
