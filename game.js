(function () {
  const STORAGE_KEY = "magiaTower.save.v2";
  const BASE_ENEMY_HP = 100;
  const BASE_ATK = 3;
  const BASE_N = 5;
  const BASE_HAND = 5;
  const FINAL_FLOOR = 100;
  // deleting/benching can never shrink the battle deck below this. At 4 the deck was smaller than the
  // hand, so a played card came straight back and one buff/処刑の火 could be replayed every move.
  const MIN_DECK_SIZE = 9;
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

  // the tree's single entry point: cheap (1pt) on purpose so it's never really a paywall, and it
  // refunds more than it costs (+5pt) -- its real job is just gating the three trunks below so a
  // brand new save shows one clear first step instead of three branches all competing for
  // attention at once. Not part of any buildChain() lineage since it has no "previous" node.
  const ROOT_NODE = {
    id: "root", branch: "root", tier: 0, requires: null,
    label: "起点", desc: "基本強化を開放。ソウル+5",
    cost: 1, kind: "grantPoints", pointsGrant: 5,
  };

  const ATK_TRUNK = buildChain("atk", "atk", 1, "root", [
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
    { label: "終末の力", desc: "基礎攻撃力 +512・累乗 +0.25", cost: 2400, effect: { atk: 512, exponent: 0.25 } },
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
    { label: "神域への到達", desc: "累乗 +0.25", cost: 3000, effect: { exponent: 0.25 } },
  ]);

  const N_TRUNK = buildChain("n", "n", 1, "root", [
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
  // fork 2: critical damage, growing toward the tip (total +225%; critDamageBonus() clamps the tree's
  // share at TREE_CRIT_DAMAGE_CAP defensively)
  const N_CRITDMG = buildChain("nDmg", "n", 3, N_FORK_ROOT, [
    { label: "会心撃の重み", desc: "会心ダメージ +25%", cost: 120, effect: { critDamage: 25 } },
    { label: "会心撃の激化", desc: "会心ダメージ +40%", cost: 260, effect: { critDamage: 40 } },
    { label: "会心撃の暴威", desc: "会心ダメージ +60%", cost: 540, effect: { critDamage: 60 } },
    { label: "会心撃の極致", desc: "会心ダメージ +100%", cost: 1100, effect: { critDamage: 100 } },
  ]);
  // fork 3: a final damage multiplier applied outside (baseMult + Σ buff)^exponent. As +baseMult it was
  // swallowed by the buff sum (≈+2%). Keeps the old "nHand" id prefix so saves carry over in place.
  const N_MULT = buildChain("nHand", "n", 3, N_FORK_ROOT, [
    { label: "闘気の芽生え", desc: "ダメージ ×1.1", cost: 100, effect: { finalMult: 0.1 } },
    { label: "闘気の昂り", desc: "ダメージ ×1.2", cost: 220, effect: { finalMult: 0.2 } },
    { label: "闘気の奔流", desc: "ダメージ ×1.3", cost: 460, effect: { finalMult: 0.3 } },
    { label: "闘気の極致", desc: "ダメージ ×1.75", cost: 950, effect: { finalMult: 0.75 } },
    { label: "大器の魂", desc: "初期手札 +1。「渾身の一撃」を追加", cost: 2000, effect: { hand: 1 }, kind: "startCards", cards: [{ type: "special", name: "渾身の一撃", calc: "n" }] },
  ]);

  const GOLD_TRUNK = buildChain("gold", "gold", 1, "root", [
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
  // fork 2: shop utility. Costs belong to the position in the chain (15/130/280/600/1200), so the
  // nodes pushed one step deeper by 自動購入開放 got pricier; the last one is set separately.
  const GOLD_SHOP = buildChain("goldS", "gold", 3, GOLD_FORK_ROOT, [
    { label: "取引の極意", desc: "初回リロール無料", cost: 15, effect: { freeReroll: 1 } },
    { label: "自動購入開放", desc: "商人で自動購入（全部買う→リロール）が使える", cost: 130, kind: "autoBuy" },
    { label: "経済の秘伝", desc: "強化コスト上昇が緩和(×2→×1.5)", cost: 280, kind: "cheapUpgrade" },
    { label: "商人の信頼", desc: "商人の提案+1件", cost: 600, effect: { shopSlots: 1 } },
    { label: "無限の交渉", desc: "無料リロール +1", cost: 1200, effect: { freeReroll: 1 } },
    { label: "商会の盟主", desc: "商人の提案+1件", cost: 1500, effect: { shopSlots: 1 } },
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
    [ROOT_NODE],
    ATK_TRUNK, ATK_POWER, ATK_ARSENAL, ATK_FLAME,
    N_TRUNK, N_CRIT, N_CRITDMG, N_MULT,
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
  Object.assign(TREE_POS, spiralChain(N_MULT.map((n) => n.id), N_TRUNK_END, N_TRUNK_END_ANGLE + FORK_SPREAD, FORK_CURL, FORK_STEP, FORK_STEP));

  // each of the atk/gold trunks forks again into 3 further directions, spiraling apart around its own angle
  Object.assign(TREE_POS, spiralChain(ATK_POWER.map((n) => n.id), ATK_TRUNK_END, ATK_TRUNK_END_ANGLE - FORK_SPREAD, -FORK_CURL, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(ATK_ARSENAL.map((n) => n.id), ATK_TRUNK_END, ATK_TRUNK_END_ANGLE, FORK_CURL * 0.4, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(ATK_FLAME.map((n) => n.id), ATK_TRUNK_END, ATK_TRUNK_END_ANGLE + FORK_SPREAD, FORK_CURL, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(GOLD_SHOP.map((n) => n.id), GOLD_TRUNK_END, GOLD_TRUNK_END_ANGLE - FORK_SPREAD, -FORK_CURL, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(GOLD_ECON.map((n) => n.id), GOLD_TRUNK_END, GOLD_TRUNK_END_ANGLE, FORK_CURL * 0.4, FORK_STEP, FORK_STEP));
  // half the usual curl: at full curl this fork's tip (王家の後ろ盾) swung up into the atk branch's
  // tip (終末の力) and the two nodes drew on top of each other
  Object.assign(TREE_POS, spiralChain(GOLD_FORTUNE.map((n) => n.id), GOLD_TRUNK_END, GOLD_TRUNK_END_ANGLE + FORK_SPREAD, FORK_CURL * 0.5, FORK_STEP, FORK_STEP));

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
      cardShopPurchases: {}, // card shop item id -> times bought since the last reincarnation (drives its rising price)
      bestClearedFloor: 0, // highest floor actually beaten (bestFloor also counts the floor you lost on); gates shop potions
      autoBuyEnabled: false, // merchant auto-buy runs on its own every floor clear (once 自動購入開放 is bought)
      level: 1, exp: new Decimal(0), // player level: earned from kills, kept across runs, reset by reincarnation
      achievements: {}, // achievement id -> true; never reset by reincarnation
      stats: {}, // lifetime counters the achievements read (maxHit, kills, runs, …); never reset
      remnantDecks: [], // one deck (array of card defs) per summoned remnant; never reset
      remnantTree: {}, // remnant skill tree node id -> true; shared by all remnants, never reset
      lastSeen: 0, // ms timestamp of the last time the game was open (offline remnant income)
      activeTrials: [], // ids of the 苦難 being attempted together this loop (one per direction); see TRIALS
      trialComboBest: 0, // most 苦難 ever beaten at once (each new record 2…8 adds its 同時挑戦ボーナス)
      trialPending: false, // set by reincarnating: the 苦難 screen comes up once the panel is left
      trialsCleared: {}, // 苦難 id -> true once beaten (its reward is permanent)
      treeExt: {}, // 拡張強化 id -> level; bought with souls, reset by reincarnation like the basic tree
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
        cardShopPurchases: Object.assign({}, parsed.cardShopPurchases || {}),
        achievements: Object.assign({}, parsed.achievements || {}),
        stats: Object.assign({}, parsed.stats || {}),
        remnantTree: Object.assign({}, parsed.remnantTree || {}),
        treeExt: Object.assign({}, parsed.treeExt || {}),
        trialsCleared: Object.assign({}, parsed.trialsCleared || {}),
        remnantDecks: Array.isArray(parsed.remnantDecks) ? parsed.remnantDecks : [],
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
      enforceMinDeck(merged.deckDefs);
      // big numbers are saved as strings (Decimal#toJSON); older saves have plain numbers, or null
      // where an overflowed Infinity was written
      merged.exp = toDecimal(merged.exp);
      // a single 苦難 used to be stored as activeTrial
      if (!Array.isArray(merged.activeTrials)) merged.activeTrials = [];
      if (typeof merged.activeTrial === "string" && !merged.activeTrials.length) merged.activeTrials = [merged.activeTrial];
      delete merged.activeTrial;
      merged.stats.maxHit = toDecimal(merged.stats.maxHit);
      return merged;
    } catch (e) {
      return defaultSave();
    }
  }
  function toDecimal(v) {
    try {
      const d = new Decimal(v == null ? 0 : v);
      return Number.isFinite(d.mantissa) && Number.isFinite(d.exponent) ? d : new Decimal(0);
    } catch (e) { return new Decimal(0); }
  }
  // set while a reset is wiping the save: the reload fires pagehide, and persistSave() would write the
  // in-memory save straight back, so the reset would silently do nothing
  let wipingSave = false;
  function persistSave() {
    if (wipingSave) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
  }

  let save = loadSave();
  let cardUid = 0;
  let game = null;

  // 苦難「束縛」scales the numeric tree effects (and its reward boosts the tree's atk); counts like hand
  // size and shop slots are never scaled
  const TRIAL_SCALED_TREE_KEYS = ["atk", "critRate", "critDamage", "goldPct", "exponent"];
  function treeBonus(key) {
    let total = 0;
    NODES.forEach((node) => {
      if (save.unlockedNodes[node.id] && node.effect && node.effect[key]) total += node.effect[key];
    });
    if (TRIAL_SCALED_TREE_KEYS.includes(key)) total *= trialRule("treeMult", 1);
    if (key === "atk") total *= trialRule("treeAtkMult", 1) * trialRewardProduct("treeAtk");
    return total;
  }

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
    { id: "extAtk", label: "魂の鍛錬", unit: "攻撃力 +{v}%", key: "atkPct", perLevel: 10, baseCost: 3000, growth: 1.35 },
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
  // ---------------- 苦難 (trials) ----------------
  // after a reincarnation the player may pick one unlocked 苦難 for the coming loop. Every 苦難 seals the
  // whole reincarnation panel (bonuses, specials, remnants, card shop, 拡張強化) on top of its own rules,
  // so even the easiest one turns "fresh start -> final boss" back into a real climb. Killing the 100F
  // boss while it's active grants its permanent reward (once per 苦難). Rewards are never sealed.
  // 8 directions of restriction, each with 3 levels (★ → ★★★). Level k of every direction opens with
  // tier k of 苦難の門, and also needs level k-1 of that same direction beaten first.
  const TRIAL_CATEGORIES = [
    { id: "hp", name: "堅牢", theme: "敵が硬くなる", levels: [
      { rules: { hpMult: 5 }, reward: { dmgMult: 2 }, rewardText: "全ダメージ ×2" },
      { rules: { hpMult: 100 }, reward: { dmgMult: 5 }, rewardText: "全ダメージ ×5" },
      { rules: { hpMult: 10000 }, reward: { dmgMult: 20 }, rewardText: "全ダメージ ×20" },
    ] },
    { id: "atk", name: "鈍刃", theme: "攻撃力が下がる", levels: [
      { rules: { atkMult: 0.5 }, reward: { exponent: 0.05 }, rewardText: "累乗 +0.05" },
      { rules: { atkMult: 0.2 }, reward: { exponent: 0.1 }, rewardText: "累乗 +0.1" },
      { rules: { atkMult: 0.05 }, reward: { exponent: 0.2 }, rewardText: "累乗 +0.2" },
    ] },
    { id: "moves", name: "刹那", theme: "手数・手札が減る", levels: [
      { rules: { nDelta: -1 }, reward: { handDelta: 1 }, rewardText: "初期手札 +1" },
      { rules: { nDelta: -2 }, reward: { n: 1 }, rewardText: "手数 +1" },
      { rules: { nDelta: -2, handDelta: -2 }, reward: { n: 1, handDelta: 1 }, rewardText: "手数 +1・初期手札 +1" },
    ] },
    { id: "crit", name: "無明", theme: "会心が封じられる", levels: [
      { rules: { critRateMult: 0.5 }, reward: { critMult: 1.5 }, rewardText: "会心倍率 ×1.5" },
      { rules: { noCrit: true }, reward: { critMult: 2 }, rewardText: "会心倍率 ×2" },
      { rules: { noCrit: true, hpMult: 10 }, reward: { critMult: 3 }, rewardText: "会心倍率 ×3" },
    ] },
    { id: "econ", name: "飢餓", theme: "お金とソウルが減る", levels: [
      { rules: { goldMult: 0.5 }, reward: { soulMult: 1.5 }, rewardText: "ソウル獲得 ×1.5" },
      { rules: { goldMult: 0.25, soulMult: 0.5 }, reward: { soulMult: 2 }, rewardText: "ソウル獲得 ×2" },
      { rules: { goldMult: 0.1, soulMult: 0.2, noShop: true }, reward: { soulMult: 3, transcendMult: 2 }, rewardText: "ソウル獲得 ×3・転生ポイント獲得 ×2" },
    ] },
    { id: "exp", name: "忘却", theme: "成長が鈍る", levels: [
      { rules: { expMult: 0.5 }, reward: { expMult: 2 }, rewardText: "経験値 ×2" },
      { rules: { expMult: 0.1 }, reward: { expMult: 5 }, rewardText: "経験値 ×5" },
      { rules: { noLevel: true }, reward: { atkPct: 300 }, rewardText: "攻撃力 +300%" },
    ] },
    { id: "deck", name: "枯渇", theme: "カードが弱る", levels: [
      { rules: { buffScale: 0.5 }, reward: { buffAdd: 0.5 }, rewardText: "バフカードの倍率 +0.5" },
      { rules: { noRank: true }, reward: { rankMult: 1.5 }, rewardText: "カード強化（ランク）の効果 ×1.5" },
      { rules: { noRank: true, buffScale: 0.5, handDelta: -1 }, reward: { buffAdd: 1 }, rewardText: "バフカードの倍率 +1" },
    ] },
    { id: "tree", name: "束縛", theme: "基本強化が封じられる", levels: [
      { rules: { noFinalMult: true }, reward: { dmgMult: 1.5 }, rewardText: "全ダメージ ×1.5" },
      { rules: { treeAtkMult: 0.25 }, reward: { treeAtk: 3 }, rewardText: "基本強化の攻撃力 ×3" },
      { rules: { treeMult: 0.5, noFinalMult: true }, reward: { exponent: 0.25 }, rewardText: "累乗 +0.25" },
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
    if (r.hpMult) out.push(`敵のHP ×${fmt(r.hpMult)}`);
    if (r.atkMult) out.push(`攻撃力 ×${r.atkMult}`);
    if (r.nDelta) out.push(`手数 ${r.nDelta}`);
    if (r.handDelta) out.push(`初期手札 ${r.handDelta}`);
    if (r.critRateMult) out.push(`会心率 ×${r.critRateMult}`);
    if (r.noCrit) out.push("会心が出ない");
    if (r.goldMult) out.push(`獲得ゴールド ×${r.goldMult}`);
    if (r.soulMult) out.push(`獲得ソウル ×${r.soulMult}`);
    if (r.noShop) out.push("商人が何も売らない");
    if (r.expMult) out.push(`獲得経験値 ×${r.expMult}`);
    if (r.noLevel) out.push("レベルによる攻撃力・会心ダメージが無効");
    if (r.buffScale) out.push(`バフカードの上乗せ ×${r.buffScale}`);
    if (r.noRank) out.push("カード強化（ランク）が無効");
    if (r.noFinalMult) out.push("闘気の枝（最終倍率）が無効");
    if (r.treeAtkMult) out.push(`基本強化の攻撃力 ×${r.treeAtkMult}`);
    if (r.treeMult) out.push(`基本強化の攻撃力・会心・累乗 ×${r.treeMult}`);
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
  // 同時挑戦ボーナス: beating k 苦難 at once for the first time (k = 2…8) adds a permanent 全ダメージ ×k
  function trialComboMult() {
    let m = 1;
    for (let k = 2; k <= (save.trialComboBest || 0); k++) m *= k;
    return m;
  }
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
  function enemyHpForFloor(floor) {
    const mult = trialRule("hpMult", 1);
    return mult === 1 ? computeFloorHp(floor) : computeFloorHp(floor).mul(mult);
  }

  // chains whose tiers unlock things (not numeric bonuses); rendered and bought the same way
  const PANEL_CHAINS = [PANEL_SHOP_CHAIN, PANEL_REMNANT_CHAIN, PANEL_TREE_EXT_CHAIN, PANEL_TRIAL_CHAIN];

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
  PANEL_CATEGORIES.forEach((cat) => {
    cat.nodeIds = [];
    for (let i = 1; i <= cat.maxLevel; i++) cat.nodeIds.push(cat.id + "_" + i);
    Object.assign(PANEL_POS, foldedArm(cat.nodeIds, cat.angle));
  });
  PANEL_CHAINS.forEach((chain) => {
    chain.nodeIds = [];
    for (let i = 1; i <= chain.maxLevel; i++) chain.nodeIds.push(chain.id + "_" + i);
    Object.assign(PANEL_POS, foldedArm(chain.nodeIds, chain.angle));
  });
  Object.assign(PANEL_POS, foldedArm(PANEL_SPECIALS.map((sp) => sp.id), panelSpokeAngle(7)));

  const PANEL_EDGE_PAD = 90;
  const { width: PANEL_CANVAS_WIDTH, height: PANEL_CANVAS_HEIGHT } = fitCanvasToPositions(PANEL_POS, PANEL_EDGE_PAD);

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
    };
    startFloor(floor);
  }

  function currentAtk() {
    const flat = BASE_ATK + treeBonus("atk") + panelBonus("atk") + game.runAtkBonus;
    return flat * (1 + (levelAtkPct() + achievementBonus("atkPct") + treeExtBonus("atkPct") + trialRewardSum("atkPct")) / 100) * trialRule("atkMult", 1);
  }
  function currentStartHand() {
    return Math.max(1, BASE_HAND + treeBonus("hand") + panelBonus("hand") + game.runHandBonus + trialRule("handDelta", 0) + trialRewardSum("handDelta"));
  }
  function currentStartN() {
    return Math.max(1, BASE_N + treeBonus("n") + panelBonus("n") + (game.runNBonus || 0) + trialRule("nDelta", 0) + trialRewardSum("n"));
  }
  function goldMultiplier() {
    return (1 + (treeBonus("goldPct") + panelBonus("goldPct") + achievementBonus("goldPct") + treeExtBonus("goldPct") + (game.runGoldPctBonus || 0)) / 100) * trialRule("goldMult", 1);
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
  // damage = (card power + atk) × (baseMult + Σ buff bonus)^exponent × crit.
  // Buffs add inside the base (so stacking them in one turn grows linearly); the exponential,
  // incremental-style growth comes from the exponent, which only rises through progression
  // (tree end nodes + the reincarnation panel), never from cards played within a turn.
  function currentBaseMult() { return 1 + treeBonus("baseMult"); }
  function currentExponent() {
    return 1 + treeBonus("exponent") + panelBonus("exponent") + treeExtBonus("exponent")
      + (panelSpecialOn("panelDmgFormula") ? 0.2 : 0) + trialRewardSum("exponent");
  }
  // applied outside the exponent: 闘気 nodes (×1.1…×1.3 each) and 魂の昇華
  function finalDamageMult() {
    let m = treeExtProduct("dmgMult") * trialRewardProduct("dmgMult");
    NODES.forEach((node) => {
      if (save.unlockedNodes[node.id] && node.effect && node.effect.finalMult && !trialRule("noFinalMult", false)) m *= 1 + node.effect.finalMult;
    });
    return m;
  }
  function damageMultiplier() {
    return Decimal.pow(Math.max(MIN_BUFF_MULTIPLIER, currentBaseMult() + game.buffBonus), currentExponent()).mul(finalDamageMult());
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
  function unbuffedDamageMultiplier() { return Decimal.pow(currentBaseMult(), currentExponent()).mul(finalDamageMult()); }

  const BASE_CRIT_MULT = 1.5;
  const TREE_CRIT_DAMAGE_CAP = 225; // the skill tree alone can never push critDamage past this
  // panel bonuses (継承の会心・会心の覚醒) are a permanent, post-transcend layer and are
  // deliberately NOT subject to the tree-only cap above
  function critRate() {
    return Math.min(100, (treeBonus("critRate") + game.runCritRateBonus + (panelSpecialOn("panelCritRateBurst") ? 40 : 0)) * trialRule("critRateMult", 1));
  }
  function critDamageBonus() {
    return Math.min(TREE_CRIT_DAMAGE_CAP, treeBonus("critDamage")) + game.runCritDamageBonus + panelBonus("critDmgAdd")
      + (trialRule("noLevel", false) ? 0 : (save.level - 1) * LEVEL_CRIT_DMG) + achievementBonus("critDmg") + treeExtBonus("critDmg");
  }
  // cardRateBonus/cardDmgBonus let an individual card (e.g. 会心撃/超会心撃) add to its own crit
  // roll and multiplier on top of the player's usual crit stats, without touching any other card
  function critMultiplier(cardDmgBonus) {
    const base = (BASE_CRIT_MULT + (critDamageBonus() + (cardDmgBonus || 0)) / 100) * treeExtProduct("critMult") * trialRewardProduct("critMult");
    return panelSpecialOn("panelCritMultDouble") ? base * 2 : base;
  }
  function rollCrit(cardRateBonus) {
    if (trialRule("noCrit", false)) return false;
    return Math.random() * 100 < critRate() + (cardRateBonus || 0);
  }

  // ---------------- Level (kept across runs, reset by reincarnation) ----------------
  // exp from a kill = enemy max HP, and each level needs ×1.2 more -- enemy HP grows ×1.1 per floor,
  // so a player gains roughly one level per two floors of new ground. All numbers are first-pass.
  const LEVEL_EXP_BASE = 50;
  const LEVEL_EXP_GROWTH = 1.2;
  const EXP_PER_ENEMY_HP = 1;
  const LEVEL_ATK_PCT = 3; // +3% atk per level above 1 -- a percent so flat atk purchases keep getting amplified
  const LEVEL_CRIT_DMG = 1; // +1% crit damage per level above 1, outside the tree's cap
  // transcend points for reincarnating = BASE × level^POWER. Was BASE × 1.1^(level−1): Lv185 paid 9.4億,
  // 213× the whole panel, so two reincarnations bought everything. Lv94 pays about the same as before.
  const TRANSCEND_BASE = 10;
  const TRANSCEND_POWER = 2;
  function expToNext(level) { return Decimal.pow(LEVEL_EXP_GROWTH, level - 1).mul(LEVEL_EXP_BASE).ceil(); }
  function expRemainingText() { return fmt(expToNext(save.level).sub(save.exp)); }
  function levelAtkPct() { return trialRule("noLevel", false) ? 0 : (save.level - 1) * LEVEL_ATK_PCT; }
  function gainExp(amount) {
    const add = new Decimal(amount);
    if (!add.gt(0)) return 0;
    save.exp = save.exp.add(add.mul((1 + achievementBonus("expPct") / 100) * trialRule("expMult", 1) * trialRewardProduct("expMult")));
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
    return Math.ceil(TRANSCEND_BASE * Math.pow(level, TRANSCEND_POWER) * (1 + panelBonusRaw("transcendGainPct") / 100) * trialRewardProduct("transcendMult") - 1e-9);
  }
  // soul income from any source goes through here so the achievement bonus applies everywhere
  function grantSouls(amount) {
    const gained = Math.floor(amount * (1 + (achievementBonus("soulPct") + treeExtBonus("soulPct")) / 100)
      * trialRule("soulMult", 1) * trialRewardProduct("soulMult"));
    save.points += gained;
    return gained;
  }

  // ---------------- Achievements (permanent, never reset -- not even by reincarnation) ----------------
  // bonuses of all achieved entries simply add up. Lifetime counters live in save.stats. Content is a
  // first pass meant to be tuned after playing.
  function stat(key) { return save.stats[key] || 0; }
  function bumpStat(key, n) { save.stats[key] = stat(key) + (n == null ? 1 : n); }
  function maxStat(key, value) { if (Number.isFinite(value) && value > stat(key)) save.stats[key] = value; }
  // the biggest single hit is a Decimal, kept apart from the plain-number counters
  function maxHit() { return save.stats.maxHit instanceof Decimal ? save.stats.maxHit : toDecimal(save.stats.maxHit); }
  function recordHit(dmg) { if (dmg.gt(maxHit())) save.stats.maxHit = dmg; }
  // 日本の命数法 (+ グーゴル and the old 1.8E+308 ceiling), used to write big HP values as 1,440万 etc.
  const JP_UNITS = [
    { e: 4, name: "万", read: "まん" }, { e: 8, name: "億", read: "おく" }, { e: 12, name: "兆", read: "ちょう" },
    { e: 16, name: "京", read: "けい" }, { e: 20, name: "垓", read: "がい" }, { e: 24, name: "秭", read: "じょ" },
    { e: 28, name: "穣", read: "じょう" }, { e: 32, name: "溝", read: "こう" }, { e: 36, name: "澗", read: "かん" },
    { e: 40, name: "正", read: "せい" }, { e: 44, name: "載", read: "さい" }, { e: 48, name: "極", read: "ごく" },
    { e: 52, name: "恒河沙", read: "ごうがしゃ" }, { e: 56, name: "阿僧祇", read: "あそうぎ" }, { e: 60, name: "那由他", read: "なゆた" },
    { e: 64, name: "不可思議", read: "ふかしぎ" }, { e: 68, name: "無量大数", read: "むりょうたいすう" },
    { e: 100, name: "グーゴル", read: "googol" }, { e: 308, name: "無限", read: "むげん" },
  ];
  function unitIndexFor(d) {
    let idx = -1;
    JP_UNITS.forEach((u, i) => { if (d.gte(Decimal.pow(10, u.e))) idx = i; });
    return idx;
  }
  // 3.4京 / 3,400京 / 1.2E+12無量大数: the number in its largest 位
  function jpUnitText(value) {
    const d = new Decimal(value);
    const idx = unitIndexFor(d);
    if (idx < 0) return fmt(d);
    const unit = JP_UNITS[idx];
    const q = d.div(Decimal.pow(10, unit.e));
    let qs;
    if (q.lt(10)) qs = (Math.floor(q.toNumber() * 10) / 10).toLocaleString("ja-JP", { maximumFractionDigits: 1 });
    else if (q.lt(1e4)) qs = Math.floor(q.toNumber()).toLocaleString("ja-JP");
    else qs = fmt(q);
    return qs + unit.name;
  }
  // every 10F mid-boss (死の賭博師) has its own entry; floor10/floor50 keep their old ids so saves that
  // already earned them stay earned
  const MID_BOSS_ACHIEVEMENTS = [
    ["floor10", "其の一", 5], ["boss20", "其の二", 5], ["boss30", "其の三", 10], ["boss40", "其の四", 10],
    ["floor50", "其の五", 15], ["boss60", "其の六", 15], ["boss70", "其の七", 20], ["boss80", "其の八", 20],
    ["boss90", "其の九", 25],
  ].map(([id, suffix, atkPct], i) => {
    const floor = (i + 1) * 10;
    return { id, name: `賭博師討伐・${suffix}`, desc: `${floor}階の中ボスを倒す`, test: () => stat("maxCleared") >= floor, bonus: { atkPct } };
  });
  const ACHIEVEMENTS = MID_BOSS_ACHIEVEMENTS.concat([
    { id: "floor100", name: "塔の頂", desc: "ラスボスを倒す", test: () => stat("bossKills") >= 1, bonus: { atkPct: 30, soulPct: 20 } },
    { id: "floor150", name: "果てなき塔", desc: "150階をクリアする", test: () => stat("maxCleared") >= 150, bonus: { expPct: 20 } },
    { id: "floor200", name: "深淵の住人", desc: "200階をクリアする", test: () => stat("maxCleared") >= 200, bonus: { atkPct: 40 } },
    { id: "hit1e4", name: "一撃一万", desc: "1回で1万ダメージを与える", test: () => maxHit().gte(1e4), bonus: { atkPct: 5 } },
    { id: "hit1e6", name: "一撃百万", desc: "1回で100万ダメージを与える", test: () => maxHit().gte(1e6), bonus: { atkPct: 10 } },
    { id: "hit1e9", name: "一撃十億", desc: "1回で10億ダメージを与える", test: () => maxHit().gte(1e9), bonus: { atkPct: 15 } },
    { id: "hit1e12", name: "一撃一兆", desc: "1回で1兆ダメージを与える", test: () => maxHit().gte(1e12), bonus: { atkPct: 25 } },
    { id: "lv10", name: "成長の兆し", desc: "レベル10に到達する", test: () => save.level >= 10, bonus: { expPct: 10 } },
    { id: "lv50", name: "熟練者", desc: "レベル50に到達する", test: () => save.level >= 50, bonus: { expPct: 15 } },
    { id: "lv100", name: "超越者", desc: "レベル100に到達する", test: () => save.level >= 100, bonus: { expPct: 25 } },
    { id: "crit5", name: "会心連打", desc: "1回の挑戦中に会心を5回連続で出す（階をまたいでもよい）", test: () => stat("maxCritStreak") >= 5, bonus: { critDmg: 25 } },
    { id: "crit10", name: "会心の嵐", desc: "1回の挑戦中に会心を10回連続で出す（階をまたいでもよい）", test: () => stat("maxCritStreak") >= 10, bonus: { critDmg: 50 } },
    { id: "kills100", name: "百の討伐", desc: "敵を合計100体倒す", test: () => stat("kills") >= 100, bonus: { soulPct: 10 } },
    { id: "kills1000", name: "千の討伐", desc: "敵を合計1000体倒す", test: () => stat("kills") >= 1000, bonus: { soulPct: 20 } },
    { id: "runs10", name: "挑戦者", desc: "塔に10回挑む", test: () => stat("runs") >= 10, bonus: { goldPct: 20 } },
    { id: "reinc1", name: "輪廻", desc: "転生する", test: () => stat("reincarnations") >= 1, bonus: { expPct: 20 } },
    { id: "reinc5", name: "輪廻の旅人", desc: "5回転生する", test: () => stat("reincarnations") >= 5, bonus: { soulPct: 20 } },
    { id: "remnant1", name: "残滓の主", desc: "残滓を召喚する", test: () => remnantCount() >= 1, bonus: { atkPct: 10 } },
    { id: "remnant6", name: "残滓の軍勢", desc: "残滓を6体召喚する", test: () => remnantCount() >= 6, bonus: { atkPct: 30 } },
    // ---- progress milestones ----
    { id: "floor300", name: "雲上の回廊", desc: "300階をクリアする", test: () => stat("maxCleared") >= 300, bonus: { atkPct: 50 } },
    { id: "floor500", name: "天穹の踏破者", desc: "500階をクリアする", test: () => stat("maxCleared") >= 500, bonus: { expPct: 50 } },
    { id: "floor1000", name: "千階の覇者", desc: "1000階をクリアする", test: () => stat("maxCleared") >= 1000, bonus: { atkPct: 100 } },
    { id: "floor3000", name: "星界の旅人", desc: "3000階をクリアする", test: () => stat("maxCleared") >= 3000, bonus: { soulPct: 100 } },
    { id: "floor10000", name: "万階の塔主", desc: "10000階をクリアする", test: () => stat("maxCleared") >= 10000, bonus: { atkPct: 300 } },
    { id: "hit1e20", name: "一撃一垓", desc: "1回で1垓（1E+20）ダメージを与える", test: () => maxHit().gte(1e20), bonus: { atkPct: 40 } },
    { id: "hit1e50", name: "天文学的一撃", desc: "1回で1E+50ダメージを与える", test: () => maxHit().gte(1e50), bonus: { atkPct: 60 } },
    { id: "hit1e68", name: "無量大数", desc: "1回で1無量大数（1E+68）ダメージを与える", test: () => maxHit().gte(1e68), bonus: { atkPct: 100 } },
    { id: "hit1e100", name: "グーゴルの一撃", desc: "1回で1グーゴル（1E+100）ダメージを与える", test: () => maxHit().gte(1e100), bonus: { atkPct: 150 } },
    { id: "hit1e308", name: "無限突破", desc: "1回で1E+308を超えるダメージを与える", test: () => maxHit().gte(Decimal.pow(10, 308)), bonus: { atkPct: 200 } },
    { id: "hit1e1000", name: "千桁の一撃", desc: "1回で1E+1000ダメージを与える", test: () => maxHit().gte(Decimal.pow(10, 1000)), bonus: { atkPct: 300 } },
    { id: "lv200", name: "達人", desc: "レベル200に到達する", test: () => save.level >= 200, bonus: { expPct: 30 } },
    { id: "lv500", name: "英雄", desc: "レベル500に到達する", test: () => save.level >= 500, bonus: { expPct: 50 } },
    { id: "lv1000", name: "伝説", desc: "レベル1000に到達する", test: () => save.level >= 1000, bonus: { atkPct: 100 } },
    { id: "lv3000", name: "神話", desc: "レベル3000に到達する", test: () => save.level >= 3000, bonus: { atkPct: 200 } },
    { id: "kills5000", name: "五千の討伐", desc: "敵を合計5000体倒す", test: () => stat("kills") >= 5000, bonus: { soulPct: 30 } },
    { id: "kills20000", name: "二万の討伐", desc: "敵を合計20000体倒す", test: () => stat("kills") >= 20000, bonus: { soulPct: 50 } },
    { id: "kills100000", name: "十万の討伐", desc: "敵を合計100000体倒す", test: () => stat("kills") >= 100000, bonus: { soulPct: 100 } },
    { id: "runs50", name: "常連", desc: "塔に50回挑む", test: () => stat("runs") >= 50, bonus: { goldPct: 50 } },
    { id: "runs200", name: "塔の住人", desc: "塔に200回挑む", test: () => stat("runs") >= 200, bonus: { goldPct: 100 } },
    { id: "reinc10", name: "輪廻の巡礼者", desc: "10回転生する", test: () => stat("reincarnations") >= 10, bonus: { soulPct: 30 } },
    { id: "reinc25", name: "輪廻の覇者", desc: "25回転生する", test: () => stat("reincarnations") >= 25, bonus: { atkPct: 100 } },
    { id: "reinc50", name: "永劫回帰", desc: "50回転生する", test: () => stat("reincarnations") >= 50, bonus: { atkPct: 200 } },
    { id: "remnant3", name: "残滓の小隊", desc: "残滓を3体召喚する", test: () => remnantCount() >= 3, bonus: { atkPct: 15 } },
    { id: "remnantTree30", name: "残滓の研鑽", desc: "残滓スキルツリーを合計30段習得する", test: () => Object.keys(save.remnantTree).length >= 30, bonus: { atkPct: 30 } },
    { id: "remnantTree120", name: "残滓の極み", desc: "残滓スキルツリーを全段習得する", test: () => Object.keys(save.remnantTree).length >= 120, bonus: { atkPct: 200 } },
    { id: "crit20", name: "会心の奔流", desc: "1回の挑戦中に会心を20回連続で出す", test: () => stat("maxCritStreak") >= 20, bonus: { critDmg: 100 } },
    { id: "crit50", name: "必中必殺", desc: "1回の挑戦中に会心を50回連続で出す", test: () => stat("maxCritStreak") >= 50, bonus: { critDmg: 200 } },
    { id: "ext10", name: "魂の修練", desc: "拡張強化のどれかをLv.10にする", test: () => Math.max(0, ...Object.values(save.treeExt)) >= 10, bonus: { soulPct: 20 } },
    { id: "ext30", name: "魂の極地", desc: "拡張強化のどれかをLv.30にする", test: () => Math.max(0, ...Object.values(save.treeExt)) >= 30, bonus: { atkPct: 50 } },
    { id: "deck30", name: "大所帯", desc: "カードを合計30枚所持する", test: () => save.deckDefs.reduce((n, d) => n + d.count, 0) >= 30, bonus: { goldPct: 30 } },
    { id: "souls1e6", name: "ソウルの泉", desc: "ソウルを100万貯める", test: () => save.points >= 1e6, bonus: { soulPct: 20 } },
    { id: "transcend1e7", name: "転生の蓄え", desc: "転生ポイントを1000万貯める", test: () => save.transcendPoints >= 1e7, bonus: { expPct: 30 } },
    { id: "trialStart", name: "苦難への一歩", desc: "苦難に挑む", test: () => stat("trialsStarted") >= 1, bonus: { soulPct: 10 } },
    { id: "trial1", name: "苦難を越えし者", desc: "苦難を1つ乗り越える", test: () => trialsClearedCount() >= 1, bonus: { atkPct: 20 } },
    { id: "trial3", name: "苦難の求道者", desc: "苦難を3つ乗り越える", test: () => trialsClearedCount() >= 3, bonus: { expPct: 30 } },
    { id: "trialAllStar1", name: "八方の試練", desc: "全ての方向の★の苦難を乗り越える", test: () => TRIAL_CATEGORIES.every((c) => save.trialsCleared[c.id + "1"]), bonus: { atkPct: 50 } },
    { id: "trialStar3", name: "深淵の踏破者", desc: "★★★の苦難を1つ乗り越える", test: () => TRIALS.some((t) => t.level === 3 && save.trialsCleared[t.id]), bonus: { soulPct: 50 } },
    { id: "trialAll", name: "万難を排す", desc: "全ての苦難を乗り越える", test: () => trialsClearedCount() >= TRIALS.length, bonus: { atkPct: 100 } },
    // hidden: 5907F is the first floor whose HP passes 1.8E+308 (the old Infinity wall)
    { id: "beyondInfinity", name: "無限の彼方", desc: "5907階をクリアする（敵のHPが1.8E+308を超える最初の階）", hidden: true, test: () => stat("maxCleared") >= 5907, bonus: { atkPct: 100 } },
    { id: "trialCombo2", name: "二重の苦難", desc: "苦難を2つ同時に乗り越える", test: () => (save.trialComboBest || 0) >= 2, bonus: { atkPct: 30 } },
    { id: "trialCombo4", name: "四重の苦難", desc: "苦難を4つ同時に乗り越える", test: () => (save.trialComboBest || 0) >= 4, bonus: { atkPct: 80 } },
    { id: "trialCombo8", name: "八重の苦難", desc: "苦難を8つ同時に乗り越える", test: () => (save.trialComboBest || 0) >= 8, bonus: { atkPct: 300 } },
    { id: "trial8", name: "苦難の巡礼者", desc: "苦難を8つ乗り越える", test: () => trialsClearedCount() >= 8, bonus: { expPct: 50 } },
    { id: "trial16", name: "苦難の覇者", desc: "苦難を16個乗り越える", test: () => trialsClearedCount() >= 16, bonus: { atkPct: 100 } },
    { id: "ach20", name: "実績コレクター", desc: "実績を20個達成する", test: () => Object.keys(save.achievements).length >= 20, bonus: { atkPct: 20 } },
    { id: "ach50", name: "実績マスター", desc: "実績を50個達成する", test: () => Object.keys(save.achievements).length >= 50, bonus: { atkPct: 100 } },
    { id: "lastMove", name: "背水の陣", desc: "最後の1手で敵を倒す", hidden: true, test: () => stat("lastMoveWins") >= 1, bonus: { critDmg: 30 } },
    { id: "bossOneShot", name: "一刀両断", desc: "ラスボスを1手で倒す", hidden: true, test: () => stat("bossOneShot") >= 1, bonus: { atkPct: 50 } },
    { id: "idle8h", name: "眠れる塔", desc: "8時間分の放置収入を一度に受け取る", hidden: true, test: () => stat("maxIdleMinutes") >= 480, bonus: { soulPct: 20 } },
    // hidden: the only tampering a browser game can actually observe is the clock jumping backwards
    { id: "timeTraveler", name: "時を遡る者", desc: "端末の時計を過去に戻す", hidden: true, test: () => stat("clockRollback") >= 1, bonus: { soulPct: 10 } },
  ]);
  const ACHIEVEMENT_BONUS_LABELS = { atkPct: "攻撃力", expPct: "経験値", soulPct: "ソウル", goldPct: "獲得金額", critDmg: "会心ダメージ" };
  function achievementBonus(key) {
    let total = 0;
    ACHIEVEMENTS.forEach((a) => { if (save.achievements[a.id] && a.bonus[key]) total += a.bonus[key]; });
    return total;
  }
  function bonusText(bonus) {
    return Object.entries(bonus).map(([k, v]) => `${ACHIEVEMENT_BONUS_LABELS[k]}+${v}%`).join("・");
  }
  function checkAchievements() {
    ACHIEVEMENTS.forEach((a) => {
      if (save.achievements[a.id] || !a.test()) return;
      save.achievements[a.id] = true;
      showToast(`実績解除：${a.name}（${bonusText(a.bonus)}）`);
    });
  }

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
    return roundDamage(new Decimal(playerHit).mul(remnantCardShare(def) / 100));
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
      await new Promise((res) => setTimeout(res, REMNANT_HIT_MS));
      if (game !== thisGame || game.gameOver || game.enemyHp.lte(0) || !r.cards.length) return;
      const def = r.cards[r.next % r.cards.length];
      r.next += 1;
      const dmg = remnantHitDamage(def, playerHit);
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
    const bonus = cardMult + panelBonus("buffAdd") + trialRewardSum("buffAdd") - 1;
    return 1 + bonus * trialRule("buffScale", 1);
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
    game.enemyHpMax = enemyHpForFloor(floor);
    game.enemyHp = game.enemyHpMax;
    game.n = currentStartN();
    game.floorStartN = game.n;
    game.buffBonus = 0;
    game.enemyPoisoned = false; // a fresh enemy each floor, never carries poison over
    game.critStreak = 0;
    game.percentUsed = false; // 割合カード（処刑の火）は1階につき1回まで
    game.gameOver = false;
    game.deck = buildShuffledDeck();
    game.remnants = buildRemnantRuntime();
    game.followUpBusy = false;
    game.inputReadyAt = performance.now() + INPUT_GUARD_MS;
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
    autoBuyRow: document.getElementById("autoBuyRow"),
    autoBuyBtn: document.getElementById("autoBuyBtn"),
    autoBuyToggle: document.getElementById("autoBuyToggle"),
    autoBuySummary: document.getElementById("autoBuySummary"),
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
    panelBackBtn: document.getElementById("panelBackBtn"),
    panelSub: document.getElementById("panelSub"),
    openPanelPreviewBtn: document.getElementById("openPanelPreviewBtn"),
    panelPointsLabel: document.getElementById("panelPointsLabel"),
    panelMap: document.getElementById("panelMap"),
    panelScrollWrap: document.getElementById("panelScrollWrap"),
    panelMapScaler: document.getElementById("panelMapScaler"),

    homeLevelLabel: document.getElementById("homeLevelLabel"),
    homeExpLabel: document.getElementById("homeExpLabel"),
    idleReport: document.getElementById("idleReport"),
    openAchievementsBtn: document.getElementById("openAchievementsBtn"),
    achievementsBackBtn: document.getElementById("achievementsBackBtn"),
    achievementsCountLabel: document.getElementById("achievementsCountLabel"),
    achievementsTotal: document.getElementById("achievementsTotal"),
    achievementsList: document.getElementById("achievementsList"),
    remnantsBackBtn: document.getElementById("remnantsBackBtn"),
    remnantsPointsLabel: document.getElementById("remnantsPointsLabel"),
    remnantIdleInfo: document.getElementById("remnantIdleInfo"),
    remnantList: document.getElementById("remnantList"),
    remnantTreeBackBtn: document.getElementById("remnantTreeBackBtn"),
    remnantTreePointsLabel: document.getElementById("remnantTreePointsLabel"),
    remnantTreeGrid: document.getElementById("remnantTreeGrid"),
    toastArea: document.getElementById("toastArea"),
    enemyHpUnit: document.getElementById("enemyHpUnit"),
    levelUpBanner: document.getElementById("levelUpBanner"),
    defeatRetryBtn: document.getElementById("defeatRetryBtn"),
    defeatTreeBtn: document.getElementById("defeatTreeBtn"),
    defeatHint: document.getElementById("defeatHint"),
    retreatRetryBtn: document.getElementById("retreatRetryBtn"),
    retreatTreeBtn: document.getElementById("retreatTreeBtn"),
    retreatHint: document.getElementById("retreatHint"),
    trialList: document.getElementById("trialList"),
    trialClearedLabel: document.getElementById("trialClearedLabel"),
    trialBackBtn: document.getElementById("trialBackBtn"),
    trialSkipBtn: document.getElementById("trialSkipBtn"),
    menuDescTitle: document.getElementById("menuDescTitle"),
    menuDescText: document.getElementById("menuDescText"),
    trialStartBtn: document.getElementById("trialStartBtn"),
    trialSelection: document.getElementById("trialSelection"),
    trialCombo: document.getElementById("trialCombo"),
    homeSealed: document.getElementById("homeSealed"),
    homeSealedGrid: document.getElementById("homeSealedGrid"),
    trialBanner: document.getElementById("trialBanner"),
    trialBannerText: document.getElementById("trialBannerText"),
    abandonTrialBtn: document.getElementById("abandonTrialBtn"),
    trialClearNote: document.getElementById("trialClearNote"),
    treeExtBackBtn: document.getElementById("treeExtBackBtn"),
    treeExtPointsLabel: document.getElementById("treeExtPointsLabel"),
    treeExtList: document.getElementById("treeExtList"),

    confirmOverlay: document.getElementById("confirmOverlay"),
    confirmMessage: document.getElementById("confirmMessage"),
    confirmOkBtn: document.getElementById("confirmOkBtn"),
    confirmCancelBtn: document.getElementById("confirmCancelBtn"),
  };

  // in-page stand-in for window.confirm(): some embedded/in-app browser views auto-dismiss the
  // native dialog (it resolves to false immediately without ever being shown), which made the
  // 転生/reset buttons look completely unresponsive there. Resolves true/false like confirm() did.
  // Only one can be open: a second request (keyboard re-activating the button that opened it, or
  // tabbing to the other destructive button) is refused, since two stacked confirmations could
  // both resolve true and run reset + reincarnate back to back. Clicking the backdrop does NOT
  // cancel -- the second click of a double-click lands there and silently dismissed the dialog.
  function showConfirm(message) {
    if (el.confirmOverlay.classList.contains("active")) return Promise.resolve(false);
    return new Promise((resolve) => {
      el.confirmMessage.textContent = message;
      el.confirmOverlay.classList.add("active");
      // Enter/Space on whatever button launched this would otherwise stay on that background button
      el.confirmCancelBtn.focus();
      function cleanup(result) {
        el.confirmOverlay.classList.remove("active");
        el.confirmOkBtn.removeEventListener("click", onOk);
        el.confirmCancelBtn.removeEventListener("click", onCancel);
        document.removeEventListener("keydown", onKey);
        resolve(result);
      }
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onKey(e) { if (e.key === "Escape") cleanup(false); }
      el.confirmOkBtn.addEventListener("click", onOk);
      el.confirmCancelBtn.addEventListener("click", onCancel);
      document.addEventListener("keydown", onKey);
    });
  }

  const TOAST_MS = 3500;
  function showToast(text) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = text;
    el.toastArea.appendChild(t);
    setTimeout(() => t.remove(), TOAST_MS);
  }

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    document.getElementById("screen-" + name).classList.add("active");
    document.body.classList.toggle("title-bg", name === "home");
  }

  const E_NOTATION_THRESHOLD = 1e9; // below this, plain comma-separated numbers; at/above, "+E" notation
  function fmt(n) {
    if (n instanceof Decimal) {
      if (n.abs().lt(E_NOTATION_THRESHOLD)) return fmt(n.toNumber());
      // "1.23e+1234" -> "1.23E1234" (no "+"); very long exponents get digit grouping (the glyph set has ",")
      const [mant, exp] = n.toExponential(2).split("e");
      const e = Number(exp);
      return mant + "E" + (e < 0 ? "-" : "") + (Math.abs(e) >= 1e4 ? Math.abs(e).toLocaleString("ja-JP") : Math.abs(e));
    }
    const rounded = Math.round(n);
    if (Math.abs(rounded) >= E_NOTATION_THRESHOLD) {
      return rounded.toExponential(2).replace("e+", "E").replace("e-", "E-");
    }
    return rounded.toLocaleString("ja-JP");
  }
  // for multipliers (buff cards): fmt() rounds to a whole number, which would hide a fractional
  // bonus like 継承の闘気's +0.1/level; round to 2dp instead (also mops up float noise like 2.3000000000000003)
  function fmtMult(n) {
    if (n instanceof Decimal) return n.lt(E_NOTATION_THRESHOLD) ? fmtMult(n.toNumber()) : fmt(n);
    return (Math.round(n * 100) / 100).toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  }

  function addLog(text, cls) {
    const line = document.createElement("div");
    line.className = "log-line" + (cls ? " " + cls : "");
    line.textContent = text;
    el.log.prepend(line);
  }

  // floating damage numbers are drawn from pre-rendered glyph IMAGES (assets/dmg-font/), not a
  // web font: the licensed font they come from forbids shipping the font file itself anywhere a
  // third party could extract it (a @font-face file is trivially saveable from the browser cache/
  // network tab, which is exactly what that clause rules out). Only these small PNGs -- one per
  // character actually needed here -- ever leave this machine; see assets/dmg-font/LICENSE-NOTE.txt.
  // Each PNG shares one common baseline/height from rasterization, so different glyphs' natural
  // proportions (e.g. "," small and low, "C" full-height) still line up when mixed in one string.
  const DMG_GLYPH_FILES = {
    "0": "d0", "1": "d1", "2": "d2", "3": "d3", "4": "d4", "5": "d5", "6": "d6", "7": "d7", "8": "d8", "9": "d9",
    ",": "comma", ".": "dot", "-": "minus", "+": "plus", "E": "E",
    "C": "C", "R": "R", "I": "I", "T": "T", "A": "A", "L": "L",
  };
  const DMG_GLYPH_ASPECT = {
    d0: 0.608, d1: 0.395, d2: 0.608, d3: 0.608, d4: 0.641, d5: 0.611, d6: 0.608, d7: 0.611, d8: 0.608, d9: 0.608,
    comma: 0.286, dot: 0.286, minus: 0.379, plus: 0.482, E: 0.625,
    A: 0.711, C: 0.611, I: 0.352, L: 0.625, R: 0.658, T: 0.654,
  };
  const DMG_CHAR_BOUNCE_STAGGER_MS = 30; // per-character delay so the string bounces in left-to-right, like a wave
  // the WHOLE string's stagger is kept within this total span so the last character's bounce
  // never lands after the hold/fade has already started (see DMG_LIFETIME_MS below). For a short
  // string the per-character gap is the full 45ms above; a longer string (e.g. "CRITICAL-1,234")
  // shrinks that gap so every character still gets its OWN distinct delay -- capping the delay
  // instead of shrinking the gap would bunch every character past a fixed count into one lockstep
  // group, which reads as the wave animation abruptly stopping partway through the string.
  const DMG_CHAR_STAGGER_SPAN_MS = 140;
  const DMG_LIFETIME_MS = 850; // total on-screen time for a damage number; keep in sync with style.css's dmgHoldFade duration
  // mask-image fetches its image in CORS mode, which a page opened via file:// is never allowed to
  // do -- the glyphs come out fully transparent -- so file:// falls back to plain text
  const DMG_GLYPHS_USABLE = location.protocol !== "file:";
  function appendDmgChars(container, text) {
    const chars = [...text];
    const gap = chars.length > 1 ? Math.min(DMG_CHAR_BOUNCE_STAGGER_MS, DMG_CHAR_STAGGER_SPAN_MS / (chars.length - 1)) : 0;
    chars.forEach((ch, i) => {
      const file = DMG_GLYPHS_USABLE ? DMG_GLYPH_FILES[ch] : null;
      const span = document.createElement("span");
      if (file) {
        span.className = "dmg-char";
        span.style.setProperty("--dmg-glyph", `url("assets/dmg-font/${file}.png")`);
        span.style.setProperty("--dmg-aspect", DMG_GLYPH_ASPECT[file]);
      } else {
        span.className = "dmg-text"; // file:// or a character outside the rasterized set above
        span.textContent = ch;
      }
      span.style.animationDelay = (i * gap) + "ms";
      container.appendChild(span);
    });
  }

  // isRemnant: a remnant's follow-up -- its own color, no screen shake (a flurry of them would
  // otherwise shake the screen nonstop), and a quick hit-flash on the enemy instead
  function floatDamage(amount, isCrit, isRemnant) {
    const rect = el.enemyVisual.getBoundingClientRect();
    const f = document.createElement("div");
    const ratio = new Decimal(amount).div(game.enemyHpMax).toNumber();
    const isHuge = ratio >= 0.5;
    let cls = "dmg-float";
    if (isRemnant) {
      cls += " dmg-remnant";
    } else if (isCrit) {
      cls += " dmg-crit";
      if (isHuge) cls += " dmg-huge";
    } else if (isHuge) {
      cls += " dmg-huge";
    } else if (ratio >= 0.15) {
      cls += " dmg-big";
    }
    f.className = cls;
    appendDmgChars(f, (isCrit ? "CRITICAL-" : "-") + fmt(amount));
    // land at a random spot over the enemy art each hit (instead of always dead center) so
    // consecutive hits don't just stack on top of each other now that the number no longer
    // floats away; margin keeps it clear of the art's own edges.
    const marginX = rect.width * 0.18;
    const marginY = rect.height * 0.18;
    const randX = rect.left + marginX + Math.random() * Math.max(0, rect.width - marginX * 2);
    const randY = rect.top + marginY + Math.random() * Math.max(0, rect.height - marginY * 2);
    f.style.left = randX + "px";
    f.style.top = randY + "px";
    document.body.appendChild(f);
    // matches .dmg-float's dmgHoldFade animation duration in style.css (bounce, then a brief
    // hold, then a quick fade) -- removal is timed to land exactly as that fade reaches 0 so
    // there's no visible pop-off.
    setTimeout(() => f.remove(), DMG_LIFETIME_MS);
    if (isRemnant) {
      el.enemyVisual.classList.remove("remnant-hit");
      void el.enemyVisual.offsetWidth; // restart the flash for back-to-back hits
      el.enemyVisual.classList.add("remnant-hit");
    } else {
      impactEffects(isCrit, isHuge);
    }
  }

  // screen shake + flash, layered on top of the floating number for extra "juice" on big hits.
  // shakes .app (not body) so the fixed-position damage number / flash overlay stay viewport-stable
  // instead of jittering along with the transform (position:fixed re-anchors to a transformed ancestor).
  function impactEffects(isCrit, isHuge) {
    el.enemyVisual.classList.remove("hit");
    void el.enemyVisual.offsetWidth;
    el.enemyVisual.classList.add("hit");
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
    // 渾身の一撃: atk × remaining moves -- strongest when played early. Moves no longer grow past
    // BASE_N, so the old "damage = moves left" (at most 5) had become useless.
    const atk = new Decimal(currentAtk());
    if (card.calc === "n") return atk.mul(game.n);
    if (card.calc === "critStreak") return atk.mul(Math.max(1, game.critStreak)); // scales with consecutive crits landed so far
    if (card.calc === "pow1_5") return atk.pow(1.5); // superlinear late-game scaling
    return atk.mul(atk); // "atk2" (legacy default)
  }

  function attackBaseDamage(card) {
    return effectiveValue(card) + currentAtk();
  }

  // additive stacking can push (baseMult + Σ buff bonus) to zero or below (e.g. two ×0.5 gamble
  // misses in a row); floor it so the next attack still deals a sliver instead of 0 / negative damage
  const MIN_BUFF_MULTIPLIER = 0.1;

  // player card hits (not poison/remnants) become lastHit, which the remnants' follow-ups scale from
  function hitEnemy(dmg, isPlayerCard) {
    game.enemyHp = Decimal.max(0, game.enemyHp.sub(dmg));
    recordHit(dmg);
    if (isPlayerCard !== false) game.lastHit = dmg;
  }
  function noteCrit(isCrit) {
    game.critStreak = isCrit ? game.critStreak + 1 : 0;
    game.runCritStreak = isCrit ? game.runCritStreak + 1 : 0;
    maxStat("maxCritStreak", game.runCritStreak);
  }

  // Resolves a single card's effect (damage/draw/buff/chain). Does not touch hand/deck/n bookkeeping,
  // so it can be reused both for a directly-played card and for cards triggered by a chain card.
  function resolveCardEffect(card) {
    if (card.type === "attack") {
      const mult = damageMultiplier();
      const isCrit = card.forceCrit || rollCrit(card.critRateBonus);
      const critMult = isCrit ? critMultiplier(card.critDmgBonus) : 1;
      const dmg = roundDamage(mult.mul(attackBaseDamage(card)).mul(critMult));
      hitEnemy(dmg);
      noteCrit(isCrit);
      const multNote = !mult.eq(1) ? `（倍率×${fmtMult(mult)}）` : "";
      if (isCrit) addLog(`${card.name} で会心の一撃！ ${fmt(dmg)} ダメージ！${multNote}`, "dmg crit");
      else addLog(`${card.name} で ${fmt(dmg)} ダメージ！${multNote}`, "dmg");
      floatDamage(dmg, isCrit);
      game.buffBonus = 0;
    } else if (card.type === "percent") {
      // percent damage ignores buffs AND crits, and leaves any stored buff in place for the next
      // attack: a buffed or critting "% of max HP" hit (30% × crit ≈ 440%) one-shot any floor however
      // far enemy HP has scaled, which skips the whole point of an incremental HP curve. It neither
      // extends nor breaks a crit streak.
      const pct = effectiveValue(card);
      const dmg = roundDamage(game.enemyHpMax.mul(pct));
      game.percentUsed = true;
      hitEnemy(dmg, false); // not a lastHit: remnants following up a % of max HP one-shot every floor
      addLog(`${card.name}：敵の最大HPの${Math.round(pct * 100)}%、${fmt(dmg)} ダメージ！`, "percent");
      floatDamage(dmg, false);
    } else if (card.type === "draw") {
      const count = effectiveValue(card);
      addLog(`${card.name}：カードを${count}枚引いた`, "info");
      for (let i = 0; i < count; i++) drawOne();
    } else if (card.type === "buff") {
      // most buff cards apply a fixed multiplier, but a card can instead carry a randomValues
      // list (e.g. a 50/50 gamble) to pick from each time it's played; panelBonus("buffAdd")
      // (継承の闘気) adds a permanent flat bonus on top of whatever this specific card rolls
      const cardMult = card.randomValues ? card.randomValues[Math.floor(Math.random() * card.randomValues.length)] : effectiveValue(card);
      const appliedMult = buffApplied(cardMult);
      // buffs stack additively on their bonus part (see damageMultiplier()), so ×2 then ×3 adds +3
      // (not ×6), and a gamble's ×0.5 miss really subtracts -- floored so repeated misses can't dig
      // a hole that later buffs first have to climb out of
      game.buffBonus = Math.max(MIN_BUFF_MULTIPLIER - currentBaseMult(), game.buffBonus + (appliedMult - 1));
      addLog(`${card.name}：次の攻撃カードの倍率が×${fmtMult(damageMultiplier())}に！`, "buff");
    } else if (card.type === "poison") {
      // a status flag, not a stacking counter: playing this again while already poisoned does nothing extra
      if (game.enemyPoisoned) {
        addLog(`${card.name}：敵は既に毒状態だ（効果は重複しない）`, "info");
      } else {
        game.enemyPoisoned = true;
        addLog(`${card.name}：敵を猛毒状態にした！`, "buff");
      }
    } else if (card.type === "special") {
      const mult = damageMultiplier();
      const isCrit = rollCrit();
      const critMult = isCrit ? critMultiplier() : 1;
      const raw = specialCardRaw(card);
      const dmg = roundDamage(mult.mul(raw).mul(critMult));
      hitEnemy(dmg);
      noteCrit(isCrit);
      const multNote = !mult.eq(1) ? `（倍率×${fmtMult(mult)}）` : "";
      if (isCrit) addLog(`${card.name} で会心の一撃！ ${fmt(dmg)} ダメージ！${multNote}`, "dmg crit");
      else addLog(`${card.name} で ${fmt(dmg)} ダメージ！${multNote}`, "dmg");
      floatDamage(dmg, isCrit);
      game.buffBonus = 0;
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

  // tempo first (same as the festival build); each must match its animation in style.css
  const CARD_PLAY_ANIM_MS = 160; // .card.playing / cardPlayFx
  const FLIP_SLIDE_MS = 180; // hand reflow: cards sliding left + the new card flying in from the deck pile
  const CARD_FLIP_DELAY_MS = 180; // how long a newly drawn card stays face-down before it flips to reveal itself
  const KILL_PAUSE_MS = 420; // the killing blow's number and the defeat effect play out before the screen changes
  const INPUT_GUARD_MS = 300; // a fresh floor ignores clicks/keys this long, so a held key can't fire into it
  const POISON_DAMAGE_PCT = 0.05; // 5% of max HP per player move while poisoned; doesn't stack

  // ticks once per player move (not per chain-triggered sub-card) while the enemy is poisoned
  function applyPoisonTick() {
    if (!game.enemyPoisoned || game.enemyHp.lte(0)) return;
    const dmg = roundDamage(game.enemyHpMax.mul(POISON_DAMAGE_PCT));
    game.enemyHp = Decimal.max(0, game.enemyHp.sub(dmg));
    addLog(`毒の傷が疼く…${fmt(dmg)} ダメージ`, "dmg");
    floatDamage(dmg, false);
  }

  // playing a card is a two-stage sequence: first a quick "used" effect plays on the card in
  // place (see .card.playing), and only once that finishes does the card actually resolve,
  // get replaced, and the replacement enter the hand face-down (see renderBattle's flip-in).
  function playCard(uid) {
    if (!game || game.gameOver || game.followUpBusy || performance.now() < game.inputReadyAt) return;
    const card = game.hand.find((c) => c.uid === uid);
    if (!card || card.playing) return;
    if (card.type === "percent" && game.percentUsed) return;
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
      // remnants follow up after every attack/special card (not 処刑の火); the win/lose check waits until their
      // flurry is over (a remnant may land the kill), and no card can be played meanwhile
      if ((card.type === "attack" || card.type === "special") && game.remnants.length && game.enemyHp.gt(0)) {
        game.followUpBusy = true;
        // finally, not then: an exception mid-flurry used to leave followUpBusy set and the battle frozen
        runRemnantFollowUps(thisGame, game.lastHit || 0)
          .catch((e) => console.error("[remnant follow-up]", e))
          .finally(() => {
            if (game !== thisGame) return;
            game.followUpBusy = false;
            checkAchievements();
            if (!game.gameOver) checkResult();
          });
      } else {
        checkAchievements();
        checkResult();
      }
    }, CARD_PLAY_ANIM_MS);
  }

  function enemyHpPct() { return Math.max(0, game.enemyHp.div(game.enemyHpMax).toNumber() * 100); }
  function updateEnemyHpDisplay() {
    el.enemyHpNow.textContent = fmt(game.enemyHp);
    el.enemyBar.style.width = enemyHpPct() + "%";
    el.enemyHpUnit.textContent = game.enemyHpMax.gte(1e4) ? `（最大HP ${jpUnitText(game.enemyHpMax)}）` : "";
  }

  function checkResult() {
    if (game.enemyHp.lte(0)) onFloorWin();
    else if (game.n <= 0) onFloorLoss();
  }

  // points earned = sum of the floor numbers of every monster actually defeated this run
  // (not a count-based formula), so challenging a higher checkpoint is worth what it should be:
  // e.g. starting at floor91 and clearing 3 floors yields 91+92+93 pts, not the same tiny amount
  // a floor1-3 clear would give.
  function awardRunEndPoints() {
    const gained = grantSouls(game.floorPointsSum);
    save.bestFloor = Math.max(save.bestFloor, game.floor);
    persistSave();
    return gained;
  }

  function onFloorWin() {
    game.gameOver = true;
    const thisGame = game;
    el.enemyVisual.classList.add("defeated");
    addLog(`敵を撃破した！`, "info");
    game.floorPointsSum += game.floor;
    save.bestClearedFloor = Math.max(save.bestClearedFloor, game.floor);
    bumpStat("kills");
    if (game.n === 0) bumpStat("lastMoveWins");
    if (game.floor === FINAL_FLOOR && game.floorStartN - game.n === 1) bumpStat("bossOneShot");
    maxStat("maxCleared", game.floor);
    if (game.floor === FINAL_FLOOR) bumpStat("bossKills");
    // transcend points no longer come from endless floors: they're paid out on reincarnation from
    // the level reached (see reincarnateNow), and every kill feeds that level
    const levelBefore = save.level;
    const levelsGained = gainExp(game.enemyHpMax.mul(EXP_PER_ENEMY_HP));
    if (levelsGained) addLog(`レベルアップ！ Lv.${save.level}`, "levelup");
    checkAchievements();

    el.trialClearNote.textContent = "";
    if (game.floor === FINAL_FLOOR && save.activeTrials.length) completeTrial();

    if (game.floor === FINAL_FLOOR && !game.endlessMode) {
      // first time reaching the final boss this run: offer the endless-mode choice.
      // reaching this at all permanently unlocks the reincarnation panel for future titles.
      const gained = awardRunEndPoints();
      // already banked: without this, entering endless mode and later losing/retreating would
      // pay floors 1-100 out a second time through the same running sum
      game.floorPointsSum = 0;
      save.transcendUnlocked = true;
      persistSave();
      el.victoryPoints.textContent = fmt(gained);
      setTimeout(() => { if (game === thisGame) showScreen("finalVictory"); }, KILL_PAUSE_MS);
    } else {
      save.bestFloor = Math.max(save.bestFloor, game.floor);
      persistSave();
      const goldGain = Math.ceil((10 + game.floor * 3) * goldMultiplier() - 1e-9);
      game.gold += goldGain;
      setTimeout(() => { if (game === thisGame) openFloorClear(goldGain, levelBefore, levelsGained); }, KILL_PAUSE_MS);
    }
  }

  // the seal lifts the moment the boss falls, so the rest of the run (endless included) is at full power
  function completeTrial() {
    const defs = activeTrialDefs();
    save.activeTrials = [];
    if (!defs.length) return;
    const fresh = defs.filter((t) => !save.trialsCleared[t.id]);
    defs.forEach((t) => { save.trialsCleared[t.id] = true; });
    const lines = [`苦難（${defs.map((t) => t.name).join("・")}）を乗り越えた！`];
    if (fresh.length) lines.push("永続報酬：" + fresh.map((t) => t.rewardText).join("／"));
    else lines.push("（報酬は獲得済み）");
    if (defs.length >= 2 && defs.length > (save.trialComboBest || 0)) {
      const from = (save.trialComboBest || 1) + 1;
      save.trialComboBest = defs.length;
      lines.push(`同時挑戦ボーナス：全ダメージ ×${Array.from({ length: defs.length - from + 1 }, (_, i) => from + i).reduce((a, b) => a * b, 1)}`);
    }
    checkAchievements();
    const text = lines.join(" ");
    addLog(text, "levelup");
    showToast(text);
    el.trialClearNote.textContent = text;
  }

  function onFloorLoss() {
    game.gameOver = true;
    addLog(`手数が尽きた。塔から追い出される…`, "dmg");
    const gained = awardRunEndPoints(); // the floor they died on was never added to floorPointsSum
    el.defeatFloor.textContent = game.floor;
    el.defeatPoints.textContent = fmt(gained);
    prepareRetry(gained);
    const thisGame = game;
    setTimeout(() => { if (game === thisGame) showScreen("defeat"); }, KILL_PAUSE_MS);
  }

  function onRetreat() {
    game.gameOver = true;
    const gained = awardRunEndPoints(); // the current floor's monster was already added when it was cleared
    el.retreatFloor.textContent = game.floor;
    el.retreatPoints.textContent = fmt(gained);
    prepareRetry(gained);
    showScreen("retreat");
  }

  // 「すぐにもう一度挑む」: the same checkpoint again, or one checkpoint lower if that run cleared
  // nothing at all (no souls, no exp: retrying the same spot would just repeat the loss)
  let retryFloor = 1;
  function prepareRetry(gained) {
    const start = game.startFloor || 1;
    const options = FLOOR_CHECKPOINTS.filter((f) => f !== FINAL_FLOOR).concat(endlessCheckpointsAll());
    const lower = options.filter((f) => f < start);
    retryFloor = gained > 0 || !lower.length ? start : lower[lower.length - 1];
    const label = `すぐにもう一度挑む（${retryFloor}階から）`;
    el.defeatRetryBtn.textContent = label;
    el.retreatRetryBtn.textContent = label;
    const affordable = NODES.filter((n) => nodeState(n) === "available").length;
    const hint = affordable ? `いま習得できる基本強化が${affordable}個ある！` : "";
    el.defeatHint.textContent = hint;
    el.retreatHint.textContent = hint;
  }
  function retryRun() { game = null; newRun(retryFloor); }
  function runEndToTree() { game = null; openScreen("tree"); }
  el.defeatRetryBtn.addEventListener("click", retryRun);
  el.retreatRetryBtn.addEventListener("click", retryRun);
  el.defeatTreeBtn.addEventListener("click", runEndToTree);
  el.retreatTreeBtn.addEventListener("click", runEndToTree);

  // reincarnation pays out transcend points from the level reached, then resets the run-to-run
  // progress (souls, basic tree, deck, level) and drops the player into the panel. The panel,
  // transcend points, achievements and everything remnant-related survive.
  function reincarnateNow() {
    save.transcendPoints += transcendGainForLevel(save.level);
    save.activeTrials = []; // unfinished 苦難 end with the loop
    save.trialPending = true; // leaving the panel offers the 苦難 screen (if any are unlocked)
    save.level = 1;
    save.exp = new Decimal(0);
    bumpStat("reincarnations");
    checkAchievements();
    save.points = panelBonus("startPoints");
    save.unlockedNodes = {};
    save.treeExt = {};
    save.deckDefs = cloneDeckDefs(BASE_DECK_DEFS);
    save.cardShopPurchases = {}; // the bought copies were just wiped from the deck, so their price climb goes too
    save.bestFloor = 0;
    save.bestClearedFloor = 0;
    persistSave();
    game = null;
    openPanel(false);
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
    // 初期手札+1は全フロアの手数効率に効き続ける強力な効果なので、序盤の周回では商人に並ばない。
    // 手札が山札に近づくと使ったカードがすぐ手元に戻るので、出現率を大きく下げ（weight）、1ラン3個まで。
    // 手札+2がデッキ枚数に届いたら並ばない（手札9=デッキ9で双撃の構えの連打が復活していた）
    { id: "hand1", name: "集中の秘薬", desc: "初期手札 +1（このラン中、最大3回）", baseCost: 30, unlockFloor: 11, weight: 0.15, maxPerRun: 3, apply: () => { game.runHandBonus += 1; } },
    // +1% with a per-run cap: at +10% a few purchases hit 100% crit and made the crit-rate tree pointless
    { id: "critRate1", name: "会心の秘薬", desc: "クリティカル率 +1%（このラン中、最大30回）", baseCost: 25, maxPerRun: 30, apply: () => { game.runCritRateBonus += 1; } },
    // unlimited at a flat price, long runs just stacked it forever; ×1.1 per buy keeps it the crit sink
    { id: "critDmg1", name: "会心撃の秘薬", desc: "クリティカルダメージ +15%（このラン中、買うたび価格上昇）", baseCost: 25, priceGrowth: 1.1, apply: () => { game.runCritDamageBonus += 15; } },
    // gold feeds every other purchase, so it snowballed (+26,850% in one tested run at +50% each): now
    // +10% and each repeat buy in the same run costs ×1.2 more
    { id: "goldRun1", name: "強欲の秘薬", desc: "獲得金額 +10%（このラン中、買うたび価格上昇）", baseCost: 30, unlockFloor: 21, priceGrowth: 1.2, apply: () => { game.runGoldPctBonus += 10; } },
    //{ id: "runN1", name: "疾風の秘薬", desc: "初期手数 +2（このラン中）", baseCost: 35, apply: () => { game.runNBonus += 2; } },
  ];

  function shopBuyCount(opt) { return game.shopBuyCounts[opt.id] || 0; }
  function runDeckSize() { return game.deckDefs.reduce((sum, d) => sum + d.count, 0); }
  function availableShopPool() {
    if (trialRule("noShop", false)) return [];
    return SHOP_POOL.filter((opt) => (!opt.unlockFloor || save.bestClearedFloor >= opt.unlockFloor)
      && (!opt.maxPerRun || shopBuyCount(opt) < opt.maxPerRun)
      // the hand must stay 2+ cards short of the deck, or a played card comes straight back
      && !(opt.id === "hand1" && currentStartHand() + 2 >= runDeckSize()));
  }
  function shopOfferCost(opt) {
    const base = opt.baseCost + game.floor * 2;
    return opt.priceGrowth ? Math.ceil(base * Math.pow(opt.priceGrowth, shopBuyCount(opt))) : base;
  }
  function rollShopOffers() {
    game.shopOffers = pickWeighted(availableShopPool(), shopOfferCount()).map((opt) => ({ opt, cost: shopOfferCost(opt), bought: false }));
  }
  // distinct picks, each item's chance proportional to its weight (default 1)
  function pickWeighted(arr, count) {
    const copy = arr.slice();
    const out = [];
    while (out.length < count && copy.length > 0) {
      const total = copy.reduce((sum, o) => sum + (o.weight || 1), 0);
      let r = Math.random() * total;
      let i = 0;
      while (i < copy.length - 1 && (r -= copy[i].weight || 1) >= 0) i++;
      out.push(copy.splice(i, 1)[0]);
    }
    return out;
  }

  function openFloorClear(goldGain, levelBefore, levelsGained) {
    const next = game.floor + 1;
    const nextTag = next === FINAL_FLOOR ? "【ラスボス】" : next % 10 === 0 ? "【中ボス】" : "";
    el.floorClearSub.textContent = `${game.floor}階クリア（+${fmt(goldGain)}G）。次は${next}階${nextTag}：HP ${jpUnitText(enemyHpForFloor(next))}　Lv.${save.level}（次まで ${expRemainingText()}）`;
    if (levelsGained > 0) {
      el.levelUpBanner.innerHTML = "";
      const a = document.createElement("div");
      a.className = "levelup-main";
      a.textContent = `LEVEL UP!  Lv.${levelBefore} → Lv.${save.level}`;
      const b = document.createElement("div");
      b.className = "levelup-sub";
      b.textContent = `攻撃力 +${fmt(levelsGained * LEVEL_ATK_PCT)}%・会心ダメージ +${fmt(levelsGained * LEVEL_CRIT_DMG)}%`;
      el.levelUpBanner.appendChild(a);
      el.levelUpBanner.appendChild(b);
      el.levelUpBanner.style.display = "";
    } else el.levelUpBanner.style.display = "none";
    rollShopOffers();
    game.shopRerollsUsed = 0;
    el.autoBuySummary.textContent = "";
    renderShop();
    showScreen("floorClear");
    if (autoBuyUnlocked() && save.autoBuyEnabled) setTimeout(runAutoBuy, AUTO_BUY_STEP_MS);
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
      const rankEligible = def.type !== "chain" && def.type !== "special" && def.type !== "poison" && def.type !== "percent" && !def.randomValues;
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

  // each purchase of the same item raises its next price, the same anti-snowball idea as the deck
  // screen's rank-up/delete costs -- a flat price let one strong card be bought without limit.
  const CARD_SHOP_PRICE_GROWTH = 1.5;
  function cardShopPurchaseCount(item) {
    const recorded = save.cardShopPurchases[item.id];
    if (recorded != null) return recorded;
    // saves from before this counter existed: every shop card came only from the shop, so the
    // copies owned are the best available stand-in for how many were bought
    const owned = save.deckDefs.find((d) => d.name === item.card.name && d.type === item.card.type);
    return owned ? owned.count : 0;
  }
  function cardShopPrice(item) {
    return Math.ceil(item.cost * Math.pow(CARD_SHOP_PRICE_GROWTH, cardShopPurchaseCount(item)));
  }

  function renderCardShop() {
    el.cardShopPointsLabel.textContent = fmt(save.points);
    el.cardShopOptions.innerHTML = "";
    // the panel's 商人との契約 chain unlocks these one at a time, in order
    CARD_SHOP_POOL.slice(0, shopUnlockedCount()).forEach((item) => {
      const owned = save.deckDefs.find((d) => d.name === item.card.name && d.type === item.card.type);
      const countLabel = owned ? `（所持 ${owned.count}枚）` : "";
      const price = cardShopPrice(item);
      const affordable = save.points >= price;
      const div = document.createElement("div");
      div.className = "option-card" + (affordable ? "" : " disabled");
      div.innerHTML = `<div class="oc-name">${item.name}${countLabel}</div><div class="oc-desc">${item.desc}</div><div class="oc-cost">${fmt(price)}pt</div>`;
      if (affordable) {
        div.addEventListener("click", () => {
          if (save.points < price) return;
          save.points -= price;
          save.cardShopPurchases[item.id] = cardShopPurchaseCount(item) + 1;
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
    // ×1.5 per paid reroll within this visit: the old +5G steps were so cheap that rerolling
    // hundreds of times per floor was the optimal play
    const paidRerolls = game.shopRerollsUsed - freeRerollAllowance();
    return Math.ceil((10 + game.floor * 2) * Math.pow(1.5, paidRerolls));
  }

  function buyOffer(offer) {
    if (offer.bought || game.gold < offer.cost) return false;
    game.gold -= offer.cost;
    offer.opt.apply();
    offer.bought = true;
    game.shopBuyCounts[offer.opt.id] = shopBuyCount(offer.opt) + 1;
    addLog(`購入：${offer.opt.name}`, "gold");
    return true;
  }

  function doReroll() {
    const cost = rerollCost();
    if (game.gold < cost) return false;
    game.gold -= cost;
    game.shopRerollsUsed += 1;
    rollShopOffers();
    addLog(cost > 0 ? `商人のラインナップをリロール（-${fmt(cost)}G）` : `商人のラインナップをリロール（無料）`, "gold");
    return true;
  }

  function renderShop() {
    el.shopGold.textContent = fmt(game.gold);
    el.shopOptions.innerHTML = "";
    game.shopOffers.forEach((offer) => {
      const div = document.createElement("div");
      const affordable = !offer.bought && game.gold >= offer.cost;
      div.className = "option-card" + (offer.bought || !affordable || autoBuyRunning ? " disabled" : "");
      div.innerHTML = `<div class="oc-name">${offer.opt.name}</div><div class="oc-desc">${offer.opt.desc}</div><div class="oc-cost">${offer.bought ? "購入済み" : fmt(offer.cost) + " G"}</div>`;
      if (!offer.bought && affordable) {
        div.addEventListener("click", () => {
          if (autoBuyRunning) return;
          if (buyOffer(offer)) renderShop();
        });
      }
      el.shopOptions.appendChild(div);
    });

    const cost = rerollCost();
    const free = cost === 0;
    const canReroll = !autoBuyRunning && (free || game.gold >= cost);
    el.rerollBtn.textContent = free ? `リロール（無料）` : `リロール（${fmt(cost)}G）`;
    el.rerollBtn.disabled = !canReroll;
    el.rerollBtn.style.opacity = canReroll ? "1" : "0.5";

    const unlocked = autoBuyUnlocked();
    el.autoBuyRow.style.display = unlocked ? "" : "none";
    el.autoBuyBtn.textContent = autoBuyRunning ? "自動購入を停止" : "自動購入";
    el.autoBuyToggle.checked = !!save.autoBuyEnabled;
  }

  el.rerollBtn.addEventListener("click", () => {
    if (autoBuyRunning) return;
    if (doReroll()) renderShop();
  });

  // ---------------- Auto-buy (unlocked by the 自動購入開放 tree node) ----------------
  // repeats "buy everything affordable on offer (cheapest first) → reroll" at a quick but visible
  // pace until the gold runs out. It only rerolls when the gold left after paying for the reroll
  // could still buy the cheapest potion available, so it never burns the last gold on a reroll
  // that can't lead to a purchase. Rising reroll (×1.5) and 強欲 (×1.2) prices end the loop.
  const AUTO_BUY_STEP_MS = 25;
  let autoBuyRunning = false;
  let autoBuyStopRequested = false;
  function autoBuyUnlocked() { return NODES.some((n) => n.kind === "autoBuy" && save.unlockedNodes[n.id]); }

  async function runAutoBuy() {
    if (autoBuyRunning || !game || !game.shopOffers || !autoBuyUnlocked()) return;
    const thisGame = game;
    const stillHere = () => game === thisGame && game.shopOffers && document.getElementById("screen-floorClear").classList.contains("active");
    autoBuyRunning = true;
    autoBuyStopRequested = false;
    const goldBefore = game.gold;
    const bought = {};
    let rerolls = 0;
    renderShop();
    while (!autoBuyStopRequested && stillHere()) {
      const offer = game.shopOffers.filter((o) => !o.bought && game.gold >= o.cost).sort((a, b) => a.cost - b.cost)[0];
      if (offer) {
        buyOffer(offer);
        bought[offer.opt.name] = (bought[offer.opt.name] || 0) + 1;
      } else {
        const pool = availableShopPool();
        const cheapest = pool.length ? Math.min(...pool.map(shopOfferCost)) : Infinity;
        const cost = rerollCost();
        if (game.gold - cost < cheapest || !doReroll()) break;
        rerolls += 1;
      }
      renderShop();
      await new Promise((r) => setTimeout(r, AUTO_BUY_STEP_MS));
    }
    autoBuyRunning = false;
    if (game !== thisGame || !game.shopOffers) return; // left the shop mid-way (next floor / retreat)
    const items = Object.entries(bought).map(([name, n]) => `${name}×${n}`).join("、") || "なし";
    el.autoBuySummary.textContent = `自動購入：${items}／リロール${rerolls}回／使用 ${fmt(goldBefore - game.gold)}G`;
    renderShop();
  }

  el.autoBuyBtn.addEventListener("click", () => {
    if (autoBuyRunning) autoBuyStopRequested = true;
    else runAutoBuy();
  });
  el.autoBuyToggle.addEventListener("change", () => {
    save.autoBuyEnabled = el.autoBuyToggle.checked;
    persistSave();
    if (save.autoBuyEnabled) runAutoBuy();
  });

  function goNextFloor() {
    if (!game || !game.shopOffers) return;
    autoBuyStopRequested = true;
    game.shopOffers = null;
    startFloor(game.floor + 1);
  }
  el.toNextFloorBtn.addEventListener("click", goNextFloor);

  el.retreatBtn.addEventListener("click", () => {
    onRetreat();
  });

  // ---------------- Render: battle ----------------
  function renderBattle() {
    const enemy = enemyForFloor(game.floor);
    el.floorLabel.textContent = (game.floor > FINAL_FLOOR ? `階層 ${game.floor}（エンドレス）` : `階層 ${game.floor} / ${FINAL_FLOOR}`) + `　Lv.${save.level}`
      + (trialSealed() ? `　苦難：${activeTrialDefs().length > 1 ? activeTrialDefs().length + "つ同時" : activeTrialDefs()[0].name}` : "");
    el.enemyName.textContent = enemy.name;
    el.enemyName.classList.toggle("boss", enemy.isBoss);
    el.enemyBar.classList.toggle("boss", enemy.isBoss);
    el.enemyVisual.classList.toggle("boss", enemy.isBoss);
    // regular floors show the dungeon backdrop; boss floors keep a plain black one for a more dramatic look
    el.enemyVisual.classList.toggle("has-backdrop", !enemy.isBoss);
    el.enemyVisual.classList.toggle("boss-bg", enemy.isBoss);
    if (el.enemyVisual.dataset.art !== enemy.art) {
      el.enemyVisual.dataset.art = enemy.art;
      el.enemyVisual.innerHTML = `<img src="${enemy.art}" alt="${enemy.name}">`;
    }
    el.enemyHpNow.textContent = fmt(game.enemyHp);
    el.enemyHpMax.textContent = fmt(game.enemyHpMax);
    el.enemyBar.style.width = enemyHpPct() + "%";
    el.enemyHpUnit.textContent = game.enemyHpMax.gte(1e4) ? `（最大HP ${jpUnitText(game.enemyHpMax)}）` : "";
    el.statN.textContent = game.n;
    el.statAtk.textContent = fmt(currentAtk());
    // the full multiplier the next attack/special will get, so base multiplier / exponent progress is
    // visible even with no buff stored; highlighted only while a buff (or a gamble's miss) is pending
    el.statBuff.textContent = "×" + fmtMult(damageMultiplier());
    el.statBuff.classList.toggle("buff-active", game.buffBonus !== 0);
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
    game.hand.forEach((card, handIndex) => {
      const spent = card.type === "percent" && game.percentUsed;
      const cardClass = "card " + card.type + (card.playing ? " playing" : "") + (spent ? " spent" : "");
      let typeLabel = TYPE_LABELS[card.type] || "バフ";
      let valueLabel;
      if (card.type === "attack") valueLabel = fmt(roundDamage(unbuffedDamageMultiplier().mul(attackBaseDamage(card)))) + " dmg";
      else if (card.type === "draw") valueLabel = "+" + effectiveValue(card) + "枚";
      else if (card.type === "percent") valueLabel = spent ? "この階は使用済み" : Math.round(effectiveValue(card) * 100) + "%";
      else if (card.type === "special") valueLabel = fmt(roundDamage(unbuffedDamageMultiplier().mul(specialCardRaw(card)))) + " dmg";
      else if (card.type === "poison") valueLabel = "猛毒付与";
      else if (card.type === "chain") {
        const count = game.hand.filter((c) => c.uid !== card.uid && c.type !== "chain" && Array.isArray(c.tags) && c.tags.includes(card.targetTag)).length;
        valueLabel = count + "枚連鎖";
      } else if (card.randomValues) valueLabel = card.randomValues.map((v) => "×" + fmtMult(buffApplied(v))).join(" / ");
      else valueLabel = "×" + fmtMult(buffApplied(effectiveValue(card)));
      // always render both slots (even empty) so a card's name/value line lands in the same
      // spot regardless of whether this particular card happens to have a rank or crit note
      const rankBadge = `<div class="card-rank">${card.rank ? "Lv." + card.rank : ""}</div>`;
      const critNote = `<div class="card-crit-note">${(card.critRateBonus || card.critDmgBonus) ? `会心+${card.critRateBonus || 0}%/ダメ+${card.critDmgBonus || 0}%` : ""}</div>`;
      const keyBadge = handIndex < 9 ? `<div class="card-key">${handIndex + 1}</div>` : "";
      const contentHtml = `${keyBadge}<div class="card-type">${typeLabel}</div><div class="card-name">${card.name}</div>${rankBadge}<div class="card-value">${valueLabel}</div>${critNote}`;

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
        inner.appendChild(back);
        inner.appendChild(front);
        outer.appendChild(inner);
        // the handler goes on the outer, which never rotates: the faces spin during the reveal and
        // a rotated-away face is not hit-testable, so a handler on .card-front is dead for the
        // ~1.1s the animation runs (see .card-flip-face { pointer-events: none } in style.css)
        outer.addEventListener("click", () => playCard(card.uid));
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
      void node.offsetWidth; // flush the start position so the transition below has something to animate from
      node.style.transition = `transform ${FLIP_SLIDE_MS}ms ease`;
      node.style.transform = "";
      setTimeout(() => { node.style.transition = ""; }, FLIP_SLIDE_MS);
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
    el.homeLevelLabel.textContent = save.level;
    el.homeExpLabel.textContent = `（次まで ${expRemainingText()}）`;
    el.bestFloorLabel.textContent = save.bestFloor > 0 ? save.bestFloor : "-";
    el.homePointsLabel.textContent = fmt(save.points);
    el.homeTranscendStat.style.display = save.transcendUnlocked ? "inline" : "none";
    el.homeTranscendLabel.textContent = fmt(save.transcendPoints);
    el.openPanelBtn.style.display = save.transcendUnlocked ? "block" : "none";
    el.openPanelPreviewBtn.style.display = save.transcendUnlocked && !trialSealed() ? "block" : "none";
    el.openCardShopBtn.style.display = cardShopUnlocked() ? "block" : "none";
    const trials = activeTrialDefs();
    el.trialBanner.style.display = trials.length ? "" : "none";
    if (trials.length) {
      el.trialBannerText.textContent = `苦難に挑戦中：${trials.map((t) => `${t.name}（${"★".repeat(t.stars)}）`).join("・")}　`
        + `制限：${trialRuleTexts(trials).slice(1).join("／")}`;
    }
    renderHomeSeals();
    // once a remnant exists, 基本強化+デッキ強化 merge into one tabbed プレイヤー強化 and the
    // デッキ強化 slot becomes 残滓強化 (during a 苦難 the remnants are sealed, so it goes back to デッキ強化)
    const hasRemnants = activeRemnantCount() > 0;
    el.openTreeBtn.textContent = hasRemnants ? "プレイヤー強化" : "基本強化を見る";
    const canBuy = NODES.some((n) => nodeState(n) === "available");
    el.openTreeBtn.classList.toggle("pulse", canBuy);
    if (canBuy) el.openTreeBtn.insertAdjacentHTML("beforeend", `<span class="btn-badge">習得可能</span>`);
    el.openDeckUpgradeBtn.textContent = hasRemnants ? "残滓強化" : "デッキ強化を見る";
    const remnantBuyable = hasRemnants && remnantAffordable();
    el.openDeckUpgradeBtn.classList.toggle("pulse", remnantBuyable);
    if (remnantBuyable) el.openDeckUpgradeBtn.insertAdjacentHTML("beforeend", `<span class="btn-badge">強化可能</span>`);
  }

  // tabs appear only once remnants exist; each tab just switches to its own existing screen
  const TAB_GROUPS = {
    player: [["tree", "基本強化"], ["treeExt", "拡張強化"], ["deckUpgrade", "デッキ強化"]],
    remnant: [["remnants", "残滓"], ["remnantTree", "残滓スキルツリー"]],
  };
  // the player tabs also appear (without remnants) once 魂の拡張 has added the 拡張強化 tab
  function tabVisible(screen) { return screen !== "treeExt" || treeExtUnlocked().length > 0; }
  function tabGroupVisible(group) { return activeRemnantCount() > 0 || (group === "player" && treeExtUnlocked().length > 0); }
  function openScreen(name) {
    showScreen(name);
    if (name === "tree") { renderTree(); centerTreeOnRoot(); }
    else if (name === "deckUpgrade") renderDeckZone();
    else if (name === "remnants") renderRemnants();
    else if (name === "remnantTree") renderRemnantTree();
    else if (name === "treeExt") renderTreeExt();
    renderTabBars(name);
  }
  function renderTabBars(current) {
    document.querySelectorAll(".tab-bar").forEach((bar) => {
      bar.style.display = tabGroupVisible(bar.dataset.group) ? "" : "none";
      bar.innerHTML = "";
      TAB_GROUPS[bar.dataset.group].filter(([screen]) => tabVisible(screen)).forEach(([screen, label]) => {
        const b = document.createElement("button");
        b.className = "tab-btn" + (screen === current ? " active" : "");
        b.textContent = label;
        b.addEventListener("click", () => { if (screen !== current) openScreen(screen); });
        bar.appendChild(b);
      });
    });
  }

  function renderTreeExt() {
    el.treeExtPointsLabel.textContent = fmt(save.points);
    el.treeExtList.innerHTML = "";
    treeExtUnlocked().forEach((def) => {
      const level = treeExtLevel(def);
      const cost = treeExtCost(def);
      const total = def.multiplicative ? fmtMult(Math.pow(def.perLevel, level)) : fmtMult(def.perLevel * level);
      const row = document.createElement("div");
      row.className = "deck-zone-row";
      row.innerHTML = `
        <div class="dz-info">
          <div class="dz-name">${def.label} Lv.${level}</div>
          <div class="dz-meta">1段ごとに ${def.unit.replace("{v}", fmtMult(def.perLevel))}（現在 ${def.unit.replace("{v}", total)}）</div>
        </div>
        <div class="dz-actions"><button class="dz-btn" data-action="buy">強化 ${fmt(cost)}pt</button></div>`;
      const btn = row.querySelector("[data-action=buy]");
      btn.disabled = save.points < cost;
      btn.addEventListener("click", () => {
        if (save.points < treeExtCost(def)) return;
        save.points -= treeExtCost(def);
        save.treeExt[def.id] = level + 1;
        persistSave();
        renderTreeExt();
      });
      el.treeExtList.appendChild(row);
    });
  }

  // the achievements screen groups entries by what they reward you for; hidden ones get their own group
  const ACHIEVEMENT_GROUPS = [
    ["tower", "塔の踏破", (a) => /^(floor|boss)\d/.test(a.id)],
    ["hit", "一撃のダメージ", (a) => a.id.startsWith("hit")],
    ["level", "レベル", (a) => /^lv\d/.test(a.id)],
    ["count", "討伐・挑戦", (a) => a.id.startsWith("kills") || a.id.startsWith("runs")],
    ["crit", "会心", (a) => a.id.startsWith("crit")],
    ["reinc", "転生・残滓", (a) => a.id.startsWith("reinc") || a.id.startsWith("remnant")],
    ["trial", "苦難", (a) => a.id.startsWith("trial")],
    ["growth", "強化・蓄え", (a) => /^(ext|deck|souls|transcend)/.test(a.id)],
    ["meta", "実績", (a) => a.id.startsWith("ach")],
  ];
  function achievementGroupOf(a) {
    if (a.hidden) return "hidden";
    const g = ACHIEVEMENT_GROUPS.find(([, , test]) => test(a));
    return g ? g[0] : "meta";
  }
  function renderAchievements() {
    const done = ACHIEVEMENTS.filter((a) => save.achievements[a.id]).length;
    el.achievementsCountLabel.textContent = `${done} / ${ACHIEVEMENTS.length}`;
    const totals = Object.keys(ACHIEVEMENT_BONUS_LABELS).map((k) => [k, achievementBonus(k)]).filter(([, v]) => v > 0);
    el.achievementsTotal.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "ach-progress";
    bar.innerHTML = `<div class="ach-progress-fill" style="width:${(done / ACHIEVEMENTS.length) * 100}%"></div>`;
    el.achievementsTotal.appendChild(bar);
    const chips = document.createElement("div");
    chips.className = "ach-total-chips";
    chips.innerHTML = totals.length
      ? totals.map(([k, v]) => `<span class="ach-chip">${ACHIEVEMENT_BONUS_LABELS[k]} +${fmt(v)}%</span>`).join("")
      : `<span class="ach-chip dim">まだ効果はない</span>`;
    el.achievementsTotal.appendChild(chips);

    el.achievementsList.innerHTML = "";
    ACHIEVEMENT_GROUPS.concat([["hidden", "隠し実績"]]).forEach(([key, label]) => {
      const list = ACHIEVEMENTS.filter((a) => achievementGroupOf(a) === key);
      if (!list.length) return;
      const got = list.filter((a) => save.achievements[a.id]).length;
      const sec = document.createElement("section");
      sec.className = "ach-group";
      sec.innerHTML = `<div class="ach-group-head"><span class="ach-group-name">${label}</span><span class="ach-group-count">${got} / ${list.length}</span></div>`;
      const grid = document.createElement("div");
      grid.className = "ach-grid";
      list.forEach((a) => {
        const have = !!save.achievements[a.id];
        const secret = a.hidden && !have;
        const card = document.createElement("div");
        card.className = "ach-card" + (have ? " done" : "") + (secret ? " secret" : "");
        card.innerHTML = `
          <div class="ach-card-top"><span class="ach-mark">${have ? "✦" : "◇"}</span><span class="ach-name">${secret ? "？？？" : a.name}</span></div>
          <div class="ach-desc">${secret ? "条件は秘密" : a.desc}</div>
          <div class="ach-reward">${secret ? "？？？" : bonusText(a.bonus)}</div>`;
        grid.appendChild(card);
      });
      sec.appendChild(grid);
      el.achievementsList.appendChild(sec);
    });
  }

  function renderRemnants() {
    ensureRemnantDecks();
    el.remnantsPointsLabel.textContent = fmt(save.transcendPoints);
    const rate = idleRatePerMinute();
    const capHours = idleCapMs() / 3600000;
    el.remnantIdleInfo.textContent = rate
      ? `放置収入：経験値 ${fmt(rate.exp)}／分・ソウル ${fmt(rate.souls)}／分（最大 ${fmtMult(capHours)}時間分まで貯まる）`
      : `放置収入：なし（階層を1つでもクリアすると稼ぎ始める。最大 ${fmtMult(capHours)}時間分まで貯まる）`;
    el.remnantList.innerHTML = "";
    save.remnantDecks.slice(0, remnantCount()).forEach((deck, i) => {
      const box = document.createElement("div");
      box.className = "remnant-box";
      box.innerHTML = `<div class="remnant-name">${REMNANT_NAMES[i]}</div><div class="remnant-meta">あなたが攻撃するたび、そのダメージの一部で追撃する</div>`;
      deck.forEach((def) => {
        const cost = remnantRankCost(def);
        const row = document.createElement("div");
        row.className = "deck-zone-row";
        row.innerHTML = `
          <div class="dz-info">
            <div class="dz-name">${def.name}</div>
            <div class="dz-meta">追撃 ${fmtMult(remnantCardShare(def))}% / ${def.count}枚${def.rank ? " / Lv." + def.rank : ""}</div>
          </div>
          <div class="dz-actions"><button class="dz-btn" data-action="rank">強化 ${fmt(cost)}pt</button></div>`;
        const btn = row.querySelector("[data-action=rank]");
        btn.disabled = save.transcendPoints < cost;
        btn.addEventListener("click", () => {
          if (save.transcendPoints < cost) return;
          save.transcendPoints -= cost;
          def.rank = (def.rank || 0) + 1;
          persistSave();
          renderRemnants();
        });
        box.appendChild(row);
      });
      el.remnantList.appendChild(box);
    });
  }

  // anything on the 残滓 screens payable with the transcend points on hand (a card rank-up or a tree step)
  function remnantAffordable() {
    ensureRemnantDecks();
    const rankUp = save.remnantDecks.slice(0, remnantCount()).some((deck) => deck.some((def) => save.transcendPoints >= remnantRankCost(def)));
    return rankUp || REMNANT_TREE_BRANCHES.some((b) => b.nodes.some((n) => remnantNodeState(n) === "available"));
  }
  function remnantNodeState(node) {
    if (save.remnantTree[node.id]) return "unlocked";
    if (node.requires && !save.remnantTree[node.requires]) return "locked";
    return save.transcendPoints >= node.cost ? "available" : "unaffordable";
  }
  // with 30 steps per branch, owned steps collapse into one summary line and only the next few show
  const REMNANT_TREE_PREVIEW = 3;
  function renderRemnantTree() {
    el.remnantTreePointsLabel.textContent = fmt(save.transcendPoints);
    el.remnantTreeGrid.innerHTML = "";
    REMNANT_TREE_BRANCHES.forEach((branch) => {
      const col = document.createElement("div");
      col.className = "rt-branch";
      const owned = branch.nodes.filter((n) => save.remnantTree[n.id]).length;
      const total = remnantTreeBonus(branch.key);
      col.innerHTML = `<div class="rt-branch-title">${branch.label}</div>
        <div class="rt-summary">${owned} / ${branch.nodes.length} 段（合計 ${branch.unit.replace("{v}", fmt(total))}）</div>`;
      branch.nodes.forEach((node, i) => {
        const state = remnantNodeState(node);
        if (state === "unlocked") return;
        const firstOpen = branch.nodes.findIndex((n) => !save.remnantTree[n.id]);
        if (i >= firstOpen + REMNANT_TREE_PREVIEW) return;
        const div = document.createElement("div");
        div.className = "rt-node " + state;
        div.innerHTML = `<div class="tn-name">${branch.label} ${i + 1}</div><div class="tn-desc">${node.desc}</div><div class="tn-cost">${fmt(node.cost)}pt</div>`;
        if (state === "available") {
          div.addEventListener("click", () => {
            if (remnantNodeState(node) !== "available") return;
            save.transcendPoints -= node.cost;
            save.remnantTree[node.id] = true;
            persistSave();
            renderRemnantTree();
          });
        }
        col.appendChild(div);
      });
      if (owned === branch.nodes.length) col.insertAdjacentHTML("beforeend", `<div class="rt-node unlocked"><div class="tn-name">全段習得済み</div></div>`);
      el.remnantTreeGrid.appendChild(col);
    });
  }

  function leavePanel() {
    if (!panelViewOnly && save.trialPending) {
      if (trialsUnlockedCount() > 0) { openTrials(); return; }
      save.trialPending = false;
      persistSave();
    }
    showScreen("home");
    renderHome();
  }
  function openTrials() {
    showScreen("trial");
    renderTrials();
  }
  let trialSelection = []; // ids picked on the 苦難 screen, at most one per direction
  function renderTrials() {
    el.trialClearedLabel.textContent = `${trialsClearedCount()} / ${TRIALS.length}`;
    trialSelection = trialSelection.filter((id) => { const t = TRIALS.find((x) => x.id === id); return t && trialOpen(t); });
    const picked = trialSelection.map((id) => TRIALS.find((t) => t.id === id));
    // the sticky bar: what's picked, all of it combined, and the two ways forward
    el.trialSelection.innerHTML = picked.length
      ? `<b>${picked.length}つ選択中</b>：${picked.map((t) => t.name).join("・")}<div class="trial-selection-rules">${trialRuleTexts(picked).slice(1).join("／")}</div>`
      : "挑む苦難を選んでいない（複数選べる。各方向1段階まで）";
    el.trialStartBtn.disabled = !picked.length;
    el.trialStartBtn.textContent = picked.length ? `選んだ${picked.length}つの苦難に挑む` : "選んだ苦難に挑む";
    const best = save.trialComboBest || 0;
    el.trialCombo.innerHTML = "同時挑戦ボーナス（初めてその数を同時に越えたとき）："
      + [2, 3, 4, 5, 6, 7, 8].map((k) => `<span class="${k <= best ? "got" : ""}">${k}つ→全ダメージ×${k}</span>`).join("");
    el.trialList.innerHTML = "";
    TRIAL_CATEGORIES.forEach((cat) => {
      const group = document.createElement("div");
      group.className = "trial-cat";
      const head = document.createElement("div");
      head.className = "trial-cat-head";
      head.innerHTML = `<span class="trial-cat-name">${cat.name}</span><span class="trial-cat-theme">${cat.theme}</span>`;
      group.appendChild(head);
      const row = document.createElement("div");
      row.className = "trial-row";
      TRIALS.filter((t) => t.cat === cat).forEach((t) => {
        const open = trialOpen(t);
        const cleared = !!save.trialsCleared[t.id];
        const selected = trialSelection.includes(t.id);
        const card = document.createElement("div");
        card.className = "trial-card" + (open ? "" : " locked") + (cleared ? " cleared" : "") + (selected ? " selected" : "");
        const lockText = t.level > trialsUnlockedCount() ? `苦難の門 ${t.level}段目で解放` : `「${TRIAL_LEVEL_NAMES[t.level - 2]}」を越えると解放`;
        card.innerHTML = `
          <div class="trial-head"><span class="trial-name">${t.name}</span><span class="trial-stars">${"★".repeat(t.stars)}</span></div>
          <ul class="trial-rules">${trialRuleTexts(t).slice(1).map((r) => `<li>${r}</li>`).join("")}</ul>
          <div class="trial-foot">
            <span class="trial-reward">報酬：${t.rewardText}${cleared ? "（獲得済み）" : ""}</span>
            <span class="trial-pick">${!open ? lockText : selected ? "✔ 選択中" : "選ぶ"}</span>
          </div>`;
        if (open) {
          card.addEventListener("click", () => {
            trialSelection = trialSelection.filter((id) => !id.startsWith(cat.id));
            if (!selected) trialSelection.push(t.id);
            renderTrials();
          });
        }
        row.appendChild(card);
      });
      group.appendChild(row);
      el.trialList.appendChild(group);
    });
  }
  function startTrials(ids) {
    save.activeTrials = ids.slice();
    save.trialPending = false;
    save.points = 0; // the souls 継承の礎 just granted come from the panel, which a 苦難 seals
    bumpStat("trialsStarted");
    trialSelection = [];
    checkAchievements();
    persistSave();
    showScreen("home");
    renderHome();
  }
  el.trialStartBtn.addEventListener("click", () => { if (trialSelection.length) startTrials(trialSelection); });
  el.trialBackBtn.addEventListener("click", () => openPanel(false));
  el.trialSkipBtn.addEventListener("click", () => {
    save.trialPending = false;
    trialSelection = [];
    persistSave();
    showScreen("home");
    renderHome();
  });
  el.abandonTrialBtn.addEventListener("click", async () => {
    const defs = activeTrialDefs();
    if (!defs.length) return;
    if (!(await showConfirm(`苦難（${defs.map((t) => t.name).join("・")}）を放棄します。報酬は得られず、転生パネルの封印が解けます。よろしいですか?`))) return;
    save.activeTrials = [];
    persistSave();
    renderHome();
  });

  // during a 苦難 the panel-given features show as sealed plates (like the festival build's teasers)
  const SEAL_TEXT = "苦難の間は封印されている。苦難を放棄するか、ラスボスを倒すと封印が解ける。";
  function renderHomeSeals() {
    const sealed = [];
    if (trialSealed()) {
      if (save.transcendUnlocked) sealed.push("転生パネル");
      if (remnantCount() > 0) sealed.push("残滓");
      if (panelLevel(PANEL_SHOP_CHAIN) > 0) sealed.push("カードショップ");
      if (panelLevel(PANEL_TREE_EXT_CHAIN) > 0) sealed.push("拡張強化");
    }
    el.homeSealed.style.display = sealed.length ? "" : "none";
    el.homeSealedGrid.innerHTML = "";
    sealed.forEach((name) => {
      const b = document.createElement("button");
      b.className = "sealed-tile";
      b.innerHTML = `<span class="seal-stamp small">封</span><span class="sealed-name"></span>`;
      b.querySelector(".sealed-name").textContent = name;
      b.addEventListener("click", () => showToast(`「${name}」は${SEAL_TEXT}`));
      el.homeSealedGrid.appendChild(b);
    });
  }

  function showIdleReport(result) {
    if (!result || result.minutes < 1) return; // a quick reload isn't worth a notice
    const hours = result.minutes / 60;
    const span = hours >= 1 ? `${fmtMult(hours)}時間` : `${Math.round(result.minutes)}分`;
    const text = `留守中（${span}）に残滓が稼いだ：経験値 ${fmt(result.exp)}・ソウル ${fmt(result.souls)}${result.levels ? `（${result.levels}レベルアップ）` : ""}`;
    el.idleReport.textContent = text;
    showToast(text);
  }

  el.openFloorSelectBtn.addEventListener("click", () => { showScreen("floorSelect"); renderFloorSelect(); });
  el.resetProgressBtn.addEventListener("click", async () => {
    if (!(await showConfirm("進行状況を全てリセットします。所持カード・強化・転生ポイントなど全てのセーブデータが消え、元に戻せません。よろしいですか?"))) return;
    wipingSave = true;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
  el.floorSelectBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  el.openTreeBtn.addEventListener("click", () => openScreen("tree"));
  el.treeBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  el.openDeckUpgradeBtn.addEventListener("click", () => openScreen(activeRemnantCount() > 0 ? "remnants" : "deckUpgrade"));
  el.deckUpgradeBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  el.openAchievementsBtn.addEventListener("click", () => { showScreen("achievements"); renderAchievements(); });
  el.achievementsBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  el.remnantsBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  el.remnantTreeBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  el.treeExtBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  el.openCardShopBtn.addEventListener("click", () => { showScreen("cardShop"); renderCardShop(); });
  el.cardShopBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  // the reincarnation panel's only way out used to be the core node buried in the middle of the
  // pannable map, which is easy to lose track of once you scroll away from it
  el.panelBackBtn.addEventListener("click", leavePanel);
  el.openPanelPreviewBtn.addEventListener("click", () => openPanel(true));
  // reincarnateNow() wipes real progress the instant it runs and persists it, so this gets the same
  // confirm the reset button has. The numbers are spelled out because the title screen only shows
  // the transcend points, not what is about to be given up.
  el.openPanelBtn.addEventListener("click", async () => {
    const message =
      (panelHasAnythingToBuy() ? "" : "※転生パネルにはもう購入できる強化がありません（転生ポイントの使い道がありません）。\n\n") +
      "転生します。\n\n" +
      "【獲得するもの】\n" +
      `・転生ポイント +${fmt(transcendGainForLevel(save.level))}（Lv.${save.level}から）\n\n` +
      "【失われるもの】\n" +
      `・レベル（Lv.${save.level} → 1）\n` +
      `・ソウル（${fmt(save.points)}）\n` +
      "・基本強化（習得済みノード・拡張強化）\n" +
      "・デッキ編成\n" +
      `・最高到達階（${save.bestFloor > 0 ? save.bestFloor + "階" : "なし"}）\n\n` +
      "【引き継がれるもの】\n" +
      `・転生ポイント（${fmt(save.transcendPoints)}）\n` +
      "・転生パネルの強化・実績・残滓・乗り越えた苦難の報酬\n\n" +
      (trialSealed() ? `※挑戦中の苦難（${activeTrialDefs().map((t) => t.name).join("・")}）は達成できないまま終わります。\n\n` : "") +
      "元に戻せません。よろしいですか?";
    if (!(await showConfirm(message))) return;
    reincarnateNow();
  });

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

  // view-only: opened from the title before reincarnating, to see what the points would buy
  let panelViewOnly = false;
  function openPanel(viewOnly) {
    panelViewOnly = viewOnly;
    showScreen("panel");
    renderPanel();
    centerPanelOnCore();
  }
  function panelHasAnythingToBuy() {
    return PANEL_CATEGORIES.some((c) => panelLevel(c) < c.maxLevel)
      || PANEL_CHAINS.some((c) => panelLevel(c) < c.maxLevel)
      || PANEL_SPECIALS.some((sp) => !panelSpecialOwned(sp));
  }

  function renderPanel() {
    el.panelPointsLabel.textContent = fmt(save.transcendPoints)
      + (panelViewOnly ? `（転生すると +${fmt(transcendGainForLevel(save.level))}）` : "");
    el.panelSub.textContent = panelViewOnly
      ? "閲覧のみ：転生すると、ここで転生ポイントを使って強化できる。ここでの強化は転生しても失われない。"
      : "転生した！ソウル・基本強化・デッキは初期状態に戻った。ここでの強化は転生しても失われない。中心の「核」をクリックすると次の周回へ進む。";
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
    PANEL_CHAINS.forEach((chain) => chain.nodeIds.forEach((id, i) => {
      const from = i === 0 ? PANEL_POS.core : PANEL_POS[chain.nodeIds[i - 1]];
      const to = PANEL_POS[id];
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", from.x);
      line.setAttribute("y1", from.y);
      line.setAttribute("x2", to.x);
      line.setAttribute("y2", to.y);
      if (panelLevel(chain) >= i + 1) line.setAttribute("class", "active");
      svg.appendChild(line);
    }));
    // magic-circle backdrop behind everything: a ring per row, the outer rune band, the stars, and the
    // 12 slice borders
    const core = PANEL_POS.core;
    drawMagicBackdrop(svg, core.x, core.y, Array.from({ length: panelRowCount }, (_, row) => PANEL_ROW_START + PANEL_ROW_STEP * row), "panel");
    const deco = document.createElementNS(svgNS, "g");
    deco.setAttribute("class", "panel-circle");
    const outer = PANEL_ROW_START + PANEL_ROW_STEP * (panelRowCount - 0.5);
    for (let i = 0; i < 360 / PANEL_SECTOR_DEG; i++) {
      const rad = ((panelSpokeAngle(i) + PANEL_SECTOR_DEG / 2) * Math.PI) / 180;
      const spoke = document.createElementNS(svgNS, "line");
      spoke.setAttribute("x1", core.x + Math.cos(rad) * (PANEL_ROW_START - PANEL_ROW_STEP / 2));
      spoke.setAttribute("y1", core.y - Math.sin(rad) * (PANEL_ROW_START - PANEL_ROW_STEP / 2));
      spoke.setAttribute("x2", core.x + Math.cos(rad) * outer);
      spoke.setAttribute("y2", core.y - Math.sin(rad) * outer);
      deco.appendChild(spoke);
    }
    svg.insertBefore(deco, svg.firstChild);
    el.panelMap.appendChild(svg);

    const coreDiv = document.createElement("div");
    coreDiv.className = "tree-map-node core";
    coreDiv.style.left = PANEL_POS.core.x + "px";
    coreDiv.style.top = PANEL_POS.core.y + "px";
    coreDiv.innerHTML = EMBLEM_SVG + `<div>核</div><div class="core-sub">次の周回へ</div>`;
    coreDiv.addEventListener("click", leavePanel);
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
        if (state === "available" && !panelViewOnly) {
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
      if (state === "available" && !panelViewOnly) {
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

    PANEL_CHAINS.forEach((chain) => chain.nodeIds.forEach((id, i) => {
      const tier = i + 1;
      const pos = PANEL_POS[id];
      const state = panelChainNodeState(chain, tier);
      const div = document.createElement("div");
      div.className = "tree-map-node " + state;
      div.style.left = pos.x + "px";
      div.style.top = pos.y + "px";
      const costLabel = state === "unlocked" ? "習得済み" : `${fmt(panelTierCost(chain, tier))}pt`;
      div.innerHTML = `<div class="tn-name">${chain.label} ${tier}</div><div class="tn-desc">${chain.nodeDesc(tier)}</div><div class="tn-cost">${costLabel}</div>`;
      if (state === "available" && !panelViewOnly) {
        div.addEventListener("click", () => {
          if (panelChainNodeState(chain, tier) !== "available") return;
          save.transcendPoints -= panelTierCost(chain, tier);
          save.panelLevels[chain.id] = tier;
          if (chain === PANEL_REMNANT_CHAIN) {
            ensureRemnantDecks();
            checkAchievements();
          }
          persistSave();
          renderPanel();
        });
      }
      el.panelMap.appendChild(div);
    }));
  }

  // endless checkpoints follow the same 10-floor rhythm (101, 111, …), each opening once the floor
  // before it (the 100F final boss / a 10F mid-boss) has been cleared since the last reincarnation.
  // Only 101 and the deepest ones are listed, so a very deep save doesn't build thousands of cards.
  const ENDLESS_CHECKPOINTS_SHOWN = 30;
  function endlessCheckpointsAll() {
    const out = [];
    for (let f = FINAL_FLOOR + 1; f - 1 <= save.bestClearedFloor; f += 10) out.push(f);
    return out;
  }
  function endlessCheckpoints() {
    const out = endlessCheckpointsAll();
    return out.length > ENDLESS_CHECKPOINTS_SHOWN ? [out[0]].concat(out.slice(-(ENDLESS_CHECKPOINTS_SHOWN - 1))) : out;
  }

  function renderFloorSelect() {
    el.floorSelectGrid.innerHTML = "";
    FLOOR_CHECKPOINTS.concat(endlessCheckpoints()).forEach((floor) => {
      const isBoss = floor === FINAL_FLOOR;
      const div = document.createElement("div");
      div.className = "floor-select-card" + (isBoss ? " boss" : "");
      const hpPreview = fmt(enemyHpForFloor(floor));
      div.innerHTML = `
        <div class="fs-floor${isBoss ? " boss" : ""}">${isBoss ? "ラスボス" : floor + "階"}</div>
        <div class="fs-hp">${floor > FINAL_FLOOR ? "エンドレス・" : ""}HP ${hpPreview}</div>
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
  const PANEL_ZOOM_MIN = 0.2;
  const PANEL_ZOOM_MAX = 1.5;
  const PANEL_OPEN_ZOOM = 1.3; // opens zoomed in on the core, the same way the basic tree opens on 起点
  const PANEL_OPEN_ZOOM_NARROW = 0.7; // phone width: a little further out so the core's neighbors show too
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

  // a magic circle drawn behind a node map, centered on (cx, cy): the given rings (alternately solid and
  // dotted), a slowly turning outer band of ticks and rune text, and a counter-turning hexagram + octagram.
  // Purely decorative; the nodes keep their positions.
  const MC_RUNES = "✦ MAGIA ✦ ARCANUM ✦ AETERNUM ✦ TURRIS ✦ STELLA ✦ LUMEN ✦ POTENTIA ✦ INFINITAS ";
  function drawMagicBackdrop(svg, cx, cy, rings, idSuffix) {
    const svgNS = "http://www.w3.org/2000/svg";
    const mk = (tag, attrs) => {
      const n = document.createElementNS(svgNS, tag);
      Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
      return n;
    };
    const g = mk("g", { class: "mc-backdrop" });
    rings.forEach((r, i) => g.appendChild(mk("circle", { cx, cy, r, class: i % 2 ? "dash" : "" })));
    const outer = rings[rings.length - 1] + 80;
    const rotor = mk("g", { class: "mc-rotor", style: `transform-origin: ${cx}px ${cy}px` });
    rotor.appendChild(mk("circle", { cx, cy, r: outer }));
    rotor.appendChild(mk("circle", { cx, cy, r: outer - 44, class: "thin" }));
    for (let a = 0; a < 360; a += 4) {
      const rad = (a * Math.PI) / 180;
      const r1 = outer - (a % 20 === 0 ? 16 : 8);
      rotor.appendChild(mk("line", { class: "tick", x1: cx + Math.cos(rad) * outer, y1: cy + Math.sin(rad) * outer, x2: cx + Math.cos(rad) * r1, y2: cy + Math.sin(rad) * r1 }));
    }
    const runeR = outer - 30;
    const pathId = "mcRune-" + idSuffix;
    rotor.appendChild(mk("path", { id: pathId, d: `M ${cx - runeR},${cy} a ${runeR},${runeR} 0 1,1 ${runeR * 2},0 a ${runeR},${runeR} 0 1,1 ${-runeR * 2},0`, fill: "none" }));
    const text = mk("text", { class: "rune" });
    const tp = mk("textPath", { href: "#" + pathId });
    tp.textContent = MC_RUNES.repeat(Math.max(1, Math.ceil((2 * Math.PI * runeR) / (MC_RUNES.length * 15))));
    text.appendChild(tp);
    rotor.appendChild(text);
    g.appendChild(rotor);
    const star = mk("g", { class: "mc-rotor rev", style: `transform-origin: ${cx}px ${cy}px` });
    const starR = rings[Math.min(1, rings.length - 1)];
    const pts = (n, step, r, rot) => Array.from({ length: n }, (_, i) => {
      const t = rot + (i * step * 2 * Math.PI) / n;
      return `${cx + Math.cos(t) * r},${cy + Math.sin(t) * r}`;
    }).join(" ");
    star.appendChild(mk("polygon", { points: pts(3, 1, starR, -Math.PI / 2) }));
    star.appendChild(mk("polygon", { points: pts(3, 1, starR, Math.PI / 2) }));
    star.appendChild(mk("polygon", { class: "thin", points: pts(8, 3, rings[rings.length - 1], 0) }));
    g.appendChild(star);
    svg.insertBefore(g, svg.firstChild);
  }
  // the emblem drawn inside the tree's 起点 and the panel's 核
  const EMBLEM_SVG = `<svg class="emblem-circle" viewBox="0 0 200 200" aria-hidden="true">
    <circle cx="100" cy="100" r="96" /><circle cx="100" cy="100" r="86" class="thin" />
    <polygon points="100,14 175,143 25,143" /><polygon points="100,186 25,57 175,57" />
    <circle cx="100" cy="100" r="50" class="dash" /></svg>`;

  // set when 起点 is bought: the next render plays the tree unfolding outward from it
  let treeRevealPending = false;
  function renderTree() {
    el.treePointsLabel.textContent = fmt(save.points);
    el.treeMap.innerHTML = "";

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "tree-map-svg");
    svg.setAttribute("viewBox", `0 0 ${TREE_CANVAS_WIDTH} ${TREE_CANVAS_HEIGHT}`);

    // until 起点 is learned only it is shown: the rest of the tree unfolds out of it on purchase
    const opened = !!save.unlockedNodes.root;
    const reveal = treeRevealPending;
    treeRevealPending = false;
    const rootPos = TREE_POS.root;
    const revealDelay = (pos) => (Math.hypot(pos.x - rootPos.x, pos.y - rootPos.y) / 1500 + 0.35).toFixed(2) + "s";
    if (opened) {
      const maxR = Math.max(...Object.values(TREE_POS).map((q) => Math.hypot(q.x - rootPos.x, q.y - rootPos.y)));
      const rings = [150, 300];
      for (let r = 440; r < maxR + 60; r += 140) rings.push(r);
      drawMagicBackdrop(svg, rootPos.x, rootPos.y, rings, "tree");
    }
    NODES.forEach((node) => {
      const fromId = node.requires || "root";
      if (fromId === node.id || !opened) return; // the root node itself has no incoming line to draw
      const from = TREE_POS[fromId];
      const to = TREE_POS[node.id];
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", from.x);
      line.setAttribute("y1", from.y);
      line.setAttribute("x2", to.x);
      line.setAttribute("y2", to.y);
      const cls = [save.unlockedNodes[node.id] ? "active" : "", reveal ? "reveal" : ""].filter(Boolean).join(" ");
      if (cls) line.setAttribute("class", cls);
      if (reveal) line.style.setProperty("--rd", revealDelay(from));
      svg.appendChild(line);
    });
    el.treeMap.appendChild(svg);

    NODES.forEach((node) => {
      const isRoot = node.id === "root";
      if (!opened && !isRoot) return;
      const pos = TREE_POS[node.id];
      const state = nodeState(node);
      const div = document.createElement("div");
      div.className = "tree-map-node " + state + (isRoot ? " root-node" : "") + (reveal && !isRoot ? " reveal" : "");
      if (reveal && !isRoot) div.style.setProperty("--rd", revealDelay(pos));
      div.style.left = pos.x + "px";
      div.style.top = pos.y + "px";
      const costLabel = state === "unlocked" ? "習得済み" : `${node.cost}pt`;
      div.innerHTML = (isRoot ? EMBLEM_SVG : "") + `<div class="tn-name">${node.label}</div><div class="tn-desc">${node.desc}</div><div class="tn-cost">${costLabel}</div>`;
      if (isRoot && !opened) {
        const hint = document.createElement("div");
        hint.className = "root-hint";
        hint.style.left = pos.x + "px";
        hint.style.top = (pos.y + 118) + "px";
        hint.textContent = state === "available" ? "起点に触れて、基本強化の封印を解こう" : "塔に挑んでソウルを集め、起点を習得しよう（1pt）";
        el.treeMap.appendChild(hint);
      }
      if (state === "available") {
        div.addEventListener("click", () => {
          save.points -= node.cost;
          save.unlockedNodes[node.id] = true;
          if (isRoot) {
            treeRevealPending = true;
            playRootBurst(pos);
          }
          // startCards nodes grant their cards to the permanent deck once, right here at
          // purchase time (not re-applied every run), so they're real deck members that can
          // later be ranked up / deleted from the title-screen deck upgrade screen too.
          if (node.kind === "startCards") {
            node.cards.forEach((c) => addCardToDeckDefs(save.deckDefs, c));
          } else if (node.kind === "grantPoints") {
            save.points += node.pointsGrant;
          } else if (node.kind === "autoBuy") {
            save.autoBuyEnabled = true;
          }
          persistSave();
          renderTree();
        });
      }
      el.treeMap.appendChild(div);
    });
  }
  // 起点 awakening: a flash and light rings racing outward, while the tree draws itself in behind them
  function playRootBurst(pos) {
    for (let i = 0; i < 3; i++) {
      const ring = document.createElement("div");
      ring.className = "root-burst";
      ring.style.left = pos.x + "px";
      ring.style.top = pos.y + "px";
      ring.style.animationDelay = (i * 0.18) + "s";
      el.treeMap.appendChild(ring);
      setTimeout(() => ring.remove(), 1800);
    }
    const flash = document.createElement("div");
    flash.className = "screen-flash flash-huge";
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 450);
  }

  // ---------------- Title: the staff ----------------
  // light motes rising from the orb (size/drift/speed varied per mote), and a burst when it's clicked
  const staffEl = document.getElementById("homeStaff");
  const staffSparks = document.getElementById("staffSparks");
  const rand = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 24; i++) {
    const s = document.createElement("i");
    const t = rand(2.6, 4.8);
    s.style.setProperty("--s", rand(3, 7).toFixed(1) + "px");
    s.style.setProperty("--x", rand(-9, 9).toFixed(1) + "vh");
    s.style.setProperty("--y", rand(-26, -9).toFixed(1) + "vh");
    s.style.setProperty("--t", t.toFixed(2) + "s");
    s.style.setProperty("--d", (-rand(0, t)).toFixed(2) + "s");
    staffSparks.appendChild(s);
  }
  staffEl.addEventListener("click", () => {
    staffEl.classList.remove("flash");
    void staffEl.offsetWidth;
    staffEl.classList.add("flash");
    for (let i = 0; i < 26; i++) {
      const s = document.createElement("i");
      const angle = (i / 26) * Math.PI * 2 + rand(-0.15, 0.15);
      const dist = rand(9, 22);
      s.className = "burst";
      s.style.setProperty("--s", rand(4, 9).toFixed(1) + "px");
      s.style.setProperty("--x", (Math.cos(angle) * dist).toFixed(1) + "vh");
      s.style.setProperty("--y", (Math.sin(angle) * dist).toFixed(1) + "vh");
      staffSparks.appendChild(s);
      setTimeout(() => s.remove(), 950);
    }
  });

  // ---------------- Title: what each menu button does ----------------
  // landscape with a mouse: hovering a button stretches the menu box to the right and writes the
  // description into the new space. Touch: a long press shows it as a bubble (and doesn't press the button).
  const MENU_DESC = {
    openFloorSelectBtn: () => "チェックポイントを選んで塔を登る。倒した敵の階数の合計がソウルになり、敗北してもソウルとレベルは残る。",
    openTreeBtn: () => (activeRemnantCount() > 0
      ? "基本強化ツリー・拡張強化・デッキ強化をまとめて開く。ソウルで永続的な強化を習得できる。"
      : "ソウルを使って基本強化ツリーのノードを習得する。攻撃力・会心・獲得金額などが永続的に上がる。"),
    openDeckUpgradeBtn: () => (activeRemnantCount() > 0
      ? "残滓のカード強化と、全ての残滓に共通の残滓スキルツリー。転生ポイントを使い、転生しても失われない。"
      : "カードの強化・削除と、デッキに入れる枚数の編成（デッキは最低9枚）。"),
    openCardShopBtn: () => "ソウルで強力なカードを買ってデッキに加える。同じカードは買うたびに値上がりする。",
    openAchievementsBtn: () => "達成した実績の一覧。効果は全て足し算で、転生しても失われない。",
    openPanelPreviewBtn: () => "転生パネルを覗き見る（購入は転生した後）。転生でもらえる転生ポイントも確認できる。",
    openPanelBtn: () => `レベルに応じた転生ポイント（いまなら +${fmt(transcendGainForLevel(save.level))}）を得て、ソウル・基本強化・デッキを手放して最初からやり直す。`,
  };
  const menuBox = el.openFloorSelectBtn.parentElement;
  const hoverMenuMQ = window.matchMedia("(hover: hover) and (pointer: fine) and (orientation: landscape) and (min-width: 861px)");
  function menuLabel(btn) { return [...btn.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim(); }
  Object.keys(MENU_DESC).forEach((id) => {
    const btn = el[id];
    btn.addEventListener("mouseenter", () => {
      if (!hoverMenuMQ.matches) return;
      el.menuDescTitle.textContent = menuLabel(btn);
      el.menuDescText.textContent = MENU_DESC[id]();
      menuBox.classList.add("show-desc");
    });
    let pressTimer = null;
    let longPressed = false;
    btn.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      longPressed = false;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => { longPressed = true; showMenuTip(btn, MENU_DESC[id]()); }, 450);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => btn.addEventListener(ev, () => clearTimeout(pressTimer)));
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
    // a long press only explains; it must not also fire the button
    btn.addEventListener("click", (e) => {
      if (!longPressed) return;
      longPressed = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
  });
  menuBox.addEventListener("mouseleave", () => menuBox.classList.remove("show-desc"));
  let menuTipTimer = null;
  function showMenuTip(btn, text) {
    document.querySelectorAll(".menu-tip").forEach((t) => t.remove());
    const tip = document.createElement("div");
    tip.className = "menu-tip";
    const title = document.createElement("div");
    title.className = "menu-tip-title";
    title.textContent = menuLabel(btn);
    const body = document.createElement("div");
    body.textContent = text;
    tip.appendChild(title);
    tip.appendChild(body);
    document.body.appendChild(tip);
    const r = btn.getBoundingClientRect();
    const top = r.top - tip.offsetHeight - 8;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - tip.offsetWidth - 8, r.left + r.width / 2 - tip.offsetWidth / 2)) + "px";
    tip.style.top = (top > 8 ? top : r.bottom + 8) + "px";
    clearTimeout(menuTipTimer);
    menuTipTimer = setTimeout(() => tip.remove(), 3500);
    document.addEventListener("pointerdown", () => tip.remove(), { once: true, capture: true });
  }

  // ---------------- Keyboard (tempo) ----------------
  // battle: 1-9 play the hand from the left / shop: Enter = next floor / defeat・retreat: Enter = retry
  document.addEventListener("keydown", (e) => {
    if (el.confirmOverlay.classList.contains("active") || e.repeat) return;
    if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
    const active = document.querySelector(".screen.active");
    const screen = active ? active.id.replace("screen-", "") : "";
    if (screen === "battle" && game && /^[1-9]$/.test(e.key)) {
      const card = game.hand[Number(e.key) - 1];
      if (card) playCard(card.uid);
    } else if (screen === "floorClear" && e.key === "Enter") {
      e.preventDefault();
      goNextFloor();
    } else if ((screen === "defeat" || screen === "retreat") && e.key === "Enter") {
      e.preventDefault();
      retryRun();
    }
  });

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
      "screen-achievements": renderAchievements,
      "screen-remnants": renderRemnants,
      "screen-remnantTree": renderRemnantTree,
      "screen-treeExt": renderTreeExt,
    };
    const active = document.querySelector(".screen.active");
    const render = active && renderers[active.id];
    if (render) render();
  }

  // gold only shows up on the battle screen and on the floor-clear shop. renderBattle() rebuilds
  // the whole hand (and drives its flip animations), so the battle screen gets just the one label
  // updated; the shop needs the full re-render because what you can afford depends on gold.
  function refreshRunGold() {
    const active = document.querySelector(".screen.active");
    if (!active) return;
    if (active.id === "screen-battle") el.battleGold.textContent = fmt(game.gold);
    else if (active.id === "screen-floorClear") renderShop();
  }

  function writeGold(n) {
    // gold lives on the run object, not in the save: outside a run there is nothing to set
    if (!game) {
      console.warn("[mt] ゴールドはラン中のみ設定できます（「塔に挑む」でランを開始してください）");
      return null;
    }
    const value = Number(n);
    if (!Number.isFinite(value)) {
      console.warn("[mt] 数値を渡してください。例: mt.gold = 9999");
      return game.gold;
    }
    game.gold = Math.max(0, Math.floor(value));
    refreshRunGold();
    console.info("[mt] ゴールド =", fmt(game.gold));
    return game.gold;
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
    console.info("[mt] ソウル =", fmt(save.points));
    return save.points;
  }

  function writeTranscend(n) {
    const value = Number(n);
    if (!Number.isFinite(value)) {
      console.warn("[mt] 数値を渡してください。例: mt.transcend = 9999");
      return save.transcendPoints;
    }
    save.transcendPoints = Math.max(0, Math.floor(value));
    persistSave();
    refreshActiveScreen();
    console.info("[mt] 転生ポイント =", fmt(save.transcendPoints));
    // the title hides both the transcend readout and the 転生 button until the final boss has been
    // beaten once, so points set before that are real but have nowhere to be spent
    if (!save.transcendUnlocked) {
      console.warn("[mt] 転生パネルは未解放です。開くには mt.unlockTranscend() を実行してください");
    }
    return save.transcendPoints;
  }

  // normally set by beating the final boss; needed to reach the panel at all
  function unlockTranscend() {
    save.transcendUnlocked = true;
    persistSave();
    refreshActiveScreen();
    console.info("[mt] 転生パネルを解放しました（タイトルに「転生」ボタンが出ます）");
    return true;
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
      // null outside a run rather than a warning, so devtools autocomplete can preview it quietly
      get gold() { return game ? game.gold : null; },
      set gold(n) { writeGold(n); },
      setGold(n) { return writeGold(n); },
      addGold(n) { return game ? writeGold(game.gold + Number(n || 0)) : writeGold(n); },
      get transcend() { return save.transcendPoints; },
      set transcend(n) { writeTranscend(n); },
      setTranscend(n) { return writeTranscend(n); },
      addTranscend(n) { return writeTranscend(save.transcendPoints + Number(n || 0)); },
      // experience goes through the normal level-up path (achievement bonus included)
      get level() { return save.level; },
      addExp(n) {
        const levels = gainExp(Number(n || 0));
        persistSave();
        refreshActiveScreen();
        console.info("[mt] Lv." + save.level + "（+" + levels + "）");
        return save.level;
      },
      unlockTranscend() { return unlockTranscend(); },
      help() {
        console.info(
          [
            "マギア・タワー デバッグコンソール",
            "",
            "ソウル（永続・自動セーブ）",
            "  mt.points            現在値を表示",
            "  mt.points = 9999     設定",
            "  mt.addPoints(500)    加算（マイナスで減算）",
            "  mt.setPoints(0)      mt.points = 0 と同じ",
            "",
            "ゴールド（ラン中のみ・セーブされません）",
            "  mt.gold              現在値を表示（ラン外は null）",
            "  mt.gold = 9999       設定",
            "  mt.addGold(500)      加算（マイナスで減算）",
            "  mt.setGold(0)        mt.gold = 0 と同じ",
            "",
            "転生ポイント（永続・自動セーブ）",
            "  mt.transcend         現在値を表示",
            "  mt.transcend = 9999  設定",
            "  mt.addTranscend(500) 加算（マイナスで減算）",
            "  mt.setTranscend(0)   mt.transcend = 0 と同じ",
            "  mt.unlockTranscend() 転生パネルを解放（通常はラスボス撃破で解放）",
            "",
            "レベル（永続・自動セーブ、転生でリセット）",
            "  mt.level             現在のレベルを表示",
            "  mt.addExp(1e6)       経験値を加算（レベルアップ処理あり）",
            "",
            "変更は開いている画面に即座に反映されます。",
          ].join("\n")
        );
      },
    };
    console.info("[mt] デバッグコンソール有効。使い方は mt.help()");
  }

  // ---------------- Init ----------------
  showScreen("home");
  showIdleReport(settleIdle(true)); // time spent closed (capped) is paid out by the remnants on load
  renderHome();
  if (save.trialPending) {
    if (trialsUnlockedCount() > 0) openTrials();
    else { save.trialPending = false; persistSave(); }
  }
  // while visible: just keep lastSeen fresh (so a crash/kill without pagehide pays nothing extra)
  setInterval(() => { if (document.visibilityState === "visible") settleIdle(false); }, IDLE_TICK_MS);
  // hiding stamps the time; coming back pays for the hidden stretch the same way a reload would
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { settleIdle(false); return; }
    const result = settleIdle(true);
    showIdleReport(result);
    if (result && document.getElementById("screen-home").classList.contains("active")) renderHome();
  });
  // closing a tab that was already hidden must keep the stamp from when it was hidden, or that whole
  // hidden stretch is never paid
  window.addEventListener("pagehide", () => {
    if (document.visibilityState === "visible") save.lastSeen = Date.now();
    persistSave();
  });
})();
