(function () {
  const STORAGE_KEY = "magiaTower.save.v2";
  const BASE_ENEMY_HP = 100;
  const BASE_ATK = 3;
  const BASE_N = 5;
  const BASE_HAND = 5;
  const FINAL_FLOOR = 100;
  // debug cards are off by default; open the file with ?debug=1 in the URL to enable them for testing
  const DEBUG_MODE = new URLSearchParams(location.search).get("debug") === "1";
  // the console cheats (window.mt, see the bottom of this file) are on wherever the game is being
  // worked on -- a local server or a file:// open -- and on a deployed build only with ?debug=1,
  // so a published page doesn't hand every player a points editor in one keystroke.
  const LOCAL_ORIGIN = ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname);
  const DEV_CONSOLE = DEBUG_MODE || LOCAL_ORIGIN;

  // enemy roster: floors cycle through 9 regular monsters, the 10th floor of every 10-floor
  // block is a mid-boss (the same art/name each time it comes around), and floor 100 exactly is
  // the one-time final boss reveal.
  // these 9 are pre-processed to a transparent background (flood-filled from the border, so the
  // dungeon backdrop below shows through) with the AI generator's watermark removed
  const ENEMY_ROSTER = [
    { name: "ゴブリン", art: "enemies/01-goblin.png" },
    { name: "ミミック", art: "enemies/02-mimic.png" },
    { name: "浮遊する眼魔", art: "enemies/03-eye.png" },
    { name: "スケルトン戦士", art: "enemies/04-skeleton.png" },
    { name: "キノコの妖精", art: "enemies/05-mushroom.png" },
    { name: "盗賊ネズミ", art: "enemies/06-rat.png" },
    { name: "腐食のコウモリ", art: "enemies/07-bat.png" },
    { name: "菌糸の蜘蛛", art: "enemies/08-spider.png" },
    { name: "亡霊茸", art: "enemies/09-mushroom-skeleton.png" },
  ];
  const MID_BOSS = { name: "死の賭博師", art: "enemies/10-midboss.png" };
  const FINAL_BOSS = { name: "塔の支配者（ラスボス）", art: "enemies/11-finalboss.png" };

  function enemyForFloor(floor) {
    if (floor === FINAL_FLOOR) return Object.assign({ isBoss: true, isMidBoss: false }, FINAL_BOSS);
    if (floor % 10 === 0) return Object.assign({ isBoss: true, isMidBoss: true }, MID_BOSS);
    return Object.assign({ isBoss: false, isMidBoss: false }, ENEMY_ROSTER[(floor - 1) % 10]);
  }
  const TAG_LABELS = { flame: "炎" };
  const TYPE_LABELS = { attack: "攻撃", draw: "ドロー", percent: "割合", special: "特殊", chain: "連鎖", buff: "バフ", poison: "毒" };

  const BASE_DECK_DEFS = [
    { type: "attack", name: "斬撃", value: 15, count: 5 },
    { type: "attack", name: "強撃", value: 20, count: 3 },
    { type: "attack", name: "会心撃", value: 18, count: 2, critRateBonus: 5, critDmgBonus: 20 },
    // draw cards are disabled for now (kept here, commented out, in case they come back later):
    // { type: "draw", name: "透視", value: 2, count: 3 },
  ];

  // ---------------- Level-up tree definition (branching, persistent) ----------------
  // buildChain: turns a flat list of {label,desc,cost,effect?,kind?,cards?} into linked NODES entries
  // (id = prefix+1, prefix+2, ...), each requiring the previous one (first requires `requiresFirst`).
  function buildChain(prefix, branch, tierStart, requiresFirst, entries) {
    let prev = requiresFirst;
    return entries.map((e, i) => {
      const id = prefix + (i + 1);
      const node = { id, branch, tier: tierStart + i, requires: prev, label: e.label, desc: e.desc, cost: e.cost };
      if (e.effect) node.effect = e.effect;
      if (e.kind) node.kind = e.kind;
      if (e.cards) node.cards = e.cards;
      prev = id;
      return node;
    });
  }

  const ATK_TRUNK = buildChain("atk", "atk", 1, null, [
    { label: "打撃の基礎", desc: "基礎攻撃力 +1", cost: 2, effect: { atk: 1 } },
    { label: "猛る力", desc: "基礎攻撃力 +2", cost: 6, effect: { atk: 2 } },
  ]);
  const ATK_FORK_ROOT = ATK_TRUNK[ATK_TRUNK.length - 1].id;
  // fork 1: pure power (keeps the old trunk tier-3 node as its own first step, same cost/effect as before)
  const ATK_POWER = buildChain("atkP", "atk", 3, ATK_FORK_ROOT, [
    { label: "覇道の拳", desc: "基礎攻撃力 +16", cost: 75, effect: { atk: 16 } },
    { label: "修羅の力", desc: "基礎攻撃力 +32", cost: 150, effect: { atk: 32 } },
    { label: "阿修羅の怒り", desc: "基礎攻撃力 +64", cost: 300, effect: { atk: 64 } },
    { label: "破邪の顕現", desc: "基礎攻撃力 +128", cost: 600, effect: { atk: 128 } },
    { label: "神殺しの一撃", desc: "基礎攻撃力 +256", cost: 1200, effect: { atk: 256 } },
    { label: "終末の力", desc: "基礎攻撃力 +512。「力の暴走」を追加", cost: 2400, effect: { atk: 512 }, kind: "startCards", cards: [{ type: "special", name: "力の暴走", calc: "atk2" }] },
  ]);
  // fork 2: 精鋭の記憶 lineage (adds strong attack cards to the starting deck; old trunk tier-4 node prepended)
  const ATK_ARSENAL = buildChain("atkA", "atk", 3, ATK_FORK_ROOT, [
    { label: "剛力の刻印", desc: "基礎攻撃力 +8", cost: 35, effect: { atk: 8 } },
    { label: "精鋭の記憶", desc: "「超会心撃」をデッキに追加", cost: 100, kind: "startCards", cards: [{ type: "attack", name: "超会心撃", value: 30, critRateBonus: 10, critDmgBonus: 50 }] },
    { label: "精鋭の系譜", desc: "「超会心撃」をもう1枚追加", cost: 220, kind: "startCards", cards: [{ type: "attack", name: "超会心撃", value: 30, critRateBonus: 10, critDmgBonus: 50 }] },
    { label: "精鋭の熟練", desc: "「会心撃」を追加", cost: 460, kind: "startCards", cards: [{ type: "attack", name: "会心撃", value: 18, critRateBonus: 5, critDmgBonus: 20 }] },
    { label: "精鋭の覚醒", desc: "「超会心撃」をさらに追加", cost: 950, kind: "startCards", cards: [{ type: "attack", name: "超会心撃", value: 30, critRateBonus: 10, critDmgBonus: 50 }] },
    { label: "精鋭の頂", desc: "「会心撃」+「超会心撃」追加", cost: 2000, kind: "startCards", cards: [{ type: "attack", name: "会心撃", value: 18, critRateBonus: 5, critDmgBonus: 20 }, { type: "attack", name: "超会心撃", value: 30, critRateBonus: 10, critDmgBonus: 50 }] },
  ]);
  // fork 3: 妙技の系譜 lineage (adds unique utility/scaling attack cards, not just flat stat sticks;
  // its own first node keeps the swapped-in "破壊の権化" stat boost as its own first step)
  const ATK_FLAME = buildChain("atkF", "atk", 3, ATK_FORK_ROOT, [
    { label: "破壊の権化", desc: "基礎攻撃力 +4", cost: 15, effect: { atk: 4 } },
    { label: "闘技の心得", desc: "「双撃の構え」をデッキに追加", cost: 20, kind: "startCards", cards: [{ type: "buff", name: "双撃の構え", value: 2 }] },
    { label: "賭けの妙技", desc: "「四凶の賭け」をデッキに追加", cost: 75, kind: "startCards", cards: [{ type: "buff", name: "四凶の賭け", randomValues: [4, 0.5] }] },
    { label: "毒刃の伝授", desc: "「猛毒の一撃」をデッキに追加", cost: 200, kind: "startCards", cards: [{ type: "poison", name: "猛毒の一撃" }] },
    { label: "会心の連鎖", desc: "「連撃の極致」をデッキに追加", cost: 800, kind: "startCards", cards: [{ type: "special", name: "連撃の極致", calc: "critStreak" }] },
    { label: "神域への到達", desc: "「神域の一撃」をデッキに追加", cost: 3000, kind: "startCards", cards: [{ type: "special", name: "神域の一撃", calc: "pow1_5" }] },
  ]);

  const N_TRUNK = buildChain("n", "n", 1, null, [
    { label: "不屈の魂", desc: "初期手札 +1", cost: 2, effect: { hand: 1 } },
    { label: "会心の芽生え", desc: "クリティカル率 +5%", cost: 6, effect: { critRate: 5 } },
  ]);
  const N_FORK_ROOT = N_TRUNK[N_TRUNK.length - 1].id;
  // fork 1: pure crit rate
  const N_CRIT = buildChain("nCrit", "n", 3, N_FORK_ROOT, [
    { label: "会心の連撃", desc: "クリティカル率 +4%", cost: 100, effect: { critRate: 4 } },
    { label: "会心の閃き", desc: "クリティカル率 +5%", cost: 220, effect: { critRate: 5 } },
    { label: "会心の極意", desc: "クリティカル率 +6%", cost: 460, effect: { critRate: 6 } },
    { label: "会心の神眼", desc: "クリティカル率 +10%", cost: 1200, effect: { critRate: 10 } },
  ]);
  // fork 2: critical damage
  // total across this fork is capped at 30% (critDamageBonus() also clamps defensively at runtime)
  const N_CRITDMG = buildChain("nDmg", "n", 3, N_FORK_ROOT, [
    { label: "会心撃の重み", desc: "会心ダメージ +12%", cost: 120, effect: { critDamage: 12 } },
    { label: "会心撃の激化", desc: "会心ダメージ +8%", cost: 260, effect: { critDamage: 8 } },
    { label: "会心撃の暴威", desc: "会心ダメージ +6%", cost: 540, effect: { critDamage: 6 } },
    { label: "会心撃の極致", desc: "会心ダメージ +4%", cost: 1100, effect: { critDamage: 4 } },
  ]);
  // fork 3: the original initial-turns/hand lineage, relocated here unchanged in content
  const N_HAND = buildChain("nHand", "n", 3, N_FORK_ROOT, [
    { label: "不屈の一歩", desc: "初期手数 +1", cost: 100, effect: { n: 1 } },
    { label: "不屈の意志", desc: "初期手数 +1", cost: 220, effect: { n: 1 } },
    { label: "不屈の血統", desc: "初期手数 +2", cost: 460, effect: { n: 2 } },
    { label: "大器の魂", desc: "初期手数+3・手札+1。「渾身の一撃」を追加", cost: 950, effect: { n: 3, hand: 1 }, kind: "startCards", cards: [{ type: "special", name: "渾身の一撃", calc: "n" }] },
  ]);

  const GOLD_TRUNK = buildChain("gold", "gold", 1, null, [
    { label: "商才の芽生え", desc: "獲得金額 +8%", cost: 2, effect: { goldPct: 8 } },
    { label: "商才の開花", desc: "獲得金額 +8%", cost: 6, effect: { goldPct: 8 } },
  ]);
  const GOLD_FORK_ROOT = GOLD_TRUNK[GOLD_TRUNK.length - 1].id;
  // fork 1: pure economy (old trunk tier-4 node prepended, same cost/effect as before)
  const GOLD_ECON = buildChain("goldE", "gold", 3, GOLD_FORK_ROOT, [
    { label: "商才の円熟", desc: "獲得金額 +8%", cost: 35, effect: { goldPct: 8 } },
    { label: "富の探求", desc: "獲得金額 +8%", cost: 150, effect: { goldPct: 8 } },
    { label: "富の集積", desc: "獲得金額 +10%", cost: 300, effect: { goldPct: 10 } },
    { label: "富の帝国", desc: "獲得金額 +12%", cost: 600, effect: { goldPct: 12 } },
    { label: "富の神話", desc: "獲得金額 +15%", cost: 1200, effect: { goldPct: 15 } },
    { label: "黄金郷の記憶", desc: "獲得金額 +20%", cost: 2400, effect: { goldPct: 20 } },
  ]);
  // fork 2: 経済の秘伝 lineage (shop utility; old trunk tier-3 node prepended)
  const GOLD_SHOP = buildChain("goldS", "gold", 3, GOLD_FORK_ROOT, [
    { label: "取引の極意", desc: "初回リロール無料", cost: 15, effect: { freeReroll: 1 } },
    { label: "経済の秘伝", desc: "強化コスト上昇が緩和(×2→×1.5)", cost: 130, kind: "cheapUpgrade" },
    { label: "商人の信頼", desc: "商人の提案+1件", cost: 280, effect: { shopSlots: 1 } },
    { label: "無限の交渉", desc: "無料リロール +1", cost: 600, effect: { freeReroll: 1 } },
    { label: "豪商の風格", desc: "獲得金額 +10%", cost: 1200, effect: { goldPct: 10 } },
    { label: "商会の盟主", desc: "商人の提案+1件", cost: 2400, effect: { shopSlots: 1 } },
  ]);
  // fork 3: 灼熱の血脈と対になる、開始資金を厚くする系統（旧幹5段目をそのまま先頭に配置）
  const GOLD_FORTUNE = buildChain("goldFo", "gold", 3, GOLD_FORK_ROOT, [
    { label: "市場の掌握", desc: "商人の提案+1件", cost: 75, effect: { shopSlots: 1 } },
    { label: "開拓者の懐", desc: "開始時の所持金 +20G", cost: 150, effect: { startGold: 20 } },
    { label: "遠征の備え", desc: "開始時の所持金 +30G", cost: 320, effect: { startGold: 30 } },
    { label: "商会の支援", desc: "開始時の所持金 +50G", cost: 650, effect: { startGold: 50 } },
    { label: "潤沢な資金", desc: "開始時の所持金 +80G", cost: 1300, effect: { startGold: 80 } },
    { label: "王家の後ろ盾", desc: "開始時の所持金 +150G", cost: 2600, effect: { startGold: 150 } },
  ]);

  const NODES = [].concat(
    ATK_TRUNK, ATK_POWER, ATK_ARSENAL, ATK_FLAME,
    N_TRUNK, N_CRIT, N_CRITDMG, N_HAND,
    GOLD_TRUNK, GOLD_ECON, GOLD_SHOP, GOLD_FORTUNE
  );

  // layout: plain pixel coordinates within the (large, drag-pannable) tree container.
  // Branch directions are true compass-style angles: 0/360=east, 90=north, 180=west, 270=south
  // (standard unit-circle convention; screen y is flipped since y grows downward on screen).
  function dirFromAngle(deg) {
    const rad = (deg * Math.PI) / 180;
    return { dx: Math.cos(rad), dy: -Math.sin(rad) };
  }
  // a chain of nodes spiraling outward from `origin`: each tier moves further out (radiusStep)
  // AND rotates a bit further (angleStep), so the connecting lines curve like a spiral arm
  // instead of running in a straight ray.
  function spiralChain(ids, origin, startAngle, angleStep, startRadius, radiusStep) {
    const pos = {};
    ids.forEach((id, i) => {
      const angle = startAngle + angleStep * i;
      const radius = startRadius + radiusStep * i;
      const dir = dirFromAngle(angle);
      pos[id] = { x: origin.x + dir.dx * radius, y: origin.y + dir.dy * radius };
    });
    return pos;
  }

  const ATK_ANGLE = 120;
  const N_ANGLE = 240;
  const GOLD_ANGLE = 360;
  const TRUNK_STEP = 150;
  const TRUNK_CURL = 9; // gentle spiral curl along the trunk, degrees per tier
  const FORK_STEP = 140;
  const FORK_SPREAD = 55; // initial angular separation between sub-branches at the fork point
  // (kept wide enough that adjacent sub-branch nodes stay clear of each other even at tier 1:
  // chord distance = 2*FORK_STEP*sin(FORK_SPREAD/2) must exceed the node's footprint)
  const FORK_CURL = 4; // each sub-branch keeps curling further this many degrees per tier
  // (kept small: FORK_SPREAD + FORK_CURL*tiers must stay well under 60 degrees, since each
  // major branch only has a 120-degree-wide sector before it reaches a neighboring branch)

  const ROOT = { x: 1500, y: 1500 };
  const TREE_POS = { root: ROOT };
  Object.assign(TREE_POS, spiralChain(ATK_TRUNK.map((n) => n.id), ROOT, ATK_ANGLE, TRUNK_CURL, TRUNK_STEP, TRUNK_STEP));
  Object.assign(TREE_POS, spiralChain(N_TRUNK.map((n) => n.id), ROOT, N_ANGLE, TRUNK_CURL, TRUNK_STEP, TRUNK_STEP));
  Object.assign(TREE_POS, spiralChain(GOLD_TRUNK.map((n) => n.id), ROOT, GOLD_ANGLE, TRUNK_CURL, TRUNK_STEP, TRUNK_STEP));

  const ATK_TRUNK_END = TREE_POS[ATK_TRUNK[ATK_TRUNK.length - 1].id];
  const N_TRUNK_END = TREE_POS[N_TRUNK[N_TRUNK.length - 1].id];
  const GOLD_TRUNK_END = TREE_POS[GOLD_TRUNK[GOLD_TRUNK.length - 1].id];
  const ATK_TRUNK_END_ANGLE = ATK_ANGLE + TRUNK_CURL * (ATK_TRUNK.length - 1);
  const N_TRUNK_END_ANGLE = N_ANGLE + TRUNK_CURL * (N_TRUNK.length - 1);
  const GOLD_TRUNK_END_ANGLE = GOLD_ANGLE + TRUNK_CURL * (GOLD_TRUNK.length - 1);

  // the n trunk forks the same way as atk/gold: 3 further directions, spiraling apart around its own angle
  Object.assign(TREE_POS, spiralChain(N_CRIT.map((n) => n.id), N_TRUNK_END, N_TRUNK_END_ANGLE - FORK_SPREAD, -FORK_CURL, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(N_CRITDMG.map((n) => n.id), N_TRUNK_END, N_TRUNK_END_ANGLE, FORK_CURL * 0.4, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(N_HAND.map((n) => n.id), N_TRUNK_END, N_TRUNK_END_ANGLE + FORK_SPREAD, FORK_CURL, FORK_STEP, FORK_STEP));

  // each of the atk/gold trunks forks again into 3 further directions, spiraling apart around its own angle
  Object.assign(TREE_POS, spiralChain(ATK_POWER.map((n) => n.id), ATK_TRUNK_END, ATK_TRUNK_END_ANGLE - FORK_SPREAD, -FORK_CURL, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(ATK_ARSENAL.map((n) => n.id), ATK_TRUNK_END, ATK_TRUNK_END_ANGLE, FORK_CURL * 0.4, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(ATK_FLAME.map((n) => n.id), ATK_TRUNK_END, ATK_TRUNK_END_ANGLE + FORK_SPREAD, FORK_CURL, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(GOLD_SHOP.map((n) => n.id), GOLD_TRUNK_END, GOLD_TRUNK_END_ANGLE - FORK_SPREAD, -FORK_CURL, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(GOLD_ECON.map((n) => n.id), GOLD_TRUNK_END, GOLD_TRUNK_END_ANGLE, FORK_CURL * 0.4, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(GOLD_FORTUNE.map((n) => n.id), GOLD_TRUNK_END, GOLD_TRUNK_END_ANGLE + FORK_SPREAD, FORK_CURL, FORK_STEP, FORK_STEP));

  // shared by the basic tree and the reincarnation panel: tightly re-fits a canvas (shifting
  // every position, including the origin, in place) around whatever a node layout actually
  // spans, so panning never drags through a huge stretch of empty space past the outermost nodes.
  function fitCanvasToPositions(posMap, edgePad) {
    const xs = Object.values(posMap).map((p) => p.x);
    const ys = Object.values(posMap).map((p) => p.y);
    const minX = Math.min(...xs) - edgePad;
    const maxX = Math.max(...xs) + edgePad;
    const minY = Math.min(...ys) - edgePad;
    const maxY = Math.max(...ys) + edgePad;
    Object.values(posMap).forEach((p) => { p.x -= minX; p.y -= minY; });
    return { width: maxX - minX, height: maxY - minY };
  }
  const TREE_EDGE_PAD = 90; // half a node's footprint (card is 84px wide, plus its text/border) so nothing clips
  const { width: TREE_CANVAS_WIDTH, height: TREE_CANVAS_HEIGHT } = fitCanvasToPositions(TREE_POS, TREE_EDGE_PAD);

  function defaultSave() {
    return {
      points: 0, unlockedNodes: {}, bestFloor: 0,
      deckDefs: cloneDeckDefs(BASE_DECK_DEFS), // the permanent deck: rank-ups/deletions from the title screen persist here
      startCardsBackfilled: true, // fresh saves have nothing to backfill
      transcendPoints: 0, // earned only from endless-mode (floor > 100) progress, spent on the panel below
      panelLevels: {}, // reincarnation panel: the one thing that survives a reincarnation reset
      panelSpecials: {}, // one-shot, very expensive panel purchases (also survives reincarnation)
      transcendUnlocked: false, // becomes true forever the first time the final boss is defeated
    };
  }
  function loadSave() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultSave();
      const parsed = JSON.parse(raw);
      const loadedDeckDefs = Array.isArray(parsed.deckDefs) ? parsed.deckDefs : cloneDeckDefs(BASE_DECK_DEFS);
      const merged = Object.assign(defaultSave(), parsed, {
        unlockedNodes: Object.assign({}, parsed.unlockedNodes || {}),
        panelLevels: Object.assign({}, parsed.panelLevels || {}),
        panelSpecials: Object.assign({}, parsed.panelSpecials || {}),
        // draw cards are disabled for now; strip any that survived in an older save
        deckDefs: loadedDeckDefs.filter((d) => d.type !== "draw"),
      });
      // one-time migration: startCards nodes used to grant their cards fresh every run instead
      // of permanently; backfill anything already unlocked so it isn't silently lost.
      if (!parsed.startCardsBackfilled) {
        NODES.forEach((node) => {
          if (merged.unlockedNodes[node.id] && node.kind === "startCards") {
            node.cards.forEach((c) => addCardToDeckDefs(merged.deckDefs, c));
          }
        });
        merged.startCardsBackfilled = true;
      }
      return merged;
    } catch (e) {
      return defaultSave();
    }
  }
  function persistSave() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
  }

  let save = loadSave();
  let cardUid = 0;
  let game = null;

  function treeBonus(key) {
    let total = 0;
    NODES.forEach((node) => {
      if (save.unlockedNodes[node.id] && node.effect && node.effect[key]) total += node.effect[key];
    });
    return total;
  }

  // ---------------- Reincarnation panel (permanent, survives a reincarnation reset) ----------------
  // each category is its own long branch of many small, individually-purchased steps (same
  // spiral-chain idea as the basic tree) instead of one dial with a level counter, so there's
  // always visibly more to reach for.
  const PANEL_CATEGORIES = [
    // perLevelGrowth: each successive tier's own contribution doubles (tier1 +1, tier2 +2, tier3 +4, ...)
    // instead of every tier adding the same flat amount
    // 7 branches share the circle evenly (360/7 ≈ 51.43 degrees apart): the 5 below, plus the
    // shop chain and the specials chain defined further down
    { id: "panelAtk", label: "継承の力", desc: "基礎攻撃力", key: "atk", perLevel: 1, perLevelGrowth: 2, baseCost: 5, costMult: 1.4, maxLevel: 20, angle: 90 },
    { id: "panelGold", label: "継承の福運", desc: "獲得金額 %", key: "goldPct", perLevel: 8, baseCost: 8, costMult: 1.4, maxLevel: 16, angle: 141.43 },
    { id: "panelStartPoints", label: "継承の礎", desc: "転生後の開始pt", key: "startPoints", perLevel: 15, baseCost: 6, costMult: 1.4, maxLevel: 18, angle: 192.86 },
    { id: "panelBuff", label: "継承の闘気", desc: "バフカードの倍率", key: "buffAdd", perLevel: 0.1, baseCost: 10, costMult: 1.4, maxLevel: 20, angle: 244.29 },
    { id: "panelCritDmg", label: "継承の会心", desc: "クリティカルダメージ %", key: "critDmgAdd", perLevel: 5, baseCost: 10, costMult: 1.4, maxLevel: 20, angle: 295.71 },
  ];
  function panelLevel(cat) { return save.panelLevels[cat.id] || 0; }
  // the amount a SPECIFIC tier (1-indexed) of a category contributes; flat (perLevel) unless the
  // category defines perLevelGrowth, in which case it doubles (or whatever the multiplier is) each tier
  function panelTierAmount(cat, tier) {
    if (cat.perLevelGrowth) return cat.perLevel * Math.pow(cat.perLevelGrowth, tier - 1);
    return cat.perLevel;
  }
  function panelBonus(key) {
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
    { id: "panelDmgFormula", label: "神威の書き換え", desc: "ダメージ計算式を「威力×攻撃力」に書き換える", key: "dmgFormula", cost: 2000000, requires: "panelCritMultDouble" },
  ];
  function panelSpecialOwned(special) { return !!save.panelSpecials[special.id]; }

  // card shop: title-screen-only, paid with level-up points; every item can be bought any number
  // of times, each purchase adding one more copy of that card to the permanent deck (same
  // mechanism as a skill-tree startCards node). Which items are for sale is gated by how far the
  // panel's 商人との契約 chain below has been bought, not by a single on/off unlock.
  const CARD_SHOP_POOL = [
    { id: "shopMeteor", name: "隕石落とし", cost: 500, desc: "強力な攻撃カード（威力80）を1枚デッキに追加", card: { type: "attack", name: "隕石落とし", value: 80 } },
    { id: "shopBerserk", name: "狂乱の咆哮", cost: 800, desc: "次の攻撃カードのダメージが×3になるカードを1枚デッキに追加", card: { type: "buff", name: "狂乱の咆哮", value: 3 } },
    { id: "shopExecute", name: "処刑の火", cost: 2000, desc: "敵の最大HPの30%を攻撃するカードを1枚デッキに追加", card: { type: "percent", name: "処刑の火", value: 0.3 } },
    { id: "shopEnd", name: "終焉の使者", cost: 6000, desc: "基礎攻撃力の2乗ぶんダメージを与えるカードを1枚デッキに追加", card: { type: "special", name: "終焉の使者", calc: "atk2" } },
  ];
  // a chain like the categories above, but each tier unlocks one more CARD_SHOP_POOL slot instead
  // of a numeric bonus — "ショップ開放をツリーにして購入できるカードを増やす" — priced far below
  // the specials above so the first tier (which unlocks the shop itself) is an easy early grab
  const PANEL_SHOP_CHAIN = { id: "panelShop", label: "商人との契約", baseCost: 300, costMult: 3, maxLevel: CARD_SHOP_POOL.length, angle: 347.14 };
  function shopUnlockedCount() { return panelLevel(PANEL_SHOP_CHAIN); }
  function cardShopUnlocked() { return shopUnlockedCount() > 0; }

  // layout: every category (plus the shop chain) is a long spiraling chain radiating from the
  // core at its own angle (7 directions total, ~51 degrees apart); the specials get their own
  // dedicated direction with a longer step so they read as a distinct, prominent mini-branch.
  const PANEL_CORE = { x: 0, y: 0 };
  const PANEL_POS = { core: PANEL_CORE };
  const PANEL_STEP = 165; // generous enough that even a node whose text wraps to 3-4 lines can't reach a neighboring branch
  const PANEL_CURL = 0; // dead straight spokes, like a real web's radial threads (the rings below do the curving)
  PANEL_CATEGORIES.forEach((cat) => {
    cat.nodeIds = [];
    for (let i = 1; i <= cat.maxLevel; i++) cat.nodeIds.push(cat.id + "_" + i);
    Object.assign(PANEL_POS, spiralChain(cat.nodeIds, PANEL_CORE, cat.angle, PANEL_CURL, PANEL_STEP, PANEL_STEP));
  });
  PANEL_SHOP_CHAIN.nodeIds = [];
  for (let i = 1; i <= PANEL_SHOP_CHAIN.maxLevel; i++) PANEL_SHOP_CHAIN.nodeIds.push(PANEL_SHOP_CHAIN.id + "_" + i);
  Object.assign(PANEL_POS, spiralChain(PANEL_SHOP_CHAIN.nodeIds, PANEL_CORE, PANEL_SHOP_CHAIN.angle, PANEL_CURL, PANEL_STEP, PANEL_STEP));
  const PANEL_SPECIAL_ANGLE = 38.57;
  const PANEL_SPECIAL_STEP = 220;
  Object.assign(PANEL_POS, spiralChain(PANEL_SPECIALS.map((s) => s.id), PANEL_CORE, PANEL_SPECIAL_ANGLE, 0, PANEL_SPECIAL_STEP, PANEL_SPECIAL_STEP));

  // spider-web rings: every branch that shares the PANEL_STEP radius scale (the 5 categories plus
  // the shop chain — 6 spokes, evenly spaced) gets connected to its angular neighbor at each tier
  // it has a node for, forming concentric polygons around the core — straight spokes (above) plus
  // these rings is exactly a web's radial threads + circular threads. A strand lights up once both
  // ends are owned. Branches shorter than the ring's tier (the shop chain only goes to 4) simply
  // drop out of that ring, so the remaining spokes close the gap directly.
  const PANEL_WEB_BRANCHES = [
    PANEL_CATEGORIES.find((c) => c.id === "panelAtk"),
    PANEL_CATEGORIES.find((c) => c.id === "panelGold"),
    PANEL_CATEGORIES.find((c) => c.id === "panelStartPoints"),
    PANEL_CATEGORIES.find((c) => c.id === "panelBuff"),
    PANEL_CATEGORIES.find((c) => c.id === "panelCritDmg"),
    PANEL_SHOP_CHAIN,
  ];
  function panelWebStrands() {
    const maxTier = Math.max(...PANEL_WEB_BRANCHES.map((b) => b.maxLevel));
    const strands = [];
    for (let tier = 1; tier <= maxTier; tier++) {
      const present = PANEL_WEB_BRANCHES.filter((b) => tier <= b.maxLevel);
      if (present.length < 2) continue;
      for (let i = 0; i < present.length; i++) {
        const a = present[i];
        const b = present[(i + 1) % present.length];
        strands.push({ a: PANEL_POS[a.id + "_" + tier], b: PANEL_POS[b.id + "_" + tier], active: panelLevel(a) >= tier && panelLevel(b) >= tier });
      }
    }
    return strands;
  }

  const PANEL_EDGE_PAD = 90;
  const { width: PANEL_CANVAS_WIDTH, height: PANEL_CANVAS_HEIGHT } = fitCanvasToPositions(PANEL_POS, PANEL_EDGE_PAD);

  function computeFloorHp(floor) {
    let hp = BASE_ENEMY_HP;
    for (let f = 1; f < floor; f++) {
      const mult = (f % 10 === 0) ? 1.4 : 1.1;
      hp = Math.ceil(hp * mult - 1e-9); // guard against float error (e.g. 100*1.1 === 110.00000000000001)
    }
    return hp;
  }

  function cloneDeckDefs(defs) { return defs.map((d) => Object.assign({}, d)); }

  function addCardToDeckDefs(defs, cardDef) {
    const existing = defs.find((d) => d.name === cardDef.name && d.type === cardDef.type);
    if (existing) existing.count += 1;
    else defs.push(Object.assign({}, cardDef, { count: 1 }));
  }

  const RANK_UP_BASE_COST = 15;
  const DELETE_BASE_COST = 20;
  const MIN_DECK_SIZE = 4; // deleting can never shrink the deck below this many cards total
  const DAMAGE_CARD_TYPES = ["attack", "percent", "special"];

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
    game = {
      floor: 1,
      floorPointsSum: 0, // sum of floor numbers for every monster actually defeated this run
      transcendPointsSum: 0, // same idea, but only for endless-mode (floor > 100) kills; banked only on reincarnation
      endlessMode: false, // true once the player has chosen to continue past the final boss
      enemyHp: 0,
      enemyHpMax: 0,
      n: 0,
      buffMultiplier: 1,
      gold: treeBonus("startGold"),
      runAtkBonus: 0,
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
    };
    startFloor(floor);
  }

  function currentAtk() { return BASE_ATK + treeBonus("atk") + panelBonus("atk") + game.runAtkBonus; }
  function currentStartHand() { return BASE_HAND + treeBonus("hand") + panelBonus("hand") + game.runHandBonus; }
  function currentStartN() { return BASE_N + treeBonus("n") + panelBonus("n") + (game.runNBonus || 0); }
  function goldMultiplier() { return 1 + (treeBonus("goldPct") + panelBonus("goldPct") + (game.runGoldPctBonus || 0)) / 100; }
  function freeRerollAllowance() { return treeBonus("freeReroll"); }
  function shopOfferCount() { return 2 + treeBonus("shopSlots"); }
  function upgradeCostMultiplier() { return save.unlockedNodes.goldS1 ? 1.5 : 2; }
  const BASE_CRIT_MULT = 1.5;
  const TREE_CRIT_DAMAGE_CAP = 30; // the skill tree alone can never push critDamage past this
  // panel bonuses (継承の会心・会心の覚醒) are a permanent, post-transcend layer and are
  // deliberately NOT subject to the tree-only cap above
  function critRate() { return Math.min(100, treeBonus("critRate") + game.runCritRateBonus + (save.panelSpecials.panelCritRateBurst ? 40 : 0)); }
  function critDamageBonus() { return Math.min(TREE_CRIT_DAMAGE_CAP, treeBonus("critDamage")) + game.runCritDamageBonus + panelBonus("critDmgAdd"); }
  // cardRateBonus/cardDmgBonus let an individual card (e.g. 会心撃/超会心撃) add to its own crit
  // roll and multiplier on top of the player's usual crit stats, without touching any other card
  function critMultiplier(cardDmgBonus) {
    const base = BASE_CRIT_MULT + (critDamageBonus() + (cardDmgBonus || 0)) / 100;
    return save.panelSpecials.panelCritMultDouble ? base * 2 : base;
  }
  function rollCrit(cardRateBonus) { return Math.random() * 100 < critRate() + (cardRateBonus || 0); }

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
  function effectiveValue(card) {
    const rank = card.rank || 0;
    if (card.type === "attack" || card.type === "percent") return card.value * (1 + rank * 0.5);
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
    game.enemyHpMax = computeFloorHp(floor);
    game.enemyHp = game.enemyHpMax;
    game.n = currentStartN();
    game.buffMultiplier = 1;
    game.enemyPoisoned = false; // a fresh enemy each floor, never carries poison over
    game.critStreak = 0;
    game.gameOver = false;
    game.deck = buildShuffledDeck();
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

  // ---------------- DOM refs ----------------
  const el = {
    bestFloorLabel: document.getElementById("bestFloorLabel"),
    homePointsLabel: document.getElementById("homePointsLabel"),
    openFloorSelectBtn: document.getElementById("openFloorSelectBtn"),
    resetProgressBtn: document.getElementById("resetProgressBtn"),
    openTreeBtn: document.getElementById("openTreeBtn"),
    openDeckUpgradeBtn: document.getElementById("openDeckUpgradeBtn"),
    openCardShopBtn: document.getElementById("openCardShopBtn"),

    deckUpgradeBackBtn: document.getElementById("deckUpgradeBackBtn"),
    deckUpgradePointsLabel: document.getElementById("deckUpgradePointsLabel"),

    cardShopBackBtn: document.getElementById("cardShopBackBtn"),
    cardShopPointsLabel: document.getElementById("cardShopPointsLabel"),
    cardShopOptions: document.getElementById("cardShopOptions"),

    floorSelectBackBtn: document.getElementById("floorSelectBackBtn"),
    floorSelectGrid: document.getElementById("floorSelectGrid"),

    treeBackBtn: document.getElementById("treeBackBtn"),
    treePointsLabel: document.getElementById("treePointsLabel"),
    treeMap: document.getElementById("treeMap"),
    treeScrollWrap: document.getElementById("treeScrollWrap"),
    treeMapScaler: document.getElementById("treeMapScaler"),

    floorLabel: document.getElementById("floorLabel"),
    battleSide: document.getElementById("battleSide"),
    enemyVisual: document.getElementById("enemyVisual"),
    enemyName: document.getElementById("enemyName"),
    enemyHpNow: document.getElementById("enemyHpNow"),
    enemyHpMax: document.getElementById("enemyHpMax"),
    enemyBar: document.getElementById("enemyBar"),
    statN: document.getElementById("statN"),
    statAtk: document.getElementById("statAtk"),
    statBuff: document.getElementById("statBuff"),
    log: document.getElementById("log"),
    hand: document.getElementById("hand"),
    handCount: document.getElementById("handCount"),
    deckCount: document.getElementById("deckCount"),
    deckPile: document.getElementById("deckPile"),
    deckPileCount: document.getElementById("deckPileCount"),
    battleGold: document.getElementById("battleGold"),

    floorClearSub: document.getElementById("floorClearSub"),
    shopGold: document.getElementById("shopGold"),
    shopOptions: document.getElementById("shopOptions"),
    deckZoneList: document.getElementById("deckZoneList"),
    deckZoneTotal: document.getElementById("deckZoneTotal"),
    rerollBtn: document.getElementById("rerollBtn"),
    toNextFloorBtn: document.getElementById("toNextFloorBtn"),
    retreatBtn: document.getElementById("retreatBtn"),

    defeatFloor: document.getElementById("defeatFloor"),
    defeatPoints: document.getElementById("defeatPoints"),
    defeatToHomeBtn: document.getElementById("defeatToHomeBtn"),

    retreatFloor: document.getElementById("retreatFloor"),
    retreatPoints: document.getElementById("retreatPoints"),
    retreatToHomeBtn: document.getElementById("retreatToHomeBtn"),

    victoryPoints: document.getElementById("victoryPoints"),
    victoryToHomeBtn: document.getElementById("victoryToHomeBtn"),
    enterEndlessBtn: document.getElementById("enterEndlessBtn"),

    homeTranscendStat: document.getElementById("homeTranscendStat"),
    homeTranscendLabel: document.getElementById("homeTranscendLabel"),
    openPanelBtn: document.getElementById("openPanelBtn"),
    panelPointsLabel: document.getElementById("panelPointsLabel"),
    panelMap: document.getElementById("panelMap"),
    panelScrollWrap: document.getElementById("panelScrollWrap"),
    panelMapScaler: document.getElementById("panelMapScaler"),
  };

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    document.getElementById("screen-" + name).classList.add("active");
    document.body.classList.toggle("home-bg", name === "home");
  }

  const E_NOTATION_THRESHOLD = 1e9; // below this, plain comma-separated numbers; at/above, "+E" notation
  function fmt(n) {
    const rounded = Math.round(n);
    if (Math.abs(rounded) >= E_NOTATION_THRESHOLD) {
      return rounded.toExponential(2).replace("e+", "E+").replace("e-", "E-");
    }
    return rounded.toLocaleString("ja-JP");
  }
  // for multipliers (buff cards): fmt() rounds to a whole number, which would hide a fractional
  // bonus like 継承の闘気's +0.1/level; round to 2dp instead (also mops up float noise like 2.3000000000000003)
  function fmtMult(n) {
    return (Math.round(n * 100) / 100).toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  }

  function addLog(text, cls) {
    const line = document.createElement("div");
    line.className = "log-line" + (cls ? " " + cls : "");
    line.textContent = text;
    el.log.prepend(line);
  }

  function floatDamage(amount, isCrit) {
    const rect = el.enemyVisual.getBoundingClientRect();
    const f = document.createElement("div");
    const ratio = game.enemyHpMax > 0 ? amount / game.enemyHpMax : 0;
    const isHuge = ratio >= 0.5;
    let cls = "dmg-float";
    if (isCrit) {
      cls += " dmg-crit";
      if (isHuge) cls += " dmg-huge";
    } else if (isHuge) {
      cls += " dmg-huge";
    } else if (ratio >= 0.15) {
      cls += " dmg-big";
    }
    f.className = cls;
    f.textContent = (isCrit ? "会心！-" : "-") + fmt(amount);
    f.style.left = rect.left + "px";
    f.style.width = rect.width + "px";
    f.style.top = (rect.top + rect.height / 2 - 20) + "px";
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 2000);
    impactEffects(isCrit, isHuge);
  }

  // screen shake + flash, layered on top of the floating number for extra "juice" on big hits.
  // shakes .app (not body) so the fixed-position damage number / flash overlay stay viewport-stable
  // instead of jittering along with the transform (position:fixed re-anchors to a transformed ancestor).
  function impactEffects(isCrit, isHuge) {
    if (!isCrit && !isHuge) return;
    const appEl = document.querySelector(".app");
    const shakeCls = isCrit && isHuge ? "shake-mega" : isCrit ? "shake-crit" : "shake-huge";
    appEl.classList.remove("shake-crit", "shake-huge", "shake-mega");
    void appEl.offsetWidth; // restart the animation even if the same class was just applied
    appEl.classList.add(shakeCls);
    setTimeout(() => appEl.classList.remove(shakeCls), 500);

    const flash = document.createElement("div");
    flash.className = "screen-flash " + (isCrit ? "flash-crit" : "flash-huge");
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 450);
  }

  // ---------------- Battle logic ----------------
  // shared between resolveCardEffect's "special" branch and the hand-display preview label, so
  // what a card promises in your hand is exactly what it deals when played
  function specialCardRaw(card) {
    if (card.calc === "n") return game.n;
    if (card.calc === "critStreak") return currentAtk() * Math.max(1, game.critStreak); // scales with consecutive crits landed so far
    if (card.calc === "pow1_5") return Math.pow(currentAtk(), 1.5); // superlinear late-game scaling
    return currentAtk() * currentAtk(); // "atk2" (legacy default)
  }

  // (value + atk) is the normal attack formula; the endgame panel purchase "神威の書き換え"
  // replaces the + with a * instead — weaker at low attack, but scales explosively once attack is large
  function attackBaseDamage(card) {
    return save.panelSpecials.panelDmgFormula
      ? effectiveValue(card) * currentAtk()
      : effectiveValue(card) + currentAtk();
  }

  // Resolves a single card's effect (damage/draw/buff/chain). Does not touch hand/deck/n bookkeeping,
  // so it can be reused both for a directly-played card and for cards triggered by a chain card.
  function resolveCardEffect(card) {
    if (card.type === "attack") {
      const mult = game.buffMultiplier;
      const isCrit = card.forceCrit || rollCrit(card.critRateBonus);
      const critMult = isCrit ? critMultiplier(card.critDmgBonus) : 1;
      const dmg = Math.ceil(attackBaseDamage(card) * mult * critMult);
      game.enemyHp = Math.max(0, game.enemyHp - dmg);
      game.critStreak = isCrit ? game.critStreak + 1 : 0;
      const buffNote = mult > 1 ? `（バフ×${fmtMult(mult)}）` : "";
      if (isCrit) addLog(`${card.name} で会心の一撃！ ${fmt(dmg)} ダメージ！${buffNote}`, "dmg crit");
      else addLog(`${card.name} で ${fmt(dmg)} ダメージ！${buffNote}`, "dmg");
      floatDamage(dmg, isCrit);
      game.buffMultiplier = 1;
    } else if (card.type === "percent") {
      const mult = game.buffMultiplier;
      const isCrit = rollCrit();
      const critMult = isCrit ? critMultiplier() : 1;
      const pct = effectiveValue(card);
      const dmg = Math.ceil(game.enemyHpMax * pct * mult * critMult);
      game.enemyHp = Math.max(0, game.enemyHp - dmg);
      game.critStreak = isCrit ? game.critStreak + 1 : 0;
      const critNote = isCrit ? "会心の一撃！ " : "";
      addLog(`${card.name}：${critNote}敵の最大HPの${Math.round(pct * 100)}%、${fmt(dmg)} ダメージ！`, isCrit ? "percent crit" : "percent");
      floatDamage(dmg, isCrit);
      game.buffMultiplier = 1;
    } else if (card.type === "draw") {
      const count = effectiveValue(card);
      addLog(`${card.name}：カードを${count}枚引いた`, "info");
      for (let i = 0; i < count; i++) drawOne();
    } else if (card.type === "buff") {
      // most buff cards apply a fixed multiplier, but a card can instead carry a randomValues
      // list (e.g. a 50/50 gamble) to pick from each time it's played; panelBonus("buffAdd")
      // (継承の闘気) adds a permanent flat bonus on top of whatever this specific card rolls
      const cardMult = card.randomValues ? card.randomValues[Math.floor(Math.random() * card.randomValues.length)] : effectiveValue(card);
      const appliedMult = cardMult + panelBonus("buffAdd");
      game.buffMultiplier *= appliedMult;
      addLog(`${card.name}：次の攻撃カードのダメージが×${fmtMult(game.buffMultiplier)}に！`, "buff");
    } else if (card.type === "poison") {
      // a status flag, not a stacking counter: playing this again while already poisoned does nothing extra
      if (game.enemyPoisoned) {
        addLog(`${card.name}：敵は既に毒状態だ（効果は重複しない）`, "info");
      } else {
        game.enemyPoisoned = true;
        addLog(`${card.name}：敵を猛毒状態にした！`, "buff");
      }
    } else if (card.type === "special") {
      const mult = game.buffMultiplier;
      const isCrit = rollCrit();
      const critMult = isCrit ? critMultiplier() : 1;
      const raw = specialCardRaw(card);
      const dmg = Math.ceil(raw * mult * critMult);
      game.enemyHp = Math.max(0, game.enemyHp - dmg);
      game.critStreak = isCrit ? game.critStreak + 1 : 0;
      const buffNote = mult > 1 ? `（バフ×${fmtMult(mult)}）` : "";
      if (isCrit) addLog(`${card.name} で会心の一撃！ ${fmt(dmg)} ダメージ！${buffNote}`, "dmg crit");
      else addLog(`${card.name} で ${fmt(dmg)} ダメージ！${buffNote}`, "dmg");
      floatDamage(dmg, isCrit);
      game.buffMultiplier = 1;
    } else if (card.type === "chain") {
      // trigger every hand card sharing the target tag (excluding other chain cards, to prevent chain-of-chain loops)
      const matches = game.hand.filter((c) => c.type !== "chain" && Array.isArray(c.tags) && c.tags.includes(card.targetTag));
      const tagLabel = TAG_LABELS[card.targetTag] || card.targetTag;
      addLog(`${card.name}：『${tagLabel}』タグのカードを${matches.length}枚連鎖使用！`, "buff");
      matches.forEach((m) => {
        const idx = game.hand.findIndex((h) => h.uid === m.uid);
        if (idx === -1) return; // already consumed by an earlier chain this same trigger
        game.hand.splice(idx, 1);
        resolveCardEffect(m);
        returnCardAfterPlay(m);
        // each chained card is still "consumed 1 -> draw 1", same as a normal play; flag the
        // replacement so it enters the hand face-down and flips, same as a direct play
        const drawn = drawOne();
        if (drawn) drawn.justDrawn = true;
      });
    }
  }

  // draw cards are spent, not cycled: once played they vanish from the deck for the rest of
  // this floor (the deck rebuilds from scratch, draw cards included, at the start of the next).
  // every other card returns to the bottom of the deck as usual.
  function returnCardAfterPlay(card) {
    if (card.type !== "draw") game.deck.push(card);
  }

  const CARD_PLAY_ANIM_MS = 340; // must match the .card.playing / cardPlayFx animation duration
  const FLIP_SLIDE_MS = 320; // hand reflow: cards sliding left + the new card flying in from the deck pile
  const CARD_FLIP_DELAY_MS = 650; // how long a newly drawn card stays face-down before it flips to reveal itself
  const POISON_DAMAGE_PCT = 0.05; // 5% of max HP per player move while poisoned; doesn't stack

  // ticks once per player move (not per chain-triggered sub-card) while the enemy is poisoned
  function applyPoisonTick() {
    if (!game.enemyPoisoned || game.enemyHp <= 0) return;
    const dmg = Math.ceil(game.enemyHpMax * POISON_DAMAGE_PCT - 1e-9);
    game.enemyHp = Math.max(0, game.enemyHp - dmg);
    addLog(`毒の傷が疼く…${fmt(dmg)} ダメージ`, "dmg");
    floatDamage(dmg, false);
  }

  // playing a card is a two-stage sequence: first a quick "used" effect plays on the card in
  // place (see .card.playing), and only once that finishes does the card actually resolve,
  // get replaced, and the replacement enter the hand face-down (see renderBattle's flip-in).
  function playCard(uid) {
    if (game.gameOver) return;
    const card = game.hand.find((c) => c.uid === uid);
    if (!card || card.playing) return;
    const thisGame = game;
    card.playing = true;
    renderBattle();

    setTimeout(() => {
      card.playing = false;
      if (game !== thisGame || game.gameOver) return; // the floor ended/changed while this was animating
      const idx = game.hand.findIndex((c) => c.uid === uid);
      if (idx === -1) return;
      game.hand.splice(idx, 1);

      resolveCardEffect(card);
      applyPoisonTick();

      returnCardAfterPlay(card);
      const drawn = drawOne(); // consumed 1 card -> always draw exactly 1 replacement
      if (drawn) drawn.justDrawn = true;
      game.n -= 1;

      renderBattle();
      checkResult();
    }, CARD_PLAY_ANIM_MS);
  }

  function checkResult() {
    if (game.enemyHp <= 0) onFloorWin();
    else if (game.n <= 0) onFloorLoss();
  }

  // points earned = sum of the floor numbers of every monster actually defeated this run
  // (not a count-based formula), so challenging a higher checkpoint is worth what it should be:
  // e.g. starting at floor91 and clearing 3 floors yields 91+92+93 pts, not the same tiny amount
  // a floor1-3 clear would give.
  function awardRunEndPoints() {
    const gained = game.floorPointsSum;
    save.points += gained;
    save.bestFloor = Math.max(save.bestFloor, game.floor);
    persistSave();
    return gained;
  }

  function onFloorWin() {
    game.gameOver = true;
    addLog(`敵を撃破した！`, "info");
    game.floorPointsSum += game.floor;

    let transcendGained = 0;
    if (game.floor > FINAL_FLOOR) {
      // endless-mode floors bank transcend points immediately (not deferred to a later
      // "reincarnate" action), so they're never lost by retreating or dying afterward.
      transcendGained = Math.ceil(game.floor * (1 + panelBonus("transcendGainPct") / 100) - 1e-9);
      save.transcendPoints += transcendGained;
      game.transcendPointsSum += transcendGained;
    }

    if (game.floor === FINAL_FLOOR && !game.endlessMode) {
      // first time reaching the final boss this run: offer the endless-mode choice.
      // reaching this at all permanently unlocks the reincarnation panel for future titles.
      const gained = awardRunEndPoints();
      save.transcendUnlocked = true;
      persistSave();
      el.victoryPoints.textContent = fmt(gained);
      showScreen("finalVictory");
    } else {
      save.bestFloor = Math.max(save.bestFloor, game.floor);
      persistSave();
      const goldGain = Math.ceil((10 + game.floor * 3) * goldMultiplier() - 1e-9);
      game.gold += goldGain;
      openFloorClear(goldGain, transcendGained);
    }
  }

  function onFloorLoss() {
    game.gameOver = true;
    addLog(`手数が尽きた。塔から追い出される…`, "dmg");
    const gained = awardRunEndPoints(); // the floor they died on was never added to floorPointsSum
    el.defeatFloor.textContent = game.floor;
    el.defeatPoints.textContent = fmt(gained);
    showScreen("defeat");
  }

  function onRetreat() {
    game.gameOver = true;
    const gained = awardRunEndPoints(); // the current floor's monster was already added when it was cleared
    el.retreatFloor.textContent = game.floor;
    el.retreatPoints.textContent = fmt(gained);
    showScreen("retreat");
  }

  // reincarnation: transcend points are already banked in real time as endless floors are
  // cleared (see onFloorWin), so pressing the title's "転生" button just performs the reset
  // itself, then drops the player straight into the panel to spend what they've saved up.
  // Only the reincarnation panel (save.panelLevels) and save.transcendPoints survive.
  function reincarnateNow() {
    save.points = panelBonus("startPoints");
    save.unlockedNodes = {};
    save.deckDefs = cloneDeckDefs(BASE_DECK_DEFS);
    save.bestFloor = 0;
    persistSave();
    game = null;
    showScreen("panel");
    renderPanel();
    centerPanelOnCore();
  }

  el.defeatToHomeBtn.addEventListener("click", () => { game = null; showScreen("home"); renderHome(); });
  el.victoryToHomeBtn.addEventListener("click", () => { game = null; showScreen("home"); renderHome(); });
  el.retreatToHomeBtn.addEventListener("click", () => { game = null; showScreen("home"); renderHome(); });
  el.enterEndlessBtn.addEventListener("click", () => {
    game.endlessMode = true;
    startFloor(FINAL_FLOOR + 1);
  });

  // ---------------- Shop (floor clear) ----------------
  // shop only sells temporary this-run stat boosts now; deck changes (rank-up/delete, new
  // cards via the skill tree) are permanent, meta-level actions handled outside a run.
  const SHOP_POOL = [
    { id: "atk3", name: "闘志の秘薬", desc: "基礎攻撃力 +3（このラン中）", baseCost: 20, apply: () => { game.runAtkBonus += 3; } },
    { id: "hand1", name: "集中の秘薬", desc: "初期手札 +1（このラン中）", baseCost: 30, apply: () => { game.runHandBonus += 1; } },
    { id: "critRate1", name: "会心の秘薬", desc: "クリティカル率 +10%（このラン中）", baseCost: 25, apply: () => { game.runCritRateBonus += 10; } },
    { id: "critDmg1", name: "会心撃の秘薬", desc: "クリティカルダメージ +15%（このラン中）", baseCost: 25, apply: () => { game.runCritDamageBonus += 15; } },
    { id: "goldRun1", name: "強欲の秘薬", desc: "獲得金額 +50%（このラン中）", baseCost: 30, apply: () => { game.runGoldPctBonus += 50; } },
    { id: "runN1", name: "疾風の秘薬", desc: "初期手数 +2（このラン中）", baseCost: 35, apply: () => { game.runNBonus += 2; } },
  ];

  function availableShopPool() {
    return SHOP_POOL.filter((opt) => !opt.unlockFloor || save.bestFloor >= opt.unlockFloor);
  }

  function pickRandom(arr, count) {
    const copy = arr.slice();
    const out = [];
    while (out.length < count && copy.length > 0) {
      const i = Math.floor(Math.random() * copy.length);
      out.push(copy.splice(i, 1)[0]);
    }
    return out;
  }

  function openFloorClear(goldGain, transcendGained) {
    const transcendNote = transcendGained ? `　転生ポイント+${fmt(transcendGained)}獲得（獲得済み、消えない）。` : "";
    el.floorClearSub.textContent = `所持金が増えた（+${fmt(goldGain)}G）。次の階層へ進む前に商人から購入できる。${transcendNote}`;
    game.shopOffers = pickRandom(availableShopPool(), shopOfferCount()).map((opt) => ({ opt, cost: opt.baseCost + game.floor * 2, bought: false }));
    game.shopRerollsUsed = 0;
    renderShop();
    showScreen("floorClear");
  }

  // deck strengthening screen: title-screen-only, permanent, paid with level-up points (save.points)
  function renderDeckZone() {
    el.deckUpgradePointsLabel.textContent = fmt(save.points);
    el.deckZoneTotal.textContent = `編成デッキ: ${fmt(totalActiveCards())}枚`;
    el.deckZoneList.innerHTML = "";
    save.deckDefs.forEach((def) => {
      const rCost = rankUpCost(def);
      const dCost = deleteCost(def);
      const deletable = canDeleteCard(def);
      const active = activeCount(def);
      const canDec = canDecreaseActive(def);
      const canInc = canIncreaseActive(def);
      const row = document.createElement("div");
      row.className = "deck-zone-row";
      const rankEligible = def.type !== "chain" && def.type !== "special" && def.type !== "poison" && !def.randomValues;
      const rankLabel = def.rank ? ` / Lv.${def.rank}` : "";
      row.innerHTML = `
        <div class="dz-info">
          <div class="dz-name">${def.name}</div>
          <div class="dz-meta">${TYPE_LABELS[def.type] || def.type} / 所持${def.count}枚${rankLabel}</div>
        </div>
        <div class="dz-active">
          <button class="dz-btn" ${canDec ? "" : "disabled"} data-action="activeDown">−</button>
          <span class="dz-active-count">編成 ${active}/${def.count}</span>
          <button class="dz-btn" ${canInc ? "" : "disabled"} data-action="activeUp">＋</button>
        </div>
        <div class="dz-actions">
          <button class="dz-btn" ${rankEligible ? "" : "disabled"} data-action="rank">強化 ${fmt(rCost)}pt</button>
          <button class="dz-btn danger" ${deletable ? "" : "disabled"} data-action="delete">削除 ${deletable ? fmt(dCost) + "pt" : "これ以上不可"}</button>
        </div>
      `;
      const rankBtn = row.querySelector('[data-action="rank"]');
      const deleteBtn = row.querySelector('[data-action="delete"]');
      const activeDownBtn = row.querySelector('[data-action="activeDown"]');
      const activeUpBtn = row.querySelector('[data-action="activeUp"]');
      if (rankEligible) {
        rankBtn.disabled = save.points < rCost;
        rankBtn.addEventListener("click", () => {
          rankUpDeckDef(def);
          renderDeckZone();
        });
      }
      if (deletable) {
        deleteBtn.disabled = save.points < dCost;
        deleteBtn.addEventListener("click", () => {
          deleteDeckDef(def);
          renderDeckZone();
        });
      }
      if (canDec) activeDownBtn.addEventListener("click", () => { adjustActive(def, -1); renderDeckZone(); });
      if (canInc) activeUpBtn.addEventListener("click", () => { adjustActive(def, 1); renderDeckZone(); });
      el.deckZoneList.appendChild(row);
    });
  }

  function renderCardShop() {
    el.cardShopPointsLabel.textContent = fmt(save.points);
    el.cardShopOptions.innerHTML = "";
    // the panel's 商人との契約 chain unlocks these one at a time, in order
    CARD_SHOP_POOL.slice(0, shopUnlockedCount()).forEach((item) => {
      const owned = save.deckDefs.find((d) => d.name === item.card.name && d.type === item.card.type);
      const countLabel = owned ? `（所持 ${owned.count}枚）` : "";
      const affordable = save.points >= item.cost;
      const div = document.createElement("div");
      div.className = "option-card" + (affordable ? "" : " disabled");
      div.innerHTML = `<div class="oc-name">${item.name}${countLabel}</div><div class="oc-desc">${item.desc}</div><div class="oc-cost">${fmt(item.cost)}pt</div>`;
      if (affordable) {
        div.addEventListener("click", () => {
          if (save.points < item.cost) return;
          save.points -= item.cost;
          addCardToDeckDefs(save.deckDefs, item.card);
          persistSave();
          renderCardShop();
        });
      }
      el.cardShopOptions.appendChild(div);
    });
  }

  function rerollCost() {
    const freeLeft = freeRerollAllowance() - game.shopRerollsUsed;
    if (freeLeft > 0) return 0;
    const paidRerolls = game.shopRerollsUsed - freeRerollAllowance();
    return 10 + game.floor * 2 + paidRerolls * 5;
  }

  function renderShop() {
    el.shopGold.textContent = fmt(game.gold);
    el.shopOptions.innerHTML = "";
    game.shopOffers.forEach((offer) => {
      const div = document.createElement("div");
      const affordable = !offer.bought && game.gold >= offer.cost;
      div.className = "option-card" + (offer.bought || !affordable ? " disabled" : "");
      div.innerHTML = `<div class="oc-name">${offer.opt.name}</div><div class="oc-desc">${offer.opt.desc}</div><div class="oc-cost">${offer.bought ? "購入済み" : fmt(offer.cost) + " G"}</div>`;
      if (!offer.bought && affordable) {
        div.addEventListener("click", () => {
          game.gold -= offer.cost;
          offer.opt.apply();
          offer.bought = true;
          addLog(`購入：${offer.opt.name}`, "gold");
          renderShop();
        });
      }
      el.shopOptions.appendChild(div);
    });

    const cost = rerollCost();
    const free = cost === 0;
    const canReroll = free || game.gold >= cost;
    el.rerollBtn.textContent = free ? `リロール（無料）` : `リロール（${fmt(cost)}G）`;
    el.rerollBtn.disabled = !canReroll;
    el.rerollBtn.style.opacity = canReroll ? "1" : "0.5";
  }

  el.rerollBtn.addEventListener("click", () => {
    const cost = rerollCost();
    if (cost > 0) {
      if (game.gold < cost) return;
      game.gold -= cost;
    }
    game.shopRerollsUsed += 1;
    game.shopOffers = pickRandom(availableShopPool(), shopOfferCount()).map((opt) => ({ opt, cost: opt.baseCost + game.floor * 2, bought: false }));
    addLog(cost > 0 ? `商人のラインナップをリロール（-${fmt(cost)}G）` : `商人のラインナップをリロール（無料）`, "gold");
    renderShop();
  });

  el.toNextFloorBtn.addEventListener("click", () => {
    game.shopOffers = null;
    startFloor(game.floor + 1);
  });

  el.retreatBtn.addEventListener("click", () => {
    onRetreat();
  });

  // ---------------- Render: battle ----------------
  function renderBattle() {
    const enemy = enemyForFloor(game.floor);
    el.floorLabel.textContent = game.floor > FINAL_FLOOR ? `階層 ${game.floor}（エンドレス）` : `階層 ${game.floor} / ${FINAL_FLOOR}`;
    el.enemyName.textContent = enemy.name;
    el.enemyName.classList.toggle("boss", enemy.isBoss);
    el.enemyBar.classList.toggle("boss", enemy.isBoss);
    el.enemyVisual.classList.toggle("boss", enemy.isBoss);
    el.enemyVisual.classList.toggle("has-backdrop", !enemy.isBoss);
    el.enemyVisual.classList.toggle("boss-bg", enemy.isBoss);
    if (el.enemyVisual.dataset.art !== enemy.art) {
      el.enemyVisual.dataset.art = enemy.art;
      el.enemyVisual.innerHTML = `<img src="${enemy.art}" alt="${enemy.name}">`;
    }
    el.enemyHpNow.textContent = fmt(game.enemyHp);
    el.enemyHpMax.textContent = fmt(game.enemyHpMax);
    el.enemyBar.style.width = Math.max(0, (game.enemyHp / game.enemyHpMax) * 100) + "%";
    el.statN.textContent = game.n;
    el.statAtk.textContent = currentAtk();
    if (game.buffMultiplier > 1) {
      el.statBuff.textContent = "×" + game.buffMultiplier;
      el.statBuff.classList.add("buff-active");
    } else {
      el.statBuff.textContent = "-";
      el.statBuff.classList.remove("buff-active");
    }
    el.deckCount.textContent = game.deck.length;
    el.deckPileCount.textContent = game.deck.length;
    el.handCount.textContent = game.hand.length + "枚";
    el.battleGold.textContent = fmt(game.gold);

    // FLIP technique: record where every current card (and the deck pile) sits before the
    // rebuild, so cards can visibly slide from their old spot to their new one afterward
    // instead of just jumping there.
    const prevRects = new Map();
    el.hand.querySelectorAll("[data-uid]").forEach((node) => {
      prevRects.set(node.dataset.uid, node.getBoundingClientRect());
    });
    const prevDeckRect = el.deckPile.getBoundingClientRect();

    el.hand.innerHTML = "";
    const toFlip = [];
    const newUids = [];
    game.hand.forEach((card) => {
      const cardClass = "card " + card.type + (card.playing ? " playing" : "");
      let typeLabel = TYPE_LABELS[card.type] || "バフ";
      let valueLabel;
      if (card.type === "attack") valueLabel = fmt(attackBaseDamage(card)) + " dmg";
      else if (card.type === "draw") valueLabel = "+" + effectiveValue(card) + "枚";
      else if (card.type === "percent") valueLabel = Math.round(effectiveValue(card) * 100) + "%";
      else if (card.type === "special") valueLabel = fmt(specialCardRaw(card)) + " dmg";
      else if (card.type === "poison") valueLabel = "猛毒付与";
      else if (card.type === "chain") {
        const count = game.hand.filter((c) => c.uid !== card.uid && c.type !== "chain" && Array.isArray(c.tags) && c.tags.includes(card.targetTag)).length;
        valueLabel = count + "枚連鎖";
      } else if (card.randomValues) valueLabel = card.randomValues.map((v) => "×" + fmtMult(v + panelBonus("buffAdd"))).join(" / ");
      else valueLabel = "×" + fmtMult(effectiveValue(card) + panelBonus("buffAdd"));
      // always render both slots (even empty) so a card's name/value line lands in the same
      // spot regardless of whether this particular card happens to have a rank or crit note
      const rankBadge = `<div class="card-rank">${card.rank ? "Lv." + card.rank : ""}</div>`;
      const critNote = `<div class="card-crit-note">${(card.critRateBonus || card.critDmgBonus) ? `会心+${card.critRateBonus || 0}%/ダメ+${card.critDmgBonus || 0}%` : ""}</div>`;
      const contentHtml = `<div class="card-type">${typeLabel}</div><div class="card-name">${card.name}</div>${rankBadge}<div class="card-value">${valueLabel}</div>${critNote}`;

      if (card.justDrawn) {
        // freshly drawn this render: enters face-down (see the slide-in + delayed flip below)
        const outer = document.createElement("div");
        outer.className = "card-flip-outer";
        outer.dataset.uid = card.uid;
        const inner = document.createElement("div");
        inner.className = "card-flip-inner";
        const back = document.createElement("div");
        back.className = "card-flip-face card-back";
        const front = document.createElement("div");
        front.className = "card-flip-face card-front " + cardClass;
        front.innerHTML = contentHtml;
        front.addEventListener("click", () => playCard(card.uid));
        inner.appendChild(back);
        inner.appendChild(front);
        outer.appendChild(inner);
        el.hand.appendChild(outer);
        toFlip.push(inner);
        newUids.push(String(card.uid));
        card.justDrawn = false; // only play the draw-in animation once
      } else {
        const div = document.createElement("div");
        div.className = cardClass;
        div.dataset.uid = card.uid;
        div.innerHTML = contentHtml;
        div.addEventListener("click", () => playCard(card.uid));
        el.hand.appendChild(div);
      }
    });
    el.hand.appendChild(el.deckPile); // always the last grid item: same cell size, sits to the right

    // slide every card (existing ones sliding left to fill the gap, new ones flying in from the
    // deck pile) from its recorded old position to where it just landed.
    el.hand.querySelectorAll("[data-uid]").forEach((node) => {
      const uid = node.dataset.uid;
      const isNew = newUids.includes(uid);
      const fromRect = prevRects.get(uid) || (isNew ? prevDeckRect : null);
      if (!fromRect) return; // no earlier position on record (e.g. the initial deal) -> nothing to slide from
      const newRect = node.getBoundingClientRect();
      const dx = fromRect.left - newRect.left;
      const dy = fromRect.top - newRect.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      node.style.transition = "none";
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          node.style.transition = `transform ${FLIP_SLIDE_MS}ms ease`;
          node.style.transform = "";
          setTimeout(() => { node.style.transition = ""; }, FLIP_SLIDE_MS);
        });
      });
    });

    if (toFlip.length) {
      // stay face-down for a beat after arriving, then flip to reveal
      setTimeout(() => {
        toFlip.forEach((inner) => inner.classList.add("flipped"));
      }, CARD_FLIP_DELAY_MS);
    }

    syncEnemyVisualHeight();
  }

  // the battle screen stacks into one column below 860px -- except on a short landscape window
  // (a phone turned sideways), where the width is there and the height is what is scarce, so
  // style.css puts the two columns back. These mirror that pair of media queries.
  const narrowBattleMQ = window.matchMedia("(max-width: 860px)");
  const landscapeBattleMQ = window.matchMedia("(max-height: 520px) and (min-width: 640px) and (orientation: landscape)");
  function isStackedBattleLayout() {
    return narrowBattleMQ.matches && !landscapeBattleMQ.matches;
  }

  // makes the enemy art zone's bottom edge land exactly on the log panel's bottom edge: measures
  // the stats+log column's real rendered height and the enemy panel's own non-art content height,
  // then sets an explicit px height on .enemy-visual to make up the difference. Plain CSS
  // stretch/flex-grow can't do this without either leaving a gap after the log panel or letting
  // the log panel's own height depend on its (scrollable, unbounded) content again.
  function syncEnemyVisualHeight() {
    if (isStackedBattleLayout()) {
      el.enemyVisual.style.height = ""; // stacked single-column layout: nothing to match
      return;
    }
    const panel = el.enemyVisual.parentElement;
    const otherContentHeight = panel.scrollHeight - el.enemyVisual.offsetHeight;
    const targetTotal = el.battleSide.getBoundingClientRect().height;
    el.enemyVisual.style.height = Math.max(160, targetTotal - otherContentHeight) + "px";
  }
  window.addEventListener("resize", () => {
    if (document.getElementById("screen-battle").classList.contains("active")) syncEnemyVisualHeight();
  });

  // ---------------- Render: home ----------------
  function renderHome() {
    el.bestFloorLabel.textContent = save.bestFloor > 0 ? save.bestFloor : "-";
    el.homePointsLabel.textContent = fmt(save.points);
    el.homeTranscendStat.style.display = save.transcendUnlocked ? "inline" : "none";
    el.homeTranscendLabel.textContent = fmt(save.transcendPoints);
    el.openPanelBtn.style.display = save.transcendUnlocked ? "block" : "none";
    el.openCardShopBtn.style.display = cardShopUnlocked() ? "block" : "none";
  }

  el.openFloorSelectBtn.addEventListener("click", () => { showScreen("floorSelect"); renderFloorSelect(); });
  el.resetProgressBtn.addEventListener("click", () => {
    if (!confirm("進行状況を全てリセットします。所持カード・強化・転生ポイントなど全てのセーブデータが消え、元に戻せません。よろしいですか?")) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
  el.floorSelectBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  el.openTreeBtn.addEventListener("click", () => { showScreen("tree"); renderTree(); centerTreeOnRoot(); });
  el.treeBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  el.openDeckUpgradeBtn.addEventListener("click", () => { showScreen("deckUpgrade"); renderDeckZone(); });
  el.deckUpgradeBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  el.openCardShopBtn.addEventListener("click", () => { showScreen("cardShop"); renderCardShop(); });
  el.cardShopBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  el.openPanelBtn.addEventListener("click", () => { reincarnateNow(); });

  // reincarnation panel: permanent, paid with transcend points, never reset by reincarnation.
  // rendered as several long branches radiating from the core (same visual language as the basic
  // tree); the center "核" is the only way out of this screen — clicking it proceeds to the next
  // loop (title screen).
  function panelChainNodeState(cat, tier) {
    const level = panelLevel(cat);
    if (level >= tier) return "unlocked";
    if (level < tier - 1) return "locked"; // previous tier in this chain not owned yet
    return save.transcendPoints >= panelTierCost(cat, tier) ? "available" : "unaffordable";
  }
  function panelSpecialState(special) {
    if (panelSpecialOwned(special)) return "unlocked";
    if (special.requires && !save.panelSpecials[special.requires]) return "locked";
    return save.transcendPoints >= special.cost ? "available" : "unaffordable";
  }

  function renderPanel() {
    el.panelPointsLabel.textContent = fmt(save.transcendPoints);
    el.panelMap.innerHTML = "";

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "tree-map-svg");
    svg.setAttribute("viewBox", `0 0 ${PANEL_CANVAS_WIDTH} ${PANEL_CANVAS_HEIGHT}`);

    PANEL_CATEGORIES.forEach((cat) => {
      cat.nodeIds.forEach((id, i) => {
        const from = i === 0 ? PANEL_POS.core : PANEL_POS[cat.nodeIds[i - 1]];
        const to = PANEL_POS[id];
        const line = document.createElementNS(svgNS, "line");
        line.setAttribute("x1", from.x);
        line.setAttribute("y1", from.y);
        line.setAttribute("x2", to.x);
        line.setAttribute("y2", to.y);
        if (panelLevel(cat) >= i + 1) line.setAttribute("class", "active");
        svg.appendChild(line);
      });
    });
    PANEL_SPECIALS.forEach((special, i) => {
      const from = i === 0 ? PANEL_POS.core : PANEL_POS[PANEL_SPECIALS[i - 1].id];
      const to = PANEL_POS[special.id];
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", from.x);
      line.setAttribute("y1", from.y);
      line.setAttribute("x2", to.x);
      line.setAttribute("y2", to.y);
      if (panelSpecialOwned(special)) line.setAttribute("class", "active");
      svg.appendChild(line);
    });
    PANEL_SHOP_CHAIN.nodeIds.forEach((id, i) => {
      const from = i === 0 ? PANEL_POS.core : PANEL_POS[PANEL_SHOP_CHAIN.nodeIds[i - 1]];
      const to = PANEL_POS[id];
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", from.x);
      line.setAttribute("y1", from.y);
      line.setAttribute("x2", to.x);
      line.setAttribute("y2", to.y);
      if (shopUnlockedCount() >= i + 1) line.setAttribute("class", "active");
      svg.appendChild(line);
    });
    // spider-web rings: curved (quadratic-bezier) arcs between branches at the same tier, bowed
    // outward through the point on their shared circle, so they read as actual curved web rings
    // rather than a straight polygon — drawn behind everything else
    panelWebStrands().forEach((strand) => {
      const midX = (strand.a.x + strand.b.x) / 2;
      const midY = (strand.a.y + strand.b.y) / 2;
      const midDist = Math.hypot(midX, midY) || 1;
      const radius = Math.hypot(strand.a.x, strand.a.y); // both ends share this tier's radius from the core
      const bow = radius / midDist;
      const cx = midX * bow;
      const cy = midY * bow;
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", `M ${strand.a.x} ${strand.a.y} Q ${cx} ${cy} ${strand.b.x} ${strand.b.y}`);
      path.setAttribute("class", "web-strand" + (strand.active ? " active" : ""));
      svg.insertBefore(path, svg.firstChild);
    });
    el.panelMap.appendChild(svg);

    const coreDiv = document.createElement("div");
    coreDiv.className = "tree-map-node core";
    coreDiv.style.left = PANEL_POS.core.x + "px";
    coreDiv.style.top = PANEL_POS.core.y + "px";
    coreDiv.innerHTML = `<div>核</div><div class="core-sub">次の周回へ</div>`;
    coreDiv.addEventListener("click", () => { showScreen("home"); renderHome(); });
    el.panelMap.appendChild(coreDiv);

    PANEL_CATEGORIES.forEach((cat) => {
      cat.nodeIds.forEach((id, i) => {
        const tier = i + 1;
        const pos = PANEL_POS[id];
        const state = panelChainNodeState(cat, tier);
        const div = document.createElement("div");
        div.className = "tree-map-node " + state;
        div.style.left = pos.x + "px";
        div.style.top = pos.y + "px";
        const costLabel = state === "unlocked" ? "習得済み" : `${fmt(panelTierCost(cat, tier))}pt`;
        div.innerHTML = `<div class="tn-name">${cat.label} ${tier}</div><div class="tn-desc">${cat.desc} +${fmtMult(panelTierAmount(cat, tier))}</div><div class="tn-cost">${costLabel}</div>`;
        if (state === "available") {
          div.addEventListener("click", () => {
            if (panelChainNodeState(cat, tier) !== "available") return;
            save.transcendPoints -= panelTierCost(cat, tier);
            save.panelLevels[cat.id] = tier;
            persistSave();
            renderPanel();
          });
        }
        el.panelMap.appendChild(div);
      });
    });

    PANEL_SPECIALS.forEach((special) => {
      const pos = PANEL_POS[special.id];
      const state = panelSpecialState(special);
      const div = document.createElement("div");
      div.className = "tree-map-node panel-special " + state;
      div.style.left = pos.x + "px";
      div.style.top = pos.y + "px";
      const costLabel = state === "unlocked" ? "習得済み" : `${fmt(special.cost)}pt`;
      div.innerHTML = `<div class="tn-name">${special.label}</div><div class="tn-desc">${special.desc}</div><div class="tn-cost">${costLabel}</div>`;
      if (state === "available") {
        div.addEventListener("click", () => {
          if (panelSpecialState(special) !== "available") return;
          save.transcendPoints -= special.cost;
          save.panelSpecials[special.id] = true;
          persistSave();
          renderPanel();
        });
      }
      el.panelMap.appendChild(div);
    });

    PANEL_SHOP_CHAIN.nodeIds.forEach((id, i) => {
      const tier = i + 1;
      const pos = PANEL_POS[id];
      const state = panelChainNodeState(PANEL_SHOP_CHAIN, tier);
      const div = document.createElement("div");
      div.className = "tree-map-node " + state;
      div.style.left = pos.x + "px";
      div.style.top = pos.y + "px";
      const costLabel = state === "unlocked" ? "習得済み" : `${fmt(panelTierCost(PANEL_SHOP_CHAIN, tier))}pt`;
      const unlockedItem = CARD_SHOP_POOL[tier - 1];
      const desc = tier === 1 ? `カードショップを解放` : `「${unlockedItem.name}」販売開始`;
      div.innerHTML = `<div class="tn-name">${PANEL_SHOP_CHAIN.label} ${tier}</div><div class="tn-desc">${desc}</div><div class="tn-cost">${costLabel}</div>`;
      if (state === "available") {
        div.addEventListener("click", () => {
          if (panelChainNodeState(PANEL_SHOP_CHAIN, tier) !== "available") return;
          save.transcendPoints -= panelTierCost(PANEL_SHOP_CHAIN, tier);
          save.panelLevels[PANEL_SHOP_CHAIN.id] = tier;
          persistSave();
          renderPanel();
        });
      }
      el.panelMap.appendChild(div);
    });
  }

  function renderFloorSelect() {
    el.floorSelectGrid.innerHTML = "";
    FLOOR_CHECKPOINTS.forEach((floor) => {
      const isBoss = floor === FINAL_FLOOR;
      const div = document.createElement("div");
      div.className = "floor-select-card" + (isBoss ? " boss" : "");
      const hpPreview = fmt(computeFloorHp(floor));
      div.innerHTML = `
        <div class="fs-floor${isBoss ? " boss" : ""}">${isBoss ? "ラスボス" : floor + "階"}</div>
        <div class="fs-hp">HP ${hpPreview}</div>
      `;
      div.addEventListener("click", () => newRun(floor));
      el.floorSelectGrid.appendChild(div);
    });
  }

  // ---------------- Drag-to-pan (shared by the basic tree and the reincarnation panel) ----------------
  function setupDragPan(wrap) {
    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    const DRAG_THRESHOLD = 5;

    function pointerDown(x, y) {
      dragging = true;
      moved = false;
      startX = x;
      startY = y;
      startLeft = wrap.scrollLeft;
      startTop = wrap.scrollTop;
      wrap.classList.add("dragging");
    }
    function pointerMove(x, y, evt) {
      if (!dragging) return;
      const dx = x - startX;
      const dy = y - startY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) moved = true;
      if (moved) {
        if (evt && evt.cancelable) evt.preventDefault();
        wrap.scrollLeft = startLeft - dx;
        wrap.scrollTop = startTop - dy;
      }
    }
    function pointerUp() {
      dragging = false;
      wrap.classList.remove("dragging");
    }

    wrap.addEventListener("mousedown", (e) => { pointerDown(e.pageX, e.pageY); });
    window.addEventListener("mousemove", (e) => pointerMove(e.pageX, e.pageY, e));
    window.addEventListener("mouseup", pointerUp);

    wrap.addEventListener("touchstart", (e) => {
      // a second finger means this is a pinch (see setupPinchZoom), not a pan
      if (e.touches.length > 1) { dragging = false; moved = true; wrap.classList.remove("dragging"); return; }
      const t = e.touches[0];
      pointerDown(t.pageX, t.pageY);
    }, { passive: true });
    wrap.addEventListener("touchmove", (e) => {
      if (e.touches.length > 1) { dragging = false; return; }
      const t = e.touches[0];
      pointerMove(t.pageX, t.pageY, e);
    }, { passive: false });
    wrap.addEventListener("touchend", pointerUp);
    wrap.addEventListener("touchcancel", pointerUp);

    // if the gesture was a drag (not a tap/click), swallow the click so it doesn't
    // also trigger whatever node button happens to be under the cursor on release.
    wrap.addEventListener("click", (e) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }
  setupDragPan(el.treeScrollWrap);
  setupDragPan(el.panelScrollWrap);

  // ---------------- Pinch-to-zoom (touch equivalent of the wheel handlers below) ----------------
  // a phone has no wheel event, so without this the maps are stuck at whatever zoom they open at.
  // applyZoom(z) is the caller's "clamp, store and re-render at this zoom" step; this keeps the
  // point between the two fingers pinned in place, exactly like the wheel handlers keep the cursor.
  function setupPinchZoom(wrap, getZoom, applyZoom) {
    let pinching = false;
    let startDist = 0, startZoom = 1;
    const spread = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    wrap.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 2) return;
      pinching = true;
      startDist = spread(e.touches);
      startZoom = getZoom();
    }, { passive: true });

    wrap.addEventListener("touchmove", (e) => {
      if (!pinching || e.touches.length !== 2 || startDist === 0) return;
      if (e.cancelable) e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      // the content point currently between the fingers, in unscaled map coordinates
      const zoom = getZoom();
      const contentX = (wrap.scrollLeft + midX) / zoom;
      const contentY = (wrap.scrollTop + midY) / zoom;

      const next = applyZoom(startZoom * (spread(e.touches) / startDist));
      wrap.scrollLeft = contentX * next - midX;
      wrap.scrollTop = contentY * next - midY;
    }, { passive: false });

    const endPinch = (e) => { if (e.touches.length < 2) pinching = false; };
    wrap.addEventListener("touchend", endPinch);
    wrap.addEventListener("touchcancel", endPinch);
  }

  // the maps open zoomed in enough to read a node on a desktop monitor; at phone width that same
  // zoom shows barely two nodes, so narrow screens open further out and pinch in from there
  const narrowScreen = window.matchMedia("(max-width: 640px)");

  // ---------------- Zooming the skill tree (wheel on desktop, pinch on touch) ----------------
  const TREE_ZOOM_MIN = 0.35;
  const TREE_ZOOM_MAX = 2;
  const TREE_OPEN_ZOOM = 1.6; // opening the screen starts zoomed in on the origin, not showing a corner of the map
  const TREE_OPEN_ZOOM_NARROW = 0.8; // phone width: 1.6 leaves barely two nodes on screen
  let treeZoom = 1;

  function applyTreeZoom() {
    el.treeMap.style.width = TREE_CANVAS_WIDTH + "px";
    el.treeMap.style.height = TREE_CANVAS_HEIGHT + "px";
    el.treeMap.style.transform = `scale(${treeZoom})`;
    el.treeMapScaler.style.width = (TREE_CANVAS_WIDTH * treeZoom) + "px";
    el.treeMapScaler.style.height = (TREE_CANVAS_HEIGHT * treeZoom) + "px";
  }
  applyTreeZoom();

  // center the view on the root node at a strong zoom level; used whenever the tree screen opens
  function centerTreeOnRoot() {
    treeZoom = narrowScreen.matches ? TREE_OPEN_ZOOM_NARROW : TREE_OPEN_ZOOM;
    applyTreeZoom();
    const wrap = el.treeScrollWrap;
    wrap.scrollLeft = ROOT.x * treeZoom - wrap.clientWidth / 2;
    wrap.scrollTop = ROOT.y * treeZoom - wrap.clientHeight / 2;
  }

  // clamp, store and re-render at the requested zoom; returns the zoom actually applied so the
  // caller can re-anchor its scroll against it. Shared by the wheel and pinch handlers.
  function setTreeZoom(z) {
    treeZoom = Math.min(TREE_ZOOM_MAX, Math.max(TREE_ZOOM_MIN, z));
    applyTreeZoom();
    return treeZoom;
  }

  el.treeScrollWrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const wrap = el.treeScrollWrap;
    const rect = wrap.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    // the content point currently under the cursor, in unscaled tree coordinates
    const contentX = (wrap.scrollLeft + cursorX) / treeZoom;
    const contentY = (wrap.scrollTop + cursorY) / treeZoom;

    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setTreeZoom(treeZoom * factor);

    // re-anchor scroll so the same content point stays under the cursor
    wrap.scrollLeft = contentX * treeZoom - cursorX;
    wrap.scrollTop = contentY * treeZoom - cursorY;
  }, { passive: false });

  setupPinchZoom(el.treeScrollWrap, () => treeZoom, setTreeZoom);

  // ---------------- Zooming the reincarnation panel (wheel on desktop, pinch on touch) ----------------
  const PANEL_ZOOM_MIN = 0.3;
  const PANEL_ZOOM_MAX = 1.5;
  const PANEL_OPEN_ZOOM = 0.85; // the panel is much bigger now; open a bit zoomed out so several branches are visible at once
  const PANEL_OPEN_ZOOM_NARROW = 0.45; // phone width: open far enough out to see the core and its spokes
  let panelZoom = 1;

  function applyPanelZoom() {
    el.panelMap.style.width = PANEL_CANVAS_WIDTH + "px";
    el.panelMap.style.height = PANEL_CANVAS_HEIGHT + "px";
    el.panelMap.style.transform = `scale(${panelZoom})`;
    el.panelMapScaler.style.width = (PANEL_CANVAS_WIDTH * panelZoom) + "px";
    el.panelMapScaler.style.height = (PANEL_CANVAS_HEIGHT * panelZoom) + "px";
  }
  applyPanelZoom();

  // center the view on the core at a slightly zoomed-out level; used whenever the panel opens
  function centerPanelOnCore() {
    panelZoom = narrowScreen.matches ? PANEL_OPEN_ZOOM_NARROW : PANEL_OPEN_ZOOM;
    applyPanelZoom();
    const wrap = el.panelScrollWrap;
    wrap.scrollLeft = PANEL_POS.core.x * panelZoom - wrap.clientWidth / 2;
    wrap.scrollTop = PANEL_POS.core.y * panelZoom - wrap.clientHeight / 2;
  }

  function setPanelZoom(z) {
    panelZoom = Math.min(PANEL_ZOOM_MAX, Math.max(PANEL_ZOOM_MIN, z));
    applyPanelZoom();
    return panelZoom;
  }

  el.panelScrollWrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const wrap = el.panelScrollWrap;
    const rect = wrap.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const contentX = (wrap.scrollLeft + cursorX) / panelZoom;
    const contentY = (wrap.scrollTop + cursorY) / panelZoom;

    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setPanelZoom(panelZoom * factor);

    wrap.scrollLeft = contentX * panelZoom - cursorX;
    wrap.scrollTop = contentY * panelZoom - cursorY;
  }, { passive: false });

  setupPinchZoom(el.panelScrollWrap, () => panelZoom, setPanelZoom);

  // ---------------- Render: level-up tree ----------------
  function nodeState(node) {
    if (save.unlockedNodes[node.id]) return "unlocked";
    const prereqOk = node.requires === null || save.unlockedNodes[node.requires];
    if (!prereqOk) return "locked";
    return save.points >= node.cost ? "available" : "unaffordable";
  }

  function renderTree() {
    el.treePointsLabel.textContent = fmt(save.points);
    el.treeMap.innerHTML = "";

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "tree-map-svg");
    svg.setAttribute("viewBox", `0 0 ${TREE_CANVAS_WIDTH} ${TREE_CANVAS_HEIGHT}`);

    NODES.forEach((node) => {
      const fromId = node.requires || "root";
      const from = TREE_POS[fromId];
      const to = TREE_POS[node.id];
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", from.x);
      line.setAttribute("y1", from.y);
      line.setAttribute("x2", to.x);
      line.setAttribute("y2", to.y);
      if (save.unlockedNodes[node.id]) line.setAttribute("class", "active");
      svg.appendChild(line);
    });
    el.treeMap.appendChild(svg);

    const rootPos = TREE_POS.root;
    const rootDiv = document.createElement("div");
    rootDiv.className = "tree-map-node root";
    rootDiv.style.left = rootPos.x + "px";
    rootDiv.style.top = rootPos.y + "px";
    rootDiv.textContent = "起点";
    el.treeMap.appendChild(rootDiv);

    NODES.forEach((node) => {
      const pos = TREE_POS[node.id];
      const state = nodeState(node);
      const div = document.createElement("div");
      div.className = "tree-map-node " + state;
      div.style.left = pos.x + "px";
      div.style.top = pos.y + "px";
      const costLabel = state === "unlocked" ? "習得済み" : `${node.cost}pt`;
      div.innerHTML = `<div class="tn-name">${node.label}</div><div class="tn-desc">${node.desc}</div><div class="tn-cost">${costLabel}</div>`;
      if (state === "available") {
        div.addEventListener("click", () => {
          save.points -= node.cost;
          save.unlockedNodes[node.id] = true;
          // startCards nodes grant their cards to the permanent deck once, right here at
          // purchase time (not re-applied every run), so they're real deck members that can
          // later be ranked up / deleted from the title-screen deck upgrade screen too.
          if (node.kind === "startCards") {
            node.cards.forEach((c) => addCardToDeckDefs(save.deckDefs, c));
          }
          persistSave();
          renderTree();
        });
      }
      el.treeMap.appendChild(div);
    });
  }

  // ---------------- Dev console ----------------
  // re-renders whichever screen happens to be open, so a value changed from the console shows up
  // straight away instead of only after navigating somewhere else and back
  function refreshActiveScreen() {
    const renderers = {
      "screen-home": renderHome,
      "screen-tree": renderTree,
      "screen-deckUpgrade": renderDeckZone,
      "screen-cardShop": renderCardShop,
      "screen-panel": renderPanel,
    };
    const active = document.querySelector(".screen.active");
    const render = active && renderers[active.id];
    if (render) render();
  }

  function writePoints(n) {
    const value = Number(n);
    if (!Number.isFinite(value)) {
      console.warn("[mt] 数値を渡してください。例: mt.points = 9999");
      return save.points;
    }
    save.points = Math.max(0, Math.floor(value));
    persistSave();
    refreshActiveScreen();
    console.info("[mt] レベルアップポイント =", fmt(save.points));
    return save.points;
  }

  if (DEV_CONSOLE) {
    window.mt = {
      // `mt.points` reads, `mt.points = 500` writes -- an accessor rather than a plain field so
      // the assignment itself persists the save and repaints, which is how you'd expect it to work
      // when poking at it from devtools
      get points() { return save.points; },
      set points(n) { writePoints(n); },
      setPoints(n) { return writePoints(n); },
      addPoints(n) { return writePoints(save.points + Number(n || 0)); },
      help() {
        console.info(
          [
            "マギア・タワー デバッグコンソール",
            "  mt.points            現在のレベルアップポイントを表示",
            "  mt.points = 9999     レベルアップポイントを設定",
            "  mt.addPoints(500)    レベルアップポイントを加算（マイナスで減算）",
            "  mt.setPoints(0)      mt.points = 0 と同じ",
            "",
            "変更は即座にセーブされ、開いている画面にも反映されます。",
          ].join("\n")
        );
      },
    };
    console.info("[mt] デバッグコンソール有効。使い方は mt.help()");
  }

  // ---------------- Init ----------------
  showScreen("home");
  renderHome();
})();
