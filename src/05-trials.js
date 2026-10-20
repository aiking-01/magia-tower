// src/05-trials.js — part of game.js (苦難, panel chains and layout). Edit here, then run: node tools/build.js
  // ---------------- 苦難 (trials) ----------------
  // after a reincarnation the player may pick one unlocked 苦難 for the coming loop. Every 苦難 seals the
  // whole reincarnation panel (bonuses, specials, remnants, card shop, 拡張強化) on top of its own rules,
  // so even the easiest one turns "fresh start -> final boss" back into a real climb. Killing the 100F
  // boss while it's active grants its permanent reward (once per 苦難). Rewards are never sealed.
  // 8 directions of restriction, each with 3 levels (★ → ★★★). Level k of every direction opens with
  // tier k of 苦難の門, and also needs level k-1 of that same direction beaten first.
  // Tuned by measurement (tools/sim/trial-effort.js + sweep.js, AUTO with 自動購入, 3–6 seeds each): the cards it
  // takes to beat 100F from the state 苦難 open up in, against B = the same climb with no 苦難 (≈1,000 cards).
  // Targets ★ ≈ B×2–3, ★★ ≈ B×4–6, ★★★ ≈ B×8–12. Measured, most themed rules barely bite in the current game (a
  // fight is decided by the level multiplier and the other multipliers: 手数 −2, no crit or no card ranks each cost
  // ≈ ×1.0–1.3), so each 苦難 keeps its own restriction and adds an enemy-HP multiplier (grown in with the floor,
  // see trialHpMultForFloor) sized so the whole lands on its target. 飢餓 stays souls only: "the merchant sells
  // nothing" made 91–99F a wall nobody passed (×34+ and not cleared), so it is gone. Rewards are unchanged.
  const TRIAL_CATEGORIES = [
    { id: "hp", name: "堅牢", theme: "敵が硬くなる", levels: [
      { rules: { hpMult: 1e4 }, reward: { dmgMult: 2 }, rewardText: "全ダメージ ×2" }, // ×2.4
      { rules: { hpMult: 3e6 }, reward: { dmgMult: 5 }, rewardText: "全ダメージ ×5" }, // ×4.3
      { rules: { hpMult: 3e9 }, reward: { dmgMult: 20 }, rewardText: "全ダメージ ×20" }, // ×11
    ] },
    { id: "atk", name: "鈍刃", theme: "攻撃力が下がる", levels: [
      { rules: { atkMult: 0.1, hpMult: 10 }, reward: { exponent: 0.05 }, rewardText: "累乗 +0.05" }, // ×2.2
      { rules: { atkMult: 0.01, hpMult: 1e3 }, reward: { exponent: 0.1 }, rewardText: "累乗 +0.1" }, // ×4.5
      { rules: { atkMult: 0.001, hpMult: 1e5 }, reward: { exponent: 0.2 }, rewardText: "累乗 +0.2" }, // ×8.2
    ] },
    { id: "moves", name: "刹那", theme: "手数・手札が減る", levels: [
      { rules: { nDelta: -1, hpMult: 3e3 }, reward: { handDelta: 1 }, rewardText: "初期手札 +1" }, // ×2.5
      { rules: { nDelta: -2, hpMult: 1e6 }, reward: { n: 1 }, rewardText: "手数 +1" }, // ×5.1
      { rules: { nDelta: -2, handDelta: -2, hpMult: 1e9 }, reward: { n: 1, handDelta: 1 }, rewardText: "手数 +1・初期手札 +1" }, // ×10.7
    ] },
    { id: "crit", name: "無明", theme: "会心が封じられる", levels: [
      { rules: { critRateMult: 0.5, hpMult: 3e3 }, reward: { critMult: 1.5 }, rewardText: "会心倍率 ×1.5" }, // ×2.9
      { rules: { noCrit: true, hpMult: 3e4 }, reward: { critMult: 2 }, rewardText: "会心倍率 ×2" }, // ×5.7
      { rules: { noCrit: true, hpMult: 3e7 }, reward: { critMult: 3 }, rewardText: "会心倍率 ×3" }, // ×10.7
    ] },
    { id: "econ", name: "飢餓", theme: "お金とソウルが減る", levels: [
      { rules: { goldMult: 0.5, soulMult: 0.6 }, reward: { soulMult: 1.5 }, rewardText: "ソウル獲得 ×1.5" }, // ×2.4
      { rules: { goldMult: 0.25, soulMult: 0.25 }, reward: { soulMult: 2 }, rewardText: "ソウル獲得 ×2" }, // ×5.1
      { rules: { goldMult: 0.1, soulMult: 0.2 }, reward: { soulMult: 3, transcendMult: 2 }, rewardText: "ソウル獲得 ×3・転生ポイント獲得 ×2" }, // ×11.5
    ] },
    { id: "exp", name: "忘却", theme: "成長が鈍る", levels: [
      // ×2 / ×5 exp were only +4 / +9 levels: worthless. The ★★ one now grows with the level itself
      { rules: { expMult: 0.1, hpMult: 1e3 }, reward: { expMult: 100 }, rewardText: "経験値 ×100" }, // ×2.6
      { rules: { expMult: 0.01, hpMult: 2e5 }, reward: { levelMultAdd: 0.002 }, rewardText: "レベル倍率 ×1.025 → ×1.027（1レベルごと）" }, // ×3.9 at 1e5, ×6.2 at 3e5
      { rules: { noLevel: true, hpMult: 1e7 }, reward: { atkPct: 300 }, rewardText: "攻撃力 +300%" }, // ×8.7
    ] },
    { id: "deck", name: "枯渇", theme: "カードが弱る", levels: [
      { rules: { buffScale: 0.5, hpMult: 3e3 }, reward: { buffAdd: 2 }, rewardText: "バフカードの倍率 +2" }, // ×2.1
      { rules: { noRank: true, hpMult: 1e6 }, reward: { rankMult: 1.5 }, rewardText: "カード強化（ランク）の効果 ×1.5" }, // ×5.5
      { rules: { noRank: true, buffScale: 0.5, handDelta: -1, hpMult: 3e8 }, reward: { buffBoost: 1.5 }, rewardText: "バフの上乗せ ×1.5" }, // ×10.4
    ] },
    { id: "tree", name: "束縛", theme: "基本強化が封じられる", levels: [
      { rules: { noFinalMult: true, hpMult: 100 }, reward: { dmgMult: 1.5 }, rewardText: "全ダメージ ×1.5" }, // ×3.1
      // was 基本強化の攻撃力 ×3: the tree's ~1,000 atk is nothing next to the panel's late on; its 累乗 is not
      { rules: { treeAtkMult: 0.25, hpMult: 3e4 }, reward: { treeBoost: 1.5 }, rewardText: "基本強化の攻撃力・累乗 ×1.5" }, // ×4.9
      { rules: { treeMult: 0.5, noFinalMult: true, hpMult: 3e6 }, reward: { exponent: 0.25 }, rewardText: "累乗 +0.25" }, // ×8.8
    ] },
  ];
  const TRIAL_LEVEL_NAMES = ["壱", "弐", "参"];
  const TRIALS = [];
  TRIAL_CATEGORIES.forEach((cat) => cat.levels.forEach((lv, i) => {
    TRIALS.push(Object.assign({ id: cat.id + (i + 1), cat, level: i + 1, stars: i + 1, name: `${cat.name}の試練・${TRIAL_LEVEL_NAMES[i]}` }, lv));
  }));
  function trialRuleTexts(t) {
    const defs = Array.isArray(t) ? t : [t];
    const keys = [...new Set(defs.flatMap((d) => Object.keys(d.rules)))];
    const r = Object.fromEntries(keys.map((k) => [k, combineTrialRule(defs, k)]));
    const out = ["転生パネルの効果が封印される（残滓・カードショップ・拡張強化も使えない）"];
    if (r.hpMult) out.push(`敵のHP ×${jpUnitText(r.hpMult)}（100階で最大）`);
    if (r.atkMult) out.push(`攻撃力 ×${r.atkMult}`);
    if (r.nDelta) out.push(`手数 ${r.nDelta}`);
    if (r.handDelta) out.push(`初期手札 ${r.handDelta}`);
    if (r.critRateMult) out.push(`会心率 ×${r.critRateMult}`);
    if (r.noCrit) out.push("会心が出ない");
    if (r.goldMult) out.push(`獲得ゴールド ×${r.goldMult}`);
    if (r.soulMult) out.push(`獲得ソウル ×${r.soulMult}`);
    if (r.noShop) out.push("商人が何も売らない");
    if (r.expMult) out.push(`獲得経験値 ×${r.expMult}`);
    if (r.noLevel) out.push("レベルによるダメージ倍率・会心ダメージが無効");
    if (r.buffScale) out.push(`バフカードの上乗せ ×${r.buffScale}`);
    if (r.noRank) out.push("カード強化（ランク）が無効");
    if (r.noFinalMult) out.push("闘気の枝（最終倍率）が無効");
    if (r.treeAtkMult) out.push(`基本強化の攻撃力 ×${r.treeAtkMult}`);
    if (r.treeMult) out.push(`基本強化の攻撃力・会心率・会心ダメージ・獲得金額・累乗 ×${r.treeMult}`);
    return out;
  }
  function trialOpen(t) {
    if (t.level > trialsUnlockedCount()) return false;
    return t.level === 1 || !!save.trialsCleared[t.cat.id + (t.level - 1)];
  }
  function activeTrialDefs() { return save.activeTrials.map((id) => TRIALS.find((t) => t.id === id)).filter(Boolean); }
  function trialSealed() { return activeTrialDefs().length > 0; }
  // several 苦難 at once: multipliers multiply, ±counts add up, on/off restrictions apply if any has them
  const TRIAL_SUM_RULES = ["nDelta", "handDelta"];
  function combineTrialRule(defs, key, fallback) {
    const vals = defs.map((t) => t.rules[key]).filter((v) => v != null);
    if (!vals.length) return fallback;
    if (typeof vals[0] === "boolean") return vals.some(Boolean);
    if (TRIAL_SUM_RULES.includes(key)) return vals.reduce((a, b) => a + b, 0);
    return vals.reduce((a, b) => a * b, 1);
  }
  function trialRule(key, fallback) { return combineTrialRule(activeTrialDefs(), key, fallback); }
  // 同時挑戦ボーナス: each new record of 苦難 beaten at once (2…8) adds a permanent 全ダメージ ×1.5 (at most
  // ×17). It used to be ×k per record (×40,320 in all), which made every ★★★ a one-try job
  const TRIAL_COMBO_STEP = 1.5;
  function trialComboMult() { return Math.pow(TRIAL_COMBO_STEP, Math.max(0, (save.trialComboBest || 0) - 1)); }
  function trialRewardSum(key) {
    return TRIALS.reduce((sum, t) => sum + (save.trialsCleared[t.id] && t.reward[key] ? t.reward[key] : 0), 0);
  }
  function trialRewardProduct(key) {
    const m = TRIALS.reduce((acc, t) => acc * (save.trialsCleared[t.id] && t.reward[key] ? t.reward[key] : 1), 1);
    return key === "dmgMult" ? m * trialComboMult() : m;
  }
  function trialsClearedCount() { return TRIALS.filter((t) => save.trialsCleared[t.id]).length; }
  const PANEL_TRIAL_CHAIN = { id: "panelTrial", label: "苦難の門", baseCost: 5000, costMult: 20, maxLevel: TRIAL_LEVEL_NAMES.length, angle: panelSpokeAngle(9) };
  PANEL_TRIAL_CHAIN.nodeDesc = (tier) => `${"★".repeat(tier)}の苦難（${TRIAL_CATEGORIES.length}種）を解放`;
  function trialsUnlockedCount() { return panelLevel(PANEL_TRIAL_CHAIN); }
  // a 苦難's HP multiplier grows in with the floor (mult^(floor/100)), so it bites in full only at the 100F
  // boss. Applied in full from 1F, 堅牢★'s ×5 made 1F a pure luck wall for a fresh, sealed loop (0 souls,
  // empty tree) and ★★/★★★ could not be started at all.
  function trialHpMultForFloor(floor) {
    const mult = trialRule("hpMult", 1);
    return mult === 1 ? 1 : Math.pow(mult, Math.min(floor, FINAL_FLOOR) / FINAL_FLOOR);
  }
  function enemyHpForFloor(floor) {
    const mult = trialHpMultForFloor(floor) * (isGuardianFloor(floor) ? GUARDIAN_HP_MULT : 1);
    return mult === 1 ? computeFloorHp(floor) : computeFloorHp(floor).mul(mult).ceil();
  }

  // 輪廻の理: continues 継承の記憶's arm. Each tier raises the level exponent of the reincarnation payout
  // (10 × Lv^2 → Lv^3 with all 4), priced steeply so it's a mid/late goal: a cheap Lv^3 bought the whole panel
  // in two reincarnations once before (see TRANSCEND_POWER)
  const TRANSCEND_POWER_STEP = 0.25;
  const PANEL_TRANSCEND_POWER_CHAIN = { id: "panelTranscendPower", label: "輪廻の理", baseCost: 50000, costMult: 4, maxLevel: 4, angle: panelSpokeAngle(10) };
  PANEL_TRANSCEND_POWER_CHAIN.nodeDesc = (tier) => `転生ポイント = 10×Lv^${fmtMult(TRANSCEND_POWER + TRANSCEND_POWER_STEP * tier)}`;
  function transcendPower() { return TRANSCEND_POWER + (trialSealed() ? 0 : panelLevel(PANEL_TRANSCEND_POWER_CHAIN) * TRANSCEND_POWER_STEP); }

  // chains whose tiers unlock things (not numeric bonuses); rendered and bought the same way
  const PANEL_CHAINS = [PANEL_SHOP_CHAIN, PANEL_ITEM_CHAIN, PANEL_REMNANT_CHAIN, PANEL_TREE_EXT_CHAIN, PANEL_TRIAL_CHAIN, PANEL_TRANSCEND_POWER_CHAIN];

  // layout: each of the 12 branches owns a 30° slice of a magic circle and folds back and forth inside
  // it (a zigzag, row by row outward), instead of running out in a straight line. Rows are concentric:
  // row i sits at START + ROW×i, and holds as many nodes as fit across the slice at that radius, so the
  // long 20-step branches end ~1,300px out instead of ~3,400px. Odd rows run the other way, so each
  // step stays right next to the previous one and the connecting line reads as one folded path.
  const PANEL_CORE = { x: 0, y: 0 };
  const PANEL_POS = { core: PANEL_CORE };
  const PANEL_ROW_START = 270;
  const PANEL_ROW_STEP = 130;
  const PANEL_NODE_PITCH = 140; // min distance between neighbors along a row (a node is ~98×80px)
  const PANEL_SECTOR_DEG = 30;
  let panelRowCount = 0;
  function foldedArm(ids, centerDeg) {
    const sector = (PANEL_SECTOR_DEG * Math.PI) / 180;
    const center = (centerDeg * Math.PI) / 180;
    const pos = {};
    let row = 0;
    let placed = 0;
    while (placed < ids.length) {
      const r = PANEL_ROW_START + PANEL_ROW_STEP * row;
      const cap = Math.max(1, Math.floor((r * sector) / PANEL_NODE_PITCH));
      const count = Math.min(cap, ids.length - placed);
      for (let i = 0; i < count; i++) {
        const slot = row % 2 ? count - 1 - i : i;
        const theta = center + ((slot + 0.5) / count - 0.5) * sector * (count / cap);
        pos[ids[placed + i]] = { x: PANEL_CORE.x + r * Math.cos(theta), y: PANEL_CORE.y - r * Math.sin(theta) };
      }
      placed += count;
      row += 1;
    }
    panelRowCount = Math.max(panelRowCount, row);
    return pos;
  }
  const PANEL_CATEGORY_TRANSCEND = PANEL_CATEGORIES.find((c) => c.key === "transcendGainPct");
  PANEL_TRANSCEND_POWER_CHAIN.continues = PANEL_CATEGORY_TRANSCEND;
  PANEL_CATEGORIES.concat(PANEL_CHAINS).forEach((chain) => {
    chain.nodeIds = [];
    for (let i = 1; i <= chain.maxLevel; i++) chain.nodeIds.push(chain.id + "_" + i);
  });
  // a chain that `continues` another branch is folded into the same arm, right after that branch's last step
  PANEL_CATEGORIES.concat(PANEL_CHAINS).forEach((chain) => {
    if (chain.continues) return;
    const ids = PANEL_CHAINS.filter((c) => c.continues === chain).reduce((all, c) => all.concat(c.nodeIds), chain.nodeIds.slice());
    Object.assign(PANEL_POS, foldedArm(ids, chain.angle));
  });
  function panelChainLineStart(chain, i) {
    if (i > 0) return PANEL_POS[chain.nodeIds[i - 1]];
    return chain.continues ? PANEL_POS[chain.continues.nodeIds[chain.continues.nodeIds.length - 1]] : PANEL_POS.core;
  }
  // 超越の刻印: one node after the specials that can be bought again and again -- the transcend-point sink that never
  // runs dry. Each level ×1.5 all damage for ×2.5 the price, so damage grows only as cost^0.44: a multiplier
  // never changes the slope against enemy HP (unlike 累乗), so it can't run away. Not part of the magic circle's
  // progress or of 一括購入 (so it never eats the points meant for the rest). Sealed during a 苦難 like the panel.
  const PANEL_MARK = { id: "panelMark", label: "超越の刻印", baseCost: 1e7, costMult: 2.5, step: 1.5, maxLevel: 800 };
  function markLevelRaw() { return save.panelLevels[PANEL_MARK.id] || 0; }
  function markLevel() { return trialSealed() ? 0 : markLevelRaw(); }
  function markCost() { return Math.ceil(PANEL_MARK.baseCost * Math.pow(PANEL_MARK.costMult, markLevelRaw())); }
  function markState() {
    if (!PANEL_SPECIALS.every(panelSpecialOwned)) return "locked";
    if (markLevelRaw() >= PANEL_MARK.maxLevel) return "unlocked";
    return save.transcendPoints >= markCost() ? "available" : "unaffordable";
  }
  Object.assign(PANEL_POS, foldedArm(PANEL_SPECIALS.map((sp) => sp.id).concat([PANEL_MARK.id]), panelSpokeAngle(7)));

  const PANEL_EDGE_PAD = 90;
  const { width: PANEL_CANVAS_WIDTH, height: PANEL_CANVAS_HEIGHT } =
    fitCanvasToPositions(PANEL_POS, PANEL_EDGE_PAD, PANEL_POS.core, PANEL_ROW_START + PANEL_ROW_STEP * (panelRowCount - 1) + MAGIC_CIRCLE_REACH);

