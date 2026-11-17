// The DOM HUD: health, ammo, money, the round timer and score, the spike line,
// the killfeed, the round banner, the buy menu and the one overlay panel. It never
// touches the simulation; main.js pushes numbers in and reads the play callback out.
const COPY = {
  start: {
    title: "Kestrel Relay",
    copy: "A desert relay station at dusk. Five Vipers against five Sentinels, "
      + "first to five rounds. Plant the spike at site A or B — or wipe the "
      + "other team out.",
    action: "Click to play",
  },
  paused: {
    title: "Kestrel Relay",
    copy: "Paused. Click to resume.",
    action: "Click to resume",
  },
  dead: {
    title: "You are down",
    copy: "Spectating your team. The round goes on without you.",
    action: "Keep watching",
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $("overlay");
  const title = $("overlay-title");
  const copy = $("overlay-copy");
  const play = $("play");
  const health = $("health");
  const healthValue = $("health-value");
  const healthFill = $("health-fill");
  const armorLabel = $("armor-label");
  const ammo = $("ammo");
  const ammoMag = $("ammo-mag");
  const ammoReserve = $("ammo-reserve");
  const weaponName = $("weapon-name");
  const moneyEl = $("money");
  const timerEl = $("timer");
  const roundLabel = $("round-label");
  const scoreVipers = $("score-vipers");
  const scoreSentinels = $("score-sentinels");
  const spikeEl = $("spike");
  const killfeed = $("killfeed");
  const banner = $("banner");
  const bannerTitle = $("banner-title");
  const bannerSub = $("banner-sub");
  const hitmarker = $("hitmarker");
  const damageEl = $("damage");
  const buyEl = $("buy");
  const buyMoney = $("buy-money");
  const buyHint = $("buy-hint");
  // Timers and last-shown values: the HUD only touches the DOM when a value
  // actually changed, so a steady frame costs it nothing.
  let hitTimer = 0;
  let bannerTimer = 0;
  let lastHealth = -1;
  let lastMag = -1;
  let lastReserve = -1;
  let lastMoney = -1;
  let lastTimer = "";
  let lastSpike = null;

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  return {
    setHealth(hp, armor) {
      const value = Math.max(0, Math.ceil(hp));
      if (value === lastHealth) {
        return;
      }
      lastHealth = value;
      healthValue.textContent = String(value);
      healthFill.style.width = `${value}%`;
      health.classList.toggle("low", value <= 30);
      armorLabel.textContent = armor ? "KEVLAR" : "";
    },
    setAmmo(mag, reserve, name) {
      if (mag === lastMag && reserve === lastReserve) {
        return;
      }
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = ` / ${reserve}`;
      weaponName.textContent = name.toUpperCase();
      ammo.classList.toggle("empty", mag === 0);
    },
    setMoney(amount) {
      if (amount === lastMoney) {
        return;
      }
      lastMoney = amount;
      moneyEl.textContent = `$${amount.toLocaleString("en-US")}`;
      buyMoney.textContent = `$${amount.toLocaleString("en-US")}`;
    },
    setTimer(seconds) {
      const text = formatTime(seconds);
      if (text === lastTimer) {
        return;
      }
      lastTimer = text;
      timerEl.textContent = text;
      timerEl.classList.toggle("low", seconds <= 10 && seconds > 0);
    },
    setScore(vipers, sentinels, round) {
      scoreVipers.textContent = String(vipers);
      scoreSentinels.textContent = String(sentinels);
      roundLabel.textContent = `ROUND ${Math.max(1, round)}`;
    },
    setSpike(html, progress) {
      if (html === lastSpike) {
        return;
      }
      lastSpike = html;
      spikeEl.innerHTML = html;
    },
    // The plant progress bar lives inside the spike line; create it on demand.
    setPlantProgress(fraction) {
      let bar = spikeEl.querySelector("#plant-fill");
      if (!bar) {
        spikeEl.insertAdjacentHTML(
          "beforeend",
          '<div id="plant-bar"><div id="plant-fill"></div></div>',
        );
        bar = spikeEl.querySelector("#plant-fill");
      }
      bar.style.width = `${Math.round(fraction * 100)}%`;
    },
    killfeed(killer, killerTeam, victim, victimTeam, weapon, headshot) {
      const line = document.createElement("div");
      line.innerHTML = `<span class="${killerTeam}">${killer}</span> `
        + `${headshot ? "⌖" : "—"} ${weapon} `
        + `<span class="${victimTeam}">${victim}</span>`;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) {
        killfeed.lastChild.remove();
      }
      setTimeout(() => line.remove(), 5000);
    },
    banner(titleText, subText, holdMs = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.classList.add("show");
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(
        () => banner.classList.remove("show"),
        holdMs,
      );
    },
    hideBanner() {
      banner.classList.remove("show");
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add("on");
      hitmarker.style.transform = killed
        ? "translate(-50%, -50%) rotate(45deg) scale(1.25)"
        : "";
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove("on");
        hitmarker.style.transform = "";
      }, holdMs);
    },
    damageFlash() {
      damageEl.style.opacity = "1";
      setTimeout(() => {
        damageEl.style.opacity = "0";
      }, 140);
    },
    showBuy(owned) {
      buyEl.hidden = false;
      for (const row of buyEl.querySelectorAll("tr[data-item]")) {
        row.classList.toggle("owned", Boolean(owned[row.dataset.item]));
      }
    },
    hideBuy() {
      buyEl.hidden = true;
    },
    buyOpen() {
      return !buyEl.hidden;
    },
    setBuyHint(text) {
      buyHint.textContent = text;
    },
    showOverlay(mode, detail) {
      const text = COPY[mode];
      if (!text) {
        return;
      }
      title.textContent = text.title;
      copy.textContent = detail ?? text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    showMatchEnd(winner, score) {
      title.textContent = winner === "vipers"
        ? "Vipers take the match"
        : "Sentinels take the match";
      copy.textContent = `Final score: Vipers ${score.vipers} — `
        + `${score.sentinels} Sentinels. Play again to run it back.`;
      play.textContent = "Play again";
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener("click", handler);
    },
  };
}
