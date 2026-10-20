// src/09-remnants.js — part of game.js (remnants and idle income). Edit here, then run: node tools/build.js
  // ---------------- Remnants (summoned from the reincarnation panel; never reset) ----------------
  // after every player damage card each remnant follows up for a share of that hit, so they scale with
  // everything the player has (buffs, exponent, crit). The share comes from the remnant's card
  // (+50% of its base per rank), plus 残滓の力's flat points, times 残滓の猛威.
  const REMNANT_NAMES = ["第一の残滓", "第二の残滓", "第三の残滓", "第四の残滓", "第五の残滓", "第六の残滓"];
  const REMNANT_BASE_DECK = [
    { name: "残滓の爪", count: 2 },
    { name: "残滓の牙", count: 1 },
  ];
  // looked up by name (not stored in the save), so older saves' decks pick up these shares too
  const REMNANT_CARD_PCT = { 残滓の爪: 5, 残滓の牙: 12 };
  const REMNANT_RANK_BASE_COST = 30; // transcend points, doubles per rank of that card
  const REMNANT_HIT_MS = 60; // gap between consecutive remnant hits, so they read as a quick flurry
  // shared by every remnant, paid with transcend points; each branch is a straight chain
  // 30 steps per branch: each step is worth a bit more than the last (×valueGrowth) and costs ×1.5 more,
  // so the tree is a very long transcend-point sink that keeps making the remnants stronger. Ids stay
  // rtAtk1, rtAtk2, … so nodes bought under the old 4-5 step tree carry over.
  const REMNANT_TREE_STEPS = 30;
  const REMNANT_TREE_COST_GROWTH = 1.5;
  function remnantTreeSteps(firstValue, valueGrowth, firstCost) {
    const steps = [];
    for (let i = 0; i < REMNANT_TREE_STEPS; i++) {
      steps.push([Math.max(1, Math.round(firstValue * Math.pow(valueGrowth, i))), Math.ceil(firstCost * Math.pow(REMNANT_TREE_COST_GROWTH, i))]);
    }
    return steps;
  }
  const REMNANT_TREE_BRANCHES = [
    { id: "rtAtk", label: "残滓の力", key: "sharePts", unit: "追撃の比率 +{v}pt", steps: remnantTreeSteps(1, 1.15, 100) },
    { id: "rtDmg", label: "残滓の猛威", key: "dmgPct", unit: "残滓のダメージ +{v}%", steps: remnantTreeSteps(10, 1.15, 200) },
    { id: "rtCap", label: "残滓の刻", key: "idleCapHours", unit: "放置の上限 +{v}時間", steps: remnantTreeSteps(1, 1, 100) },
    { id: "rtRate", label: "残滓の恵み", key: "idleRatePct", unit: "放置収入 +{v}%", steps: remnantTreeSteps(20, 1, 150) },
  ];
  REMNANT_TREE_BRANCHES.forEach((b) => {
    b.nodes = b.steps.map(([value, cost], i) => ({ id: b.id + (i + 1), value, cost, desc: b.unit.replace("{v}", value), requires: i === 0 ? null : b.id + i }));
  });
  function remnantTreeBonus(key) {
    let total = 0;
    REMNANT_TREE_BRANCHES.forEach((b) => {
      if (b.key !== key) return;
      b.nodes.forEach((n) => { if (save.remnantTree[n.id]) total += n.value; });
    });
    return total;
  }
  function ensureRemnantDecks() {
    while (save.remnantDecks.length < remnantCount()) save.remnantDecks.push(cloneDeckDefs(REMNANT_BASE_DECK));
  }
  // % of the player's hit this card follows up with
  function remnantCardShare(def) {
    const base = REMNANT_CARD_PCT[def.name] || 5;
    return (base * (1 + (def.rank || 0) * 0.5) + remnantTreeBonus("sharePts")) * (1 + remnantTreeBonus("dmgPct") / 100);
  }
  function remnantRankCost(def) { return Math.ceil(REMNANT_RANK_BASE_COST * Math.pow(2, def.rank || 0)); }
  function remnantHitDamage(def, playerHit) {
    return roundDamage(new Decimal(playerHit).mul(remnantCardShare(def) / 100 * itemProduct("remnantMult")));
  }
  // per floor: each remnant cycles through its own shuffled deck, one card per follow-up
  function buildRemnantRuntime() {
    ensureRemnantDecks();
    return save.remnantDecks.slice(0, activeRemnantCount()).map((defs, i) => {
      const cards = [];
      defs.forEach((d) => { for (let k = 0; k < d.count; k++) cards.push(d); });
      for (let k = cards.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [cards[k], cards[j]] = [cards[j], cards[k]];
      }
      return { name: REMNANT_NAMES[i], cards, next: 0 };
    });
  }
  // every remnant follows up in turn after a player damage card (for a share of that card's hit); damage lands one hit at a time so
  // the HP bar drains like a flurry. Stops early if the enemy dies or the floor/run changes.
  async function runRemnantFollowUps(thisGame, playerHit) {
    for (const r of game.remnants) {
      await new Promise((res) => setTimeout(res, spd(REMNANT_HIT_MS)));
      if (game !== thisGame || game.gameOver || game.enemyHp.lte(0) || !r.cards.length) return;
      const def = r.cards[r.next % r.cards.length];
      r.next += 1;
      const dmg = applyTraitsToHit(remnantHitDamage(def, playerHit), false);
      hitEnemy(dmg, false);
      addLog(`${r.name}の${def.name}：${fmt(dmg)} ダメージ`, "remnant");
      floatDamage(dmg, false, true);
      updateEnemyHpDisplay();
    }
  }

  // ---------------- Idle income (remnants keep earning while the game is closed) ----------------
  const IDLE_BASE_CAP_HOURS = 2;
  const IDLE_EXP_PER_MIN = 0.02; // exp/min = HP of the best cleared floor × this × remnants
  const IDLE_SOULS_PER_MIN = 0.25; // souls/min = best cleared floor × this × remnants (0.5 made 86% of souls idle)
  const IDLE_TICK_MS = 60 * 1000;
  const CLOCK_ROLLBACK_TOLERANCE_MS = 60 * 1000;
  function idleCapMs() { return (IDLE_BASE_CAP_HOURS + remnantTreeBonus("idleCapHours")) * 3600 * 1000; }
  function idleRatePerMinute() {
    if (!activeRemnantCount() || !save.bestClearedFloor) return null;
    const mult = activeRemnantCount() * (1 + remnantTreeBonus("idleRatePct") / 100);
    return { exp: computeFloorHp(save.bestClearedFloor).mul(IDLE_EXP_PER_MIN * mult), souls: save.bestClearedFloor * IDLE_SOULS_PER_MIN * mult };
  }
  // moves lastSeen to now and, when `grant`, pays the time since the old lastSeen (capped). Only time
  // away (closed or hidden tab) is paid: while visible the minute tick just re-stamps lastSeen, since
  // paying there too ignored the cap and stacked on top of active play. A clock that went backwards
  // is recorded for the hidden achievement and earns nothing.
  function settleIdle(grant) {
    const now = Date.now();
    const last = save.lastSeen || now;
    save.lastSeen = now;
    const elapsed = now - last;
    if (elapsed < -CLOCK_ROLLBACK_TOLERANCE_MS) {
      bumpStat("clockRollback");
      checkAchievements();
      persistSave();
      return null;
    }
    const rate = idleRatePerMinute();
    if (!grant || !rate || elapsed <= 0) { persistSave(); return null; }
    const minutes = Math.min(elapsed, idleCapMs()) / 60000;
    maxStat("maxIdleMinutes", minutes);
    checkAchievements();
    const exp = rate.exp.mul(minutes);
    const levels = gainExp(exp);
    const souls = grantSouls(rate.souls * minutes);
    persistSave();
    return { minutes, exp, souls, levels };
  }

  function buildShuffledDeck() {
    const cards = [];
    game.deckDefs.forEach((def) => {
      for (let i = 0; i < def.count; i++) {
        cards.push({
          uid: cardUid++, type: def.type, name: def.name, value: def.value,
          calc: def.calc, tags: def.tags, targetTag: def.targetTag, rank: def.rank || 0,
          randomValues: def.randomValues, critRateBonus: def.critRateBonus, critDmgBonus: def.critDmgBonus,
        });
      }
    });
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }

  // rank raises a card's effective power without mutating its stored base value
  // a buff card's multiplier as actually applied: + 継承の闘気 and the 枯渇 reward, with 枯渇's
  // restriction scaling only the bonus part (so ×3 at ×0.5 becomes ×2, never below ×1)
  function buffApplied(cardMult) {
    const bonus = cardMult + panelBonus("buffAdd") + trialRewardSum("buffAdd") + itemSum("buffAdd") - 1;
    return 1 + bonus * trialRule("buffScale", 1) * trialRewardProduct("buffBoost") * (hasTrait("curse") ? 0.5 : 1);
  }
  function effectiveValue(card) {
    const rank = trialRule("noRank", false) ? 0 : (card.rank || 0) * trialRewardProduct("rankMult");
    // percent cards can't be ranked (a ranked 処刑の火 passed 100% and one-shot any floor); any rank an
    // older save already put on one is ignored for the same reason
    if (card.type === "attack") return card.value * (1 + rank * 0.5);
    if (card.type === "draw" || card.type === "buff") return card.value + rank;
    return card.value;
  }

  function drawOne() {
    if (game.deck.length === 0) return null;
    const card = game.deck.shift();
    game.hand.push(card);
    return card;
  }

  function startFloor(floor) {
    game.floor = floor;
    debugTopUp();
    game.traits = rollTraits(floor);
    game.phantomUsed = false;
    game.enemyHpMax = enemyHpForFloor(floor);
    if (game.traits.includes("frenzy")) game.enemyHpMax = game.enemyHpMax.mul(2);
    game.enemyHp = game.enemyHpMax;
    game.n = currentStartN();
    game.floorStartN = game.n;
    game.buffBonus = 0;
    game.enemyPoisoned = false; // a fresh enemy each floor, never carries poison over
    game.critStreak = 0;
    game.percentUsed = false; // 割合カード（処刑の火）は1階につき1回まで
    game.firstHitDone = false; // 先駆けの角笛 boosts the floor's first attack/special card
    game.gameOver = false;
    game.deck = buildShuffledDeck();
    game.remnants = buildRemnantRuntime();
    game.followUpBusy = false;
    game.inputReadyAt = performance.now() + spd(INPUT_GUARD_MS);
    el.enemyVisual.classList.remove("defeated", "hit");
    game.hand = [];
    for (let i = 0; i < currentStartHand(); i++) drawOne();
    if (DEBUG_MODE) {
      game.hand.unshift({ uid: cardUid++, type: "percent", name: "【DEBUG】即死", value: 1, rank: 0 });
      game.hand.unshift({ uid: cardUid++, type: "attack", name: "【DEBUG】確定会心", value: 20, rank: 0, forceCrit: true });
    }

    el.log.innerHTML = "";
    addLog(`${floor}階 — ${enemyForFloor(floor).name}が立ちはだかる。`, "info");
    showScreen("battle");
    renderBattle();
  }

