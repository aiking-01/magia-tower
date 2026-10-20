// src/07-level.js — part of game.js (level and souls). Edit here, then run: node tools/build.js
  // ---------------- Level (kept across runs, reset by reincarnation) ----------------
  // exp from a kill = enemy max HP, and each level needs ×1.2 more -- enemy HP grows ×1.1 per floor,
  // so a player gains roughly one level per two floors of new ground. All numbers are first-pass.
  const LEVEL_EXP_BASE = 50;
  const LEVEL_EXP_GROWTH = 1.2;
  const EXP_PER_ENEMY_HP = 1;
  // ×1.025 damage per level above 1, multiplied (not added: +3%/level left a Lv300 player at only ×10) and
  // raised to 累乗 together with the buff part (see damageMultiplier). Lv100 ≈ ×12, Lv300 ≈ ×1,600 at 累乗 1
  const LEVEL_DMG_MULT = 1.025;
  const LEVEL_CRIT_DMG = 1; // +1% crit damage per level above 1, outside the tree's cap
  // transcend points for reincarnating = BASE × level^POWER. Was BASE × 1.1^(level−1): Lv185 paid 9.4億,
  // 213× the whole panel, so two reincarnations bought everything. Lv94 pays about the same as before.
  const TRANSCEND_BASE = 10;
  const TRANSCEND_POWER = 2;
  function expToNext(level) { return Decimal.pow(LEVEL_EXP_GROWTH, level - 1).mul(LEVEL_EXP_BASE).ceil(); }
  function expRemainingText() { return fmt(Decimal.max(0, expToNext(save.level).sub(save.exp))); }
  function levelDamageMultPer() { return LEVEL_DMG_MULT + trialRewardSum("levelMultAdd"); }
  function levelDamageMult() { return trialRule("noLevel", false) ? new Decimal(1) : Decimal.pow(levelDamageMultPer(), save.level - 1); }
  function gainExp(amount) {
    const add = new Decimal(amount);
    if (!add.gt(0)) return 0;
    save.exp = save.exp.add(add.mul((1 + achievementBonus("expPct") / 100) * trialRule("expMult", 1) * trialRewardProduct("expMult") * itemProduct("expMult")));
    const startLevel = save.level;
    // a deep floor can be worth thousands of levels at once: buy them as one geometric series,
    // then let the exact loop settle whatever float slack is left
    const next = expToNext(save.level);
    const bulk = Decimal.affordGeometricSeries(save.exp, next, LEVEL_EXP_GROWTH, 0).toNumber() - 1;
    if (bulk > 0) {
      save.exp = save.exp.sub(Decimal.sumGeometricSeries(bulk, next, LEVEL_EXP_GROWTH, 0));
      save.level += bulk;
    }
    while (save.exp.gte(expToNext(save.level))) {
      save.exp = save.exp.sub(expToNext(save.level));
      save.level += 1;
    }
    if (save.exp.lt(0)) save.exp = new Decimal(0);
    const gained = save.level - startLevel;
    if (gained) checkAchievements();
    return gained;
  }
  function transcendGainForLevel(level) {
    if (level <= 1) return 0;
    return Math.ceil(TRANSCEND_BASE * Math.pow(level, transcendPower()) * (1 + panelBonus("transcendGainPct") / 100) * trialRewardProduct("transcendMult") - 1e-9);
  }
  // soul income from any source goes through here so the achievement bonus applies everywhere
  function grantSouls(amount) {
    const gained = Math.floor(amount * (1 + (achievementBonus("soulPct") + treeExtBonus("soulPct")) / 100)
      * trialRule("soulMult", 1) * trialRewardProduct("soulMult") * itemProduct("soulMult"));
    save.points += gained;
    return gained;
  }

