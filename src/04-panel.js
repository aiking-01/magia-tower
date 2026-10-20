// src/04-panel.js — part of game.js (reincarnation panel, card shop, 拡張強化 definitions). Edit here, then run: node tools/build.js
  // ---------------- Reincarnation panel (permanent, survives a reincarnation reset) ----------------
  // each category is its own long branch of many small, individually-purchased steps (same
  // spiral-chain idea as the basic tree) instead of one dial with a level counter, so there's
  // always visibly more to reach for.
  const PANEL_CATEGORIES = [
    // perLevelGrowth: each successive tier's own contribution doubles (tier1 +1, tier2 +2, tier3 +4, ...)
    // instead of every tier adding the same flat amount
    // 12 branches share the circle evenly (30 degrees apart): the 7 below, plus the shop, remnant,
    // 魂の拡張 and 苦難の門 chains and the specials chain defined further down
    // costMult 2.2 (not 1.4) because the effect doubles per tier: at 1.4 the whole chain was ~1万pt
    // for +105万 atk and was gone after one reincarnation; now its top tiers are the long-term sink
    { id: "panelAtk", label: "継承の力", desc: "基礎攻撃力", key: "atk", perLevel: 1, perLevelGrowth: 2, baseCost: 5, costMult: 2.2, maxLevel: 20, angle: panelSpokeAngle(0) },
    { id: "panelGold", label: "継承の福運", desc: "獲得金額 %", key: "goldPct", perLevel: 8, baseCost: 8, costMult: 1.4, maxLevel: 16, angle: panelSpokeAngle(2) },
    { id: "panelStartPoints", label: "継承の礎", desc: "転生後の開始pt", key: "startPoints", perLevel: 15, baseCost: 6, costMult: 1.4, maxLevel: 18, angle: panelSpokeAngle(4) },
    { id: "panelBuff", label: "継承の闘気", desc: "バフカードの倍率", key: "buffAdd", perLevel: 0.1, baseCost: 10, costMult: 1.4, maxLevel: 20, angle: panelSpokeAngle(6) },
    { id: "panelCritDmg", label: "継承の会心", desc: "クリティカルダメージ %", key: "critDmgAdd", perLevel: 5, baseCost: 10, costMult: 1.4, maxLevel: 20, angle: panelSpokeAngle(8) },
    // エンドレス到達階から得る転生ポイントそのものを増やす、周回を重ねるほど効いてくる複利的な枝
    { id: "panelTranscendGain", label: "継承の記憶", desc: "転生ポイント獲得 %", key: "transcendGainPct", perLevel: 8, baseCost: 10, costMult: 1.4, maxLevel: 16, angle: panelSpokeAngle(10) },
    // small steps on purpose: the exponent compounds on every hit, so even +0.02 is a real jump late on
    { id: "panelExponent", label: "継承の累乗", desc: "累乗", key: "exponent", perLevel: 0.02, baseCost: 20, costMult: 1.4, maxLevel: 20, angle: panelSpokeAngle(11) },
  ];
  // spoke i of 12, counter-clockwise from straight up. Long branches (the 7 継承) and short ones (shop,
  // remnants, 魂の拡張, specials, 苦難の門) alternate where they can, so the folded panel stays balanced
  function panelSpokeAngle(i) { return 90 + (360 / 12) * i; }
  function panelLevel(cat) { return save.panelLevels[cat.id] || 0; }
  // the amount a SPECIFIC tier (1-indexed) of a category contributes; flat (perLevel) unless the
  // category defines perLevelGrowth, in which case it doubles (or whatever the multiplier is) each tier
  function panelTierAmount(cat, tier) {
    if (cat.perLevelGrowth) return cat.perLevel * Math.pow(cat.perLevelGrowth, tier - 1);
    return cat.perLevel;
  }
  // while a 苦難 is active the whole panel is sealed (see trialSealed); panelBonusRaw ignores the seal
  function panelBonus(key) { return trialSealed() ? 0 : panelBonusRaw(key); }
  function panelSpecialOn(id) { return !trialSealed() && !!save.panelSpecials[id]; }
  function panelBonusRaw(key) {
    let total = 0;
    PANEL_CATEGORIES.forEach((cat) => {
      if (cat.key !== key) return;
      const level = panelLevel(cat);
      for (let tier = 1; tier <= level; tier++) total += panelTierAmount(cat, tier);
    });
    return total;
  }
  // cost of a specific tier (1-indexed) within a category's chain, independent of the category's
  // CURRENT level, so every step in the chain can show its own price when rendered
  function panelTierCost(cat, tier) { return Math.ceil(cat.baseCost * Math.pow(cat.costMult, tier - 1)); }

  // one-shot, extremely expensive purchases, chained in ascending order of power so they read as
  // a single unmistakable "endgame" branch; each requires the previous one already owned
  const PANEL_SPECIALS = [
    { id: "panelCritRateBurst", label: "会心の覚醒", desc: "クリティカル率 +40%", key: "critRateBurst", cost: 50000 },
    { id: "panelCritMultDouble", label: "会心の暴走", desc: "クリティカル倍率が×2に", key: "critMultDouble", cost: 250000, requires: "panelCritRateBurst" },
    // id/key kept from when this rewrote the formula to 威力×攻撃力 (always beaten by 攻撃力² cards),
    // so saves that own it simply get the new effect
    { id: "panelDmgFormula", label: "神威の書き換え", desc: "累乗 +0.2", key: "dmgFormula", cost: 1000000, requires: "panelCritMultDouble" },
  ];
  function panelSpecialOwned(special) { return !!save.panelSpecials[special.id]; }

  // card shop: title-screen-only, paid with level-up points; every item can be bought any number
  // of times, each purchase adding one more copy of that card to the permanent deck (same
  // mechanism as a skill-tree startCards node). Which items are for sale is gated by how far the
  // panel's 商人との契約 chain below has been bought, not by a single on/off unlock.
  const CARD_SHOP_POOL = [
    { id: "shopMeteor", name: "隕石落とし", cost: 500, desc: "強力な攻撃カード（威力80）を1枚デッキに追加", card: { type: "attack", name: "隕石落とし", value: 80 } },
    { id: "shopBerserk", name: "狂乱の咆哮", cost: 800, desc: "次の攻撃カードの倍率に+2するバフ（単体なら×3）を1枚デッキに追加", card: { type: "buff", name: "狂乱の咆哮", value: 3 } },
    { id: "shopExecute", name: "処刑の火", cost: 2000, desc: "敵の最大HPの30%を攻撃するカードを1枚デッキに追加", card: { type: "percent", name: "処刑の火", value: 0.3 } },
    { id: "shopEnd", name: "終焉の使者", cost: 6000, desc: "基礎攻撃力の2乗ぶんダメージを与えるカードを1枚デッキに追加", card: { type: "special", name: "終焉の使者", calc: "atk2" } },
  ];
  // a chain like the categories above, but each tier unlocks one more CARD_SHOP_POOL slot instead
  // of a numeric bonus — "ショップ開放をツリーにして購入できるカードを増やす" — priced far below
  // the specials above so the first tier (which unlocks the shop itself) is an easy early grab
  const PANEL_SHOP_CHAIN = { id: "panelShop", label: "商人との契約", baseCost: 300, costMult: 3, maxLevel: CARD_SHOP_POOL.length, angle: panelSpokeAngle(5) };
  function shopUnlockedCount() { return trialSealed() ? 0 : panelLevel(PANEL_SHOP_CHAIN); }
  function cardShopUnlocked() { return shopUnlockedCount() > 0; }
  PANEL_SHOP_CHAIN.nodeDesc = (tier) => (tier === 1 ? "カードショップを解放" : `「${CARD_SHOP_POOL[tier - 1].name}」販売開始`);

  // 秘宝の契約: continues the 商人との契約 arm outward (its first tier needs that chain finished) and
  // strengthens the 秘宝 the floor-clear merchant sometimes sells (see ITEM_DEFS)
  const ITEM_CHAIN_TIERS = [
    { rate: 50 }, { power: 25 }, { rate: 50 }, { limit: 1 }, { power: 25 }, { rate: 50 },
    { power: 50 }, { slots: 1 }, { rate: 100 }, { limit: 1 }, { power: 50 }, { power: 100 },
  ];
  const PANEL_ITEM_CHAIN = { id: "panelItem", label: "秘宝の契約", baseCost: 3000, costMult: 2.2, maxLevel: ITEM_CHAIN_TIERS.length, angle: panelSpokeAngle(5), continues: PANEL_SHOP_CHAIN };
  PANEL_ITEM_CHAIN.nodeDesc = (tier) => {
    const t = ITEM_CHAIN_TIERS[tier - 1];
    if (t.rate) return `秘宝の出現率 +${t.rate}%`;
    if (t.power) return `秘宝の効果 +${t.power}%`;
    if (t.limit) return `秘宝の所持上限 +${t.limit}`;
    return `商人に並ぶ秘宝 +${t.slots}`;
  };
  function itemChainBonus(key) {
    if (trialSealed()) return 0;
    return ITEM_CHAIN_TIERS.slice(0, panelLevel(PANEL_ITEM_CHAIN)).reduce((sum, t) => sum + (t[key] || 0), 0);
  }

  // each tier summons one more remnant (so its level IS the remnant count); steep ×5 price steps
  // since every remnant adds a full extra follow-up attack to every player attack
  const PANEL_REMNANT_CHAIN = { id: "panelRemnant", label: "残滓の召喚", baseCost: 500, costMult: 5, maxLevel: 6, angle: panelSpokeAngle(1) };
  PANEL_REMNANT_CHAIN.nodeDesc = (tier) => `${tier}体目の残滓を召喚`;
  function remnantCount() { return panelLevel(PANEL_REMNANT_CHAIN); }
  // remnants owned stay owned (and upgradable) during a 苦難, they just don't fight or earn
  function activeRemnantCount() { return trialSealed() ? 0 : remnantCount(); }

  // 拡張強化: each tier adds one more repeatable, soul-priced upgrade to a 拡張強化 tab next to the
  // basic tree -- a soul sink that never runs out. Levels are reset by reincarnation (it is part of
  // 基本強化); the tiers themselves are permanent. Each level costs ×growth more than the last.
  const TREE_EXT_DEFS = [
    // multiplicative: +10% added to the level/achievement percentages was worth almost nothing late on.
    // The id stays, so levels already bought simply get the new effect
    { id: "extAtk", label: "魂の鍛錬", unit: "攻撃力 ×{v}", key: "atkMult", perLevel: 1.05, baseCost: 3000, growth: 1.35, multiplicative: true },
    // multiplies the whole crit multiplier (a flat +5% crit damage was lost next to level/panel crit damage)
    { id: "extCrit", label: "魂の研磨", unit: "会心倍率 ×{v}", key: "critMult", perLevel: 1.05, baseCost: 5000, growth: 1.35, multiplicative: true },
    // souls instead of gold: gold is worthless late, souls buy everything on this very tab
    { id: "extSoul", label: "魂の吸収", unit: "ソウル獲得 +{v}%", key: "soulPct", perLevel: 10, baseCost: 8000, growth: 1.35 },
    { id: "extDmg", label: "魂の昇華", unit: "ダメージ ×{v}", key: "dmgMult", perLevel: 1.1, baseCost: 20000, growth: 1.6, multiplicative: true },
    { id: "extExp", label: "魂の極致", unit: "累乗 +{v}", key: "exponent", perLevel: 0.02, baseCost: 50000, growth: 2 },
  ];
  const PANEL_TREE_EXT_CHAIN = { id: "panelTreeExt", label: "魂の拡張", baseCost: 2000, costMult: 4, maxLevel: TREE_EXT_DEFS.length, angle: panelSpokeAngle(3) };
  PANEL_TREE_EXT_CHAIN.nodeDesc = (tier) => `拡張強化「${TREE_EXT_DEFS[tier - 1].label}」を追加`;
  function treeExtUnlocked() { return trialSealed() ? [] : TREE_EXT_DEFS.slice(0, panelLevel(PANEL_TREE_EXT_CHAIN)); }
  function treeExtLevel(def) { return save.treeExt[def.id] || 0; }
  function treeExtCost(def) { return Math.ceil(def.baseCost * Math.pow(def.growth, treeExtLevel(def))); }
  function treeExtBonus(key) {
    let total = 0;
    treeExtUnlocked().forEach((def) => { if (def.key === key && !def.multiplicative) total += def.perLevel * treeExtLevel(def); });
    return total;
  }
  function treeExtProduct(key) {
    let total = 1;
    treeExtUnlocked().forEach((def) => { if (def.key === key && def.multiplicative) total *= Math.pow(def.perLevel, treeExtLevel(def)); });
    return total;
  }
