// src/06-run.js — part of game.js (floor HP, deck, run state, damage formula, crit). Edit here, then run: node tools/build.js
  // HP, damage, multipliers and exp are break_infinity Decimals (window.Decimal, vendor/), so they go on
  // past 1.8e308 instead of overflowing to Infinity. Below this, plain doubles are exact enough that the
  // per-step ceil still matters; above it a ceil changes nothing a double could even represent.
  const EXACT_LIMIT = 1e15;
  const floorHpCache = new Map();
  function computeFloorHp(floor) {
    const cached = floorHpCache.get(floor);
    if (cached) return cached;
    let hp = BASE_ENEMY_HP;
    let f = 1;
    for (; f < floor && hp < EXACT_LIMIT; f++) {
      // this step builds floor f+1's HP from floor f's, so the ×1.4 belongs to the step INTO each
      // multiple of 10 (the mid-boss floors, as documented) -- testing on `f` put the spike on
      // 11, 21, …, i.e. the first floor after every checkpoint instead of on the bosses
      const mult = ((f + 1) % 10 === 0) ? 1.4 : 1.1;
      hp = Math.ceil(hp * mult - 1e-9); // guard against float error (e.g. 100*1.1 === 110.00000000000001)
    }
    let result = new Decimal(hp);
    if (f < floor) {
      // the remaining steps build floors f+1..floor in one go: ×1.4 into each multiple of 10, ×1.1 otherwise
      const steps = floor - f;
      const bossSteps = Math.floor(floor / 10) - Math.floor(f / 10);
      result = result.mul(Decimal.pow(1.1, steps - bossSteps)).mul(Decimal.pow(1.4, bossSteps)).ceil();
    }
    floorHpCache.set(floor, result);
    return result;
  }

  function cloneDeckDefs(defs) { return defs.map((d) => Object.assign({}, d)); }

  function addCardToDeckDefs(defs, cardDef) {
    const existing = defs.find((d) => d.name === cardDef.name && d.type === cardDef.type);
    if (existing) {
      existing.count += 1;
      // a newly gained copy joins the lineup; once -/+ has set an explicit `active`, raising only
      // `count` would silently leave the new copy on the bench
      if (existing.active != null) existing.active += 1;
    } else defs.push(Object.assign({}, cardDef, { count: 1 }));
  }

  const RANK_UP_BASE_COST = 15;
  const DELETE_BASE_COST = 20;
  const DAMAGE_CARD_TYPES = ["attack", "percent", "special"];

  // saves from when the minimum was 4: first re-bench owned copies, then top up with 斬撃
  function enforceMinDeck(defs) {
    const active = (d) => (d.active == null ? d.count : Math.max(0, Math.min(d.count, d.active)));
    let total = defs.reduce((sum, d) => sum + active(d), 0);
    for (const d of defs) {
      while (total < MIN_DECK_SIZE && active(d) < d.count) { d.active = active(d) + 1; total += 1; }
    }
    while (total < MIN_DECK_SIZE) { addCardToDeckDefs(defs, BASE_DECK_DEFS[0]); total += 1; }
  }

  // deck strengthening is a permanent, title-screen action paid with level-up points (not gold).
  // The escalating cost is tracked PER CARD (via that card's own rank / delete count), not as one
  // global counter, so spreading investment across many cards stays affordable; only repeatedly
  // maxing out a single card gets expensive.
  function rankUpCost(def) { return Math.ceil(RANK_UP_BASE_COST * Math.pow(upgradeCostMultiplier(), def.rank || 0)); }
  function deleteCost(def) { return Math.ceil(DELETE_BASE_COST * Math.pow(upgradeCostMultiplier(), def.deleteUses || 0)); }

  function canDeleteCard(def) {
    const totalCards = save.deckDefs.reduce((sum, d) => sum + d.count, 0);
    if (totalCards <= MIN_DECK_SIZE) return false;
    if (DAMAGE_CARD_TYPES.includes(def.type)) {
      const damageCards = save.deckDefs.filter((d) => DAMAGE_CARD_TYPES.includes(d.type)).reduce((sum, d) => sum + d.count, 0);
      if (damageCards <= 1) return false; // never delete the last way to deal damage
    }
    // when every owned copy is in the lineup, deleting one also removes it from the battle deck, so
    // the lineup needs the same floors canDecreaseActive() enforces -- otherwise deletes could leave
    // a lineup of 0 cards (hand and deck empty, no way out of the battle) or with nothing to deal damage
    if (activeCount(def) >= def.count) {
      if (totalActiveCards() <= MIN_DECK_SIZE) return false;
      if (DAMAGE_CARD_TYPES.includes(def.type) && totalActiveDamageCards() <= 1) return false;
    }
    return true;
  }

  // deck building: owning a card (save.deckDefs' count, via the skill tree / card shop / base
  // deck) is separate from actually bringing it into a run. `active` is how many of a card's
  // owned copies are currently included in the battle deck; unset (older saves, or a card that's
  // never been touched) means "all of them", matching the old behavior of always using everything owned.
  function activeCount(def) {
    const a = def.active == null ? def.count : def.active;
    return Math.max(0, Math.min(def.count, a));
  }
  function totalActiveCards() { return save.deckDefs.reduce((sum, d) => sum + activeCount(d), 0); }
  function totalActiveDamageCards() {
    return save.deckDefs.filter((d) => DAMAGE_CARD_TYPES.includes(d.type)).reduce((sum, d) => sum + activeCount(d), 0);
  }
  function canDecreaseActive(def) {
    if (activeCount(def) <= 0) return false;
    if (totalActiveCards() <= MIN_DECK_SIZE) return false; // the actual battle deck needs a floor too
    if (DAMAGE_CARD_TYPES.includes(def.type) && totalActiveDamageCards() <= 1) return false;
    return true;
  }
  function canIncreaseActive(def) { return activeCount(def) < def.count; }
  function adjustActive(def, delta) {
    if (delta < 0 && !canDecreaseActive(def)) return;
    if (delta > 0 && !canIncreaseActive(def)) return;
    def.active = Math.max(0, Math.min(def.count, activeCount(def) + delta));
    persistSave();
  }

  function rankUpDeckDef(def) {
    const cost = rankUpCost(def);
    if (save.points < cost) return;
    save.points -= cost;
    def.rank = (def.rank || 0) + 1;
    persistSave();
  }

  function deleteDeckDef(def) {
    if (!canDeleteCard(def)) return;
    const cost = deleteCost(def);
    if (save.points < cost) return;
    save.points -= cost;
    def.count -= 1;
    def.deleteUses = (def.deleteUses || 0) + 1;
    if (def.count <= 0) save.deckDefs = save.deckDefs.filter((d) => d !== def);
    persistSave();
  }

  const FLOOR_CHECKPOINTS = [1, 11, 21, 31, 41, 51, 61, 71, 81, 91, 100];

  function newRun(startFloorChoice) {
    const floor = startFloorChoice || 1;
    bumpStat("runs");
    game = {
      floor: 1,
      floorPointsSum: 0, // sum of floor numbers for every monster actually defeated this run
      startFloor: floor,
      endlessMode: floor > FINAL_FLOOR, // continued past the final boss (or started at an endless checkpoint)
      runCritStreak: 0, // like critStreak but not reset between floors; only feeds the crit achievements
      enemyHp: 0,
      enemyHpMax: 0,
      n: 0,
      buffBonus: 0, // Σ(each buff card's multiplier − 1) waiting for the next attack/special card
      gold: treeBonus("startGold"),
      runAtkBonus: 0,
      runAtkPctBonus: 0, // 闘志の秘薬
      runHandBonus: 0,
      runCritRateBonus: 0,
      runCritDamageBonus: 0,
      runGoldPctBonus: 0,
      runNBonus: 0,
      // cards granted by skill-tree nodes are baked into save.deckDefs permanently when the
      // node is purchased (see renderTree), so cloning save.deckDefs already includes them; the
      // count is then capped to however many of each the player has actually chosen to bring in
      // (see activeCount/デッキ強化), not just how many they own.
      deckDefs: cloneDeckDefs(save.deckDefs).map((d) => Object.assign(d, { count: activeCount(d) })).filter((d) => d.count > 0),
      deck: [],
      hand: [],
      gameOver: false,
      shopOffers: null,
      shopRerollsUsed: 0,
      shopBuyCounts: {}, // shop potion id -> times bought this run (price growth / per-run caps)
      runStartedAt: performance.now(), // these four feed the play data (run_end) and the 苦難 effort measurements
      cardsPlayed: 0,
      autoCardsPlayed: 0,
      floorsCleared: 0,
    };
    startFloor(floor);
  }

  function currentAtk() {
    const flat = BASE_ATK + treeBonus("atk") + panelBonus("atk") + game.runAtkBonus;
    return flat * (1 + (achievementBonus("atkPct") + trialRewardSum("atkPct") + (game.runAtkPctBonus || 0)) / 100) * treeExtProduct("atkMult") * trialRule("atkMult", 1);
  }
  // capped 2 below the deck: a hand that holds the whole deck gets every played card straight back
  // (the shop's 集中の秘薬 already stops there; 苦難 rewards and the tree used to push past it)
  function currentStartHand() {
    const want = BASE_HAND + treeBonus("hand") + panelBonus("hand") + game.runHandBonus + trialRule("handDelta", 0) + trialRewardSum("handDelta");
    return Math.max(1, Math.min(want, runDeckSize() - 2));
  }
  function currentStartN() {
    return Math.max(1, BASE_N + treeBonus("n") + panelBonus("n") + (game.runNBonus || 0) + trialRule("nDelta", 0) + trialRewardSum("n") + itemSum("n")
      - (hasTrait("miasma") ? 1 : 0));
  }
  function goldMultiplier() {
    return (1 + (treeBonus("goldPct") + panelBonus("goldPct") + achievementBonus("goldPct") + treeExtBonus("goldPct") + (game.runGoldPctBonus || 0)) / 100) * trialRule("goldMult", 1) * itemProduct("goldMult");
  }
  function freeRerollAllowance() { return treeBonus("freeReroll"); }
  function shopOfferCount() { return 2 + treeBonus("shopSlots"); }
  // was checking unlockedNodes.goldS1 ("取引の極意"/free reroll) by mistake; the node that
  // actually promises this ("経済の秘伝") carries kind: "cheapUpgrade", so look that up instead
  // of hardcoding an id that has nothing to do with upgrade costs.
  function upgradeCostMultiplier() {
    const node = NODES.find((n) => n.kind === "cheapUpgrade");
    return node && save.unlockedNodes[node.id] ? 1.5 : 2;
  }
  // damage = (card power + atk) × ((baseMult + Σ buff bonus) × level multiplier)^exponent × final × crit.
  // Buffs add inside the base (so stacking them in one turn grows linearly); the exponential,
  // incremental-style growth comes from the level multiplier (×LEVEL_DMG_MULT per level) raised to the
  // exponent, which only rises through progression (tree end nodes, the panel, 拡張強化, 苦難, 秘宝) --
  // so every late +累乗 multiplies the whole level curve, never from cards played within a turn.
  function currentBaseMult() { return 1 + treeBonus("baseMult"); }
  function currentExponent() {
    return 1 + treeBonus("exponent") + panelBonus("exponent") + treeExtBonus("exponent")
      + (panelSpecialOn("panelDmgFormula") ? 0.2 : 0) + trialRewardSum("exponent") + itemSum("exponent");
  }
  // applied outside the exponent: 闘気 nodes (×1.1…×1.3 each) and 魂の昇華
  function toukiMult() {
    let m = 1;
    NODES.forEach((node) => {
      if (save.unlockedNodes[node.id] && node.effect && node.effect.finalMult && !trialRule("noFinalMult", false)) m *= 1 + node.effect.finalMult;
    });
    return m;
  }
  function finalDamageMult() {
    return toukiMult() * treeExtProduct("dmgMult") * trialRewardProduct("dmgMult") * itemProduct("dmgMult") * Math.pow(PANEL_MARK.step, markLevel());
  }
  function damageMultiplier() {
    return levelDamageMult().mul(Math.max(MIN_BUFF_MULTIPLIER, currentBaseMult() + game.buffBonus)).pow(currentExponent()).mul(finalDamageMult());
  }
  // one rounding rule for both dealt damage and hand previews (they used ceil vs round and could
  // differ by 1); the -1e-9 keeps float noise like 55.00000000000001 from ceiling up to 56. Returns a Decimal.
  function roundDamage(x) {
    const d = new Decimal(x);
    if (d.lt(EXACT_LIMIT)) return new Decimal(Math.max(0, Math.ceil(d.toNumber() - 1e-9)));
    return d.ceil();
  }
  // the part of damageMultiplier() that applies with no buff stored -- used for hand previews, which
  // (as before) show a card's own damage without whatever buff happens to be pending
  function unbuffedDamageMultiplier() { return levelDamageMult().mul(currentBaseMult()).pow(currentExponent()).mul(finalDamageMult()); }

  const BASE_CRIT_MULT = 1.5;
  const TREE_CRIT_DAMAGE_CAP = 225; // the skill tree alone can never push critDamage past this
  // panel bonuses (継承の会心・会心の覚醒) are a permanent, post-transcend layer and are
  // deliberately NOT subject to the tree-only cap above
  function critRate() {
    return Math.min(100, (treeBonus("critRate") + game.runCritRateBonus + (panelSpecialOn("panelCritRateBurst") ? 40 : 0) + itemSum("critRate")) * trialRule("critRateMult", 1));
  }
  function critDamageBonus() {
    return Math.min(TREE_CRIT_DAMAGE_CAP, treeBonus("critDamage")) + game.runCritDamageBonus + panelBonus("critDmgAdd")
      + (trialRule("noLevel", false) ? 0 : (save.level - 1) * LEVEL_CRIT_DMG) + achievementBonus("critDmg") + treeExtBonus("critDmg");
  }
  // cardRateBonus/cardDmgBonus let an individual card (e.g. 会心撃/超会心撃) add to its own crit
  // roll and multiplier on top of the player's usual crit stats, without touching any other card
  function critMultiplier(cardDmgBonus) {
    const base = (BASE_CRIT_MULT + (critDamageBonus() + (cardDmgBonus || 0)) / 100) * treeExtProduct("critMult") * trialRewardProduct("critMult") * itemProduct("critMult");
    return panelSpecialOn("panelCritMultDouble") ? base * 2 : base;
  }
  function rollCrit(cardRateBonus) {
    if (trialRule("noCrit", false)) return false;
    return Math.random() * 100 < critRate() + (cardRateBonus || 0) * trialRule("critRateMult", 1);
  }

