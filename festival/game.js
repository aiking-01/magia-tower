// マギア・タワー 文化祭体験版
// 本編（../game.js）を土台に、ラスボス討伐までを15〜20分に縮めた別バージョン。
// 本編との主な違い:
//   - 塔は30階（10・20階が中ボス、30階がラスボス）。敵HPは階が進むほど加速度的に増え、ラスボスは1E+100（1グーゴル）
//   - ダメージ = (威力 × 倍率 × 会心)^累乗。攻撃力はレベル1ごとに×1.5、累乗は基本強化で上がるので、数字が爆発的に伸びる
//   - アニメーションを短くし、数字キー操作・自動購入（初期ON）・敗北画面から直接強化へ、でテンポを上げた
//   - 転生・残滓・デッキ強化・カードショップ・実績・エンドレスは「封印」として見せるだけ（完全版の予告）
//   - 展示用にプレイ時間の計測・クリアタイムのランキング・「次の人へ」リセットを追加
// セーブは本編と別キー。本編のセーブには一切触れない。
(function () {
  const STORAGE_KEY = "magiaTower.festival.v1";
  const RANKING_KEY = "magiaTower.festival.ranking.v1"; // 「次の人へ」で消えないよう、セーブとは別に保存
  const BASE_ATK = 10;
  const BASE_N = 5;
  const BASE_HAND = 5;
  const BASE_CRIT_RATE = 5;
  const FINAL_FLOOR = 30;
  const DEBUG_MODE = new URLSearchParams(location.search).get("debug") === "1";
  const LOCAL_ORIGIN = ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname);
  const DEV_CONSOLE = DEBUG_MODE || LOCAL_ORIGIN;
  const ASSET_ROOT = "../"; // enemies/ と assets/ は本編と共有（このフォルダの1つ上）

  // ---------------- 敵 ----------------
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
    if (floor === FINAL_FLOOR) return Object.assign({ isBoss: true }, FINAL_BOSS);
    if (floor % 10 === 0) return Object.assign({ isBoss: true }, MID_BOSS);
    return Object.assign({ isBoss: false }, ENEMY_ROSTER[(floor - 1) % 10]);
  }

  // 敵HP: log10(HP) が「1階ごとに 0.1 × 1.2^(階−1)」ずつ増える。序盤は1階×1.3程度だが、20階台では
  // 1階で×10億を超え、最後は1階で×1E+14。中ボス階は上乗せ（その階だけ）。ラスボスはちょうど1グーゴル。
  // 数値はバランス用シミュレーター（README参照）で「人間のペースで中央値17分前後・5回目の挑戦でクリア」になるよう調整したもの。
  const HP_LOG_START = Math.log10(60);
  const HP_LOG_STEP = 0.1;
  const HP_LOG_GROWTH = 1.2;
  const BOSS_HP_LOG_EXTRA = { 10: 0.4, 20: 1.5 };
  const FINAL_BOSS_HP = new Decimal("1e100");
  const floorHpCache = new Map();
  function computeFloorHp(floor) {
    if (floor === FINAL_FLOOR) return FINAL_BOSS_HP;
    const cached = floorHpCache.get(floor);
    if (cached) return cached;
    let log = HP_LOG_START + (BOSS_HP_LOG_EXTRA[floor] || 0);
    for (let k = 1; k < floor; k++) log += HP_LOG_STEP * Math.pow(HP_LOG_GROWTH, k - 1);
    // 有効数字2桁に丸める（60, 76, 98, 130… と読みやすい数にする）
    const e = Math.floor(log);
    const mant = Math.round(Math.pow(10, log - e) * 10) / 10;
    const hp = Decimal.pow(10, e).mul(mant);
    floorHpCache.set(floor, hp);
    return hp;
  }

  const TYPE_LABELS = { attack: "攻撃", special: "特殊", buff: "バフ" };
  const BASE_DECK_DEFS = [
    { type: "attack", name: "斬撃", value: 15, count: 5 },
    { type: "attack", name: "強撃", value: 20, count: 3 },
    { type: "attack", name: "会心撃", value: 18, count: 2, critRateBonus: 5, critDmgBonus: 20 },
  ];

  // ---------------- 基本強化ツリー ----------------
  function buildChain(prefix, branch, tierStart, requiresFirst, entries) {
    let prev = requiresFirst;
    return entries.map((e, i) => {
      const id = prefix + (i + 1);
      const node = Object.assign({ id, branch, tier: tierStart + i, requires: prev }, e);
      prev = id;
      return node;
    });
  }
  const ROOT_NODE = { id: "root", branch: "root", tier: 0, requires: null, label: "起点", desc: "基本強化を開放。ソウル+3", cost: 1, kind: "grantPoints", pointsGrant: 3 };

  const ATK_TRUNK = buildChain("atk", "atk", 1, "root", [
    { label: "打撃の基礎", desc: "攻撃力 +5", cost: 1, effect: { atk: 5 } },
    { label: "猛る力", desc: "攻撃力 +50%", cost: 2, effect: { atkPct: 50 } },
  ]);
  const ATK_FORK_ROOT = ATK_TRUNK[ATK_TRUNK.length - 1].id;
  const ATK_POWER = buildChain("atkP", "atk", 3, ATK_FORK_ROOT, [
    { label: "覇道の拳", desc: "攻撃力 +100%", cost: 5, effect: { atkPct: 100 } },
    { label: "修羅の力", desc: "攻撃力 +200%", cost: 12, effect: { atkPct: 200 } },
    { label: "終末の力", desc: "累乗 +0.5", cost: 23, effect: { exponent: 0.5 } },
    { label: "破邪の顕現", desc: "攻撃力 +500%", cost: 40, effect: { atkPct: 500 } },
    { label: "神殺しの一撃", desc: "累乗 +0.75", cost: 65, effect: { exponent: 0.75 } },
  ]);
  const ATK_ARSENAL = buildChain("atkA", "atk", 3, ATK_FORK_ROOT, [
    { label: "闘技の心得", desc: "バフ「双撃の構え」(×2)をデッキに追加", cost: 3, kind: "startCards", cards: [{ type: "buff", name: "双撃の構え", value: 2 }] },
    { label: "精鋭の記憶", desc: "「超会心撃」をデッキに追加", cost: 9, kind: "startCards", cards: [{ type: "attack", name: "超会心撃", value: 30, critRateBonus: 10, critDmgBonus: 50 }] },
    { label: "狂乱の目覚め", desc: "バフ「狂乱の咆哮」(×3)をデッキに追加", cost: 20, kind: "startCards", cards: [{ type: "buff", name: "狂乱の咆哮", value: 3 }] },
    { label: "大器の魂", desc: "「渾身の一撃」（攻撃力×残り手数）を追加", cost: 38, kind: "startCards", cards: [{ type: "special", name: "渾身の一撃", calc: "n" }] },
    { label: "狂乱の極み", desc: "「狂乱の咆哮」をもう1枚追加", cost: 60, kind: "startCards", cards: [{ type: "buff", name: "狂乱の咆哮", value: 3 }] },
  ]);

  const N_TRUNK = buildChain("n", "n", 1, "root", [
    { label: "会心の芽生え", desc: "会心率 +5%", cost: 1, effect: { critRate: 5 } },
    { label: "会心撃の重み", desc: "会心ダメージ +50%", cost: 2, effect: { critDamage: 50 } },
  ]);
  const N_FORK_ROOT = N_TRUNK[N_TRUNK.length - 1].id;
  const N_CRIT = buildChain("nCrit", "n", 3, N_FORK_ROOT, [
    { label: "会心の連撃", desc: "会心率 +5%", cost: 5, effect: { critRate: 5 } },
    { label: "会心の閃き", desc: "会心率 +10%", cost: 13, effect: { critRate: 10 } },
    { label: "会心の神眼", desc: "会心率 +10%", cost: 28, effect: { critRate: 10 } },
  ]);
  const N_CRITDMG = buildChain("nDmg", "n", 3, N_FORK_ROOT, [
    { label: "会心撃の激化", desc: "会心ダメージ +50%", cost: 7, effect: { critDamage: 50 } },
    { label: "会心撃の暴威", desc: "会心ダメージ +100%", cost: 15, effect: { critDamage: 100 } },
    { label: "会心撃の極致", desc: "会心ダメージ +200%", cost: 33, effect: { critDamage: 200 } },
  ]);
  // 最終倍率は累乗の内側（倍率と同じ所）に掛かるので、×3 は実質 ×3^累乗
  const N_MULT = buildChain("nMult", "n", 3, N_FORK_ROOT, [
    { label: "闘気の芽生え", desc: "ダメージ倍率 ×3", cost: 8, effect: { finalMult: 3 } },
    { label: "闘気の昂り", desc: "累乗 +0.25", cost: 18, effect: { exponent: 0.25 } },
    { label: "闘気の奔流", desc: "ダメージ倍率 ×3", cost: 38, effect: { finalMult: 3 } },
    { label: "闘気の極致", desc: "累乗 +0.5・初期手札 +1", cost: 70, effect: { exponent: 0.5, hand: 1 } },
  ]);

  const GOLD_TRUNK = buildChain("gold", "gold", 1, "root", [
    { label: "魂の収穫", desc: "ソウル獲得 +20%", cost: 1, effect: { soulPct: 20 } },
    { label: "商才の芽生え", desc: "獲得金額 +50%", cost: 2, effect: { goldPct: 50 } },
  ]);
  const GOLD_FORK_ROOT = GOLD_TRUNK[GOLD_TRUNK.length - 1].id;
  const GOLD_SHOP = buildChain("goldS", "gold", 3, GOLD_FORK_ROOT, [
    { label: "商人の信頼", desc: "商人の提案 +1件", cost: 5, effect: { shopSlots: 1 } },
    { label: "開拓者の懐", desc: "開始時の所持金 +100G", cost: 10, effect: { startGold: 100 } },
    { label: "富の帝国", desc: "獲得金額 +100%", cost: 20, effect: { goldPct: 100 } },
  ]);
  const GOLD_SOUL = buildChain("goldSoul", "gold", 3, GOLD_FORK_ROOT, [
    { label: "魂の結晶", desc: "ソウル獲得 +30%", cost: 7, effect: { soulPct: 30 } },
    { label: "魂の奔流", desc: "ソウル獲得 +40%", cost: 15, effect: { soulPct: 40 } },
    { label: "魂の泉", desc: "ソウル獲得 +50%", cost: 30, effect: { soulPct: 50 } },
  ]);
  const GOLD_EXP = buildChain("goldExp", "gold", 3, GOLD_FORK_ROOT, [
    { label: "累乗の理", desc: "累乗 +0.15", cost: 4, effect: { exponent: 0.15 } },
    { label: "累乗の律", desc: "累乗 +0.25", cost: 13, effect: { exponent: 0.25 } },
    { label: "累乗の法", desc: "累乗 +0.35", cost: 30, effect: { exponent: 0.35 } },
  ]);

  const NODES = [].concat(
    [ROOT_NODE],
    ATK_TRUNK, ATK_POWER, ATK_ARSENAL,
    N_TRUNK, N_CRIT, N_CRITDMG, N_MULT,
    GOLD_TRUNK, GOLD_SHOP, GOLD_SOUL, GOLD_EXP
  );
  // 封印ノード: ツリーの先がまだ続いていることを見せるだけで、習得はできない（クリックで予告）
  const SEALED_NODES = [
    { id: "sealPower", requires: ATK_POWER[ATK_POWER.length - 1].id },
    { id: "sealArts", requires: ATK_FORK_ROOT },
    { id: "sealMult", requires: N_MULT[N_MULT.length - 1].id },
    { id: "sealExp", requires: GOLD_EXP[GOLD_EXP.length - 1].id },
    { id: "sealCore", requires: "root" },
  ];

  // レイアウト（本編と同じ螺旋配置）
  function dirFromAngle(deg) {
    const rad = (deg * Math.PI) / 180;
    return { dx: Math.cos(rad), dy: -Math.sin(rad) };
  }
  function spiralChain(ids, origin, startAngle, angleStep, startRadius, radiusStep) {
    const pos = {};
    ids.forEach((id, i) => {
      const dir = dirFromAngle(startAngle + angleStep * i);
      const radius = startRadius + radiusStep * i;
      pos[id] = { x: origin.x + dir.dx * radius, y: origin.y + dir.dy * radius };
    });
    return pos;
  }
  const ATK_ANGLE = 120;
  const N_ANGLE = 240;
  const GOLD_ANGLE = 360;
  const TRUNK_STEP = 150;
  const TRUNK_CURL = 9;
  const FORK_STEP = 140;
  const FORK_SPREAD = 55;
  const FORK_CURL = 4;
  const ROOT = { x: 1500, y: 1500 };
  const TREE_POS = { root: ROOT };
  const ids = (list) => list.map((n) => n.id);
  Object.assign(TREE_POS, spiralChain(ids(ATK_TRUNK), ROOT, ATK_ANGLE, TRUNK_CURL, TRUNK_STEP, TRUNK_STEP));
  Object.assign(TREE_POS, spiralChain(ids(N_TRUNK), ROOT, N_ANGLE, TRUNK_CURL, TRUNK_STEP, TRUNK_STEP));
  Object.assign(TREE_POS, spiralChain(ids(GOLD_TRUNK), ROOT, GOLD_ANGLE, TRUNK_CURL, TRUNK_STEP, TRUNK_STEP));
  const ATK_TRUNK_END = TREE_POS[ATK_FORK_ROOT];
  const N_TRUNK_END = TREE_POS[N_FORK_ROOT];
  const GOLD_TRUNK_END = TREE_POS[GOLD_FORK_ROOT];
  const ATK_END_ANGLE = ATK_ANGLE + TRUNK_CURL * (ATK_TRUNK.length - 1);
  const N_END_ANGLE = N_ANGLE + TRUNK_CURL * (N_TRUNK.length - 1);
  const GOLD_END_ANGLE = GOLD_ANGLE + TRUNK_CURL * (GOLD_TRUNK.length - 1);
  Object.assign(TREE_POS, spiralChain(ids(ATK_POWER).concat("sealPower"), ATK_TRUNK_END, ATK_END_ANGLE - FORK_SPREAD, -FORK_CURL, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(ids(ATK_ARSENAL), ATK_TRUNK_END, ATK_END_ANGLE, FORK_CURL * 0.4, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(["sealArts"], ATK_TRUNK_END, ATK_END_ANGLE + FORK_SPREAD, FORK_CURL, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(ids(N_CRIT), N_TRUNK_END, N_END_ANGLE - FORK_SPREAD, -FORK_CURL, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(ids(N_CRITDMG), N_TRUNK_END, N_END_ANGLE, FORK_CURL * 0.4, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(ids(N_MULT).concat("sealMult"), N_TRUNK_END, N_END_ANGLE + FORK_SPREAD, FORK_CURL, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(ids(GOLD_SHOP), GOLD_TRUNK_END, GOLD_END_ANGLE - FORK_SPREAD, -FORK_CURL, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(ids(GOLD_SOUL), GOLD_TRUNK_END, GOLD_END_ANGLE, FORK_CURL * 0.4, FORK_STEP, FORK_STEP));
  Object.assign(TREE_POS, spiralChain(ids(GOLD_EXP).concat("sealExp"), GOLD_TRUNK_END, GOLD_END_ANGLE + FORK_SPREAD, FORK_CURL * 0.5, FORK_STEP, FORK_STEP));
  // 3本の幹のすき間（真下寄り）に、根元から直接伸びる封印の枝
  Object.assign(TREE_POS, spiralChain(["sealCore"], ROOT, 300, 0, TRUNK_STEP * 1.3, TRUNK_STEP));

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
  const { width: TREE_CANVAS_WIDTH, height: TREE_CANVAS_HEIGHT } = fitCanvasToPositions(TREE_POS, 90);

  // ---------------- 封印された機能（完全版の予告） ----------------
  const SEALED_FEATURES = {
    deck: { name: "デッキ強化", text: "カードを鍛え上げ、不要なカードを削り、編成を組み替える。自分だけの最強デッキを作り上げろ。" },
    cardShop: { name: "カードショップ", text: "塔に棲む商人が、隕石落とし・処刑の火・終焉の使者……禁断のカードを売ってくれる。" },
    achievements: { name: "実績", text: "塔での偉業は永遠に刻まれ、力となる。中ボス討伐、一撃一兆、会心の嵐……約30種の実績が待つ。" },
    transcend: { name: "転生", text: "レベルも強化も全てを捨て、より強く生まれ変わる輪廻の秘法。蜘蛛の巣のように広がる「転生パネル」で、永遠に残る力を手に入れろ。" },
    remnant: { name: "残滓", text: "かつての自分が「残滓」となって共に戦い、攻撃のたびに追撃する。ゲームを閉じている間も力を蓄え続ける。" },
    tower: { name: "100階の塔", text: "完全版の塔は100階建て。この体験版で登れるのは、そのほんの入り口にすぎない。" },
    endless: { name: "エンドレスモード", text: "100階の頂を越えた者だけが進める、果てのない階層。敵のHPは天井知らずに膨れ上がる。" },
    tree: { name: "？？？", text: "この先の強化は封印されている。完全版では、さらに広大なスキルツリーと、何度でも強化できる「拡張強化」が広がっている。" },
    mystery: { name: "？？？", text: "塔の100階には、まだ誰も見たことのない何かが眠っている……。" },
  };
  const HOME_SEALED = ["deck", "cardShop", "achievements", "transcend", "remnant", "mystery"];
  const VICTORY_TEASER = ["tower", "endless", "transcend", "remnant", "deck", "cardShop", "achievements", "mystery"];

  // ---------------- セーブ ----------------
  function cloneDeckDefs(defs) { return defs.map((d) => Object.assign({}, d)); }
  function addCardToDeckDefs(defs, cardDef) {
    const existing = defs.find((d) => d.name === cardDef.name && d.type === cardDef.type);
    if (existing) existing.count += 1;
    else defs.push(Object.assign({}, cardDef, { count: 1 }));
  }
  function defaultSave() {
    return {
      points: 0, unlockedNodes: {}, bestFloor: 0, bestClearedFloor: 0,
      deckDefs: cloneDeckDefs(BASE_DECK_DEFS),
      autoBuyEnabled: true, // 展示ではテンポ優先で最初からON（商人画面のチェックで切り替え可）
      level: 1, exp: new Decimal(0),
      stats: {}, // runs, kills, maxHit (Decimal)
      unitReached: -1, // JP_UNITS の何番目の位まで一撃で届いたか（演出を一度だけ出すため）
      timerStart: 0, // 最初に塔へ挑んだ時刻（ms）。ここからラスボス討伐までがクリアタイム
      clearTimeMs: 0,
      rankSubmitted: false,
      hints: {},
    };
  }
  function toDecimal(v) {
    try {
      const d = new Decimal(v == null ? 0 : v);
      return Number.isFinite(d.mantissa) && Number.isFinite(d.exponent) ? d : new Decimal(0);
    } catch (e) { return new Decimal(0); }
  }
  function loadSave() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultSave();
      const parsed = JSON.parse(raw);
      const merged = Object.assign(defaultSave(), parsed, {
        unlockedNodes: Object.assign({}, parsed.unlockedNodes || {}),
        stats: Object.assign({}, parsed.stats || {}),
        hints: Object.assign({}, parsed.hints || {}),
        deckDefs: Array.isArray(parsed.deckDefs) ? parsed.deckDefs : cloneDeckDefs(BASE_DECK_DEFS),
      });
      merged.exp = toDecimal(merged.exp);
      merged.stats.maxHit = toDecimal(merged.stats.maxHit);
      return merged;
    } catch (e) {
      return defaultSave();
    }
  }
  // 「次の人へ」で消している最中は保存しない。リロードで pagehide が走り、メモリ上の古いセーブを
  // persistSave() が書き戻してしまうため（これが無いとリセットしても何も消えない）
  let wipingSave = false;
  function persistSave() {
    if (wipingSave) return;
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
  function treeProduct(key) {
    let total = 1;
    NODES.forEach((node) => {
      if (save.unlockedNodes[node.id] && node.effect && node.effect[key]) total *= node.effect[key];
    });
    return total;
  }

  // ---------------- 数値表示 ----------------
  const E_NOTATION_THRESHOLD = 1e9;
  function fmt(n) {
    if (n instanceof Decimal) {
      if (n.abs().lt(E_NOTATION_THRESHOLD)) return fmt(n.toNumber());
      const [mant, exp] = n.toExponential(2).split("e");
      const e = Number(exp);
      return mant + "E" + (e < 0 ? "-" : "+") + Math.abs(e);
    }
    const rounded = Math.round(n);
    if (Math.abs(rounded) >= E_NOTATION_THRESHOLD) return rounded.toExponential(2).replace("e+", "E+").replace("e-", "E-");
    return rounded.toLocaleString("ja-JP");
  }
  function fmtMult(n) {
    if (n instanceof Decimal) return n.lt(E_NOTATION_THRESHOLD) ? fmtMult(n.toNumber()) : fmt(n);
    return (Math.round(n * 100) / 100).toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  }
  // 日本の命数法。一撃がこの位に届くたびに大きな演出を出す（インフレを実感させる仕掛け）
  const JP_UNITS = [
    { e: 4, name: "万", read: "まん" }, { e: 8, name: "億", read: "おく" }, { e: 12, name: "兆", read: "ちょう" },
    { e: 16, name: "京", read: "けい" }, { e: 20, name: "垓", read: "がい" }, { e: 24, name: "秭", read: "じょ" },
    { e: 28, name: "穣", read: "じょう" }, { e: 32, name: "溝", read: "こう" }, { e: 36, name: "澗", read: "かん" },
    { e: 40, name: "正", read: "せい" }, { e: 44, name: "載", read: "さい" }, { e: 48, name: "極", read: "ごく" },
    { e: 52, name: "恒河沙", read: "ごうがしゃ" }, { e: 56, name: "阿僧祇", read: "あそうぎ" }, { e: 60, name: "那由他", read: "なゆた" },
    { e: 64, name: "不可思議", read: "ふかしぎ" }, { e: 68, name: "無量大数", read: "むりょうたいすう" },
    { e: 100, name: "グーゴル", read: "googol" },
  ];
  function unitIndexFor(d) {
    let idx = -1;
    JP_UNITS.forEach((u, i) => { if (d.gte(Decimal.pow(10, u.e))) idx = i; });
    return idx;
  }
  // 3.4京 / 3,400京 / 1.2E+12無量大数 のように、一番大きい位で表す
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

  // ---------------- 攻撃力・ダメージ ----------------
  // レベル: 敵を倒すとその最大HPぶんの経験値。必要経験値は1レベルごとに×3、攻撃力は1レベルごとに×1.5。
  // 敵HPが加速度的に増えるので、終盤は1階で数十レベル上がる（=攻撃力も桁ごと跳ねる）
  const LEVEL_EXP_BASE = 30;
  const LEVEL_EXP_GROWTH = 3;
  const LEVEL_ATK_MULT = 1.5;
  function expToNext(level) { return Decimal.pow(LEVEL_EXP_GROWTH, level - 1).mul(LEVEL_EXP_BASE).ceil(); }
  function gainExp(amount) {
    const add = new Decimal(amount);
    if (!add.gt(0)) return 0;
    save.exp = save.exp.add(add);
    const startLevel = save.level;
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
    return save.level - startLevel;
  }
  function levelAtkMult(level) { return Decimal.pow(LEVEL_ATK_MULT, (level || save.level) - 1); }

  function currentAtk() {
    const flat = BASE_ATK + treeBonus("atk");
    const pct = 1 + (treeBonus("atkPct") + (game ? game.runAtkPct : 0)) / 100;
    return levelAtkMult().mul(flat * pct);
  }
  function currentStartHand() { return BASE_HAND + treeBonus("hand") + (game ? game.runHandBonus : 0); }
  function currentExponent() { return 1 + treeBonus("exponent") + (game ? game.runExponent : 0); }
  function finalDamageMult() { return treeProduct("finalMult"); }
  function goldMultiplier() { return 1 + (treeBonus("goldPct") + game.runGoldPct) / 100; }
  function soulMultiplier() { return 1 + treeBonus("soulPct") / 100; }
  function shopOfferCount() { return 3 + treeBonus("shopSlots"); }
  function critRate() { return Math.min(100, BASE_CRIT_RATE + treeBonus("critRate") + game.runCritRate); }
  function critMultiplier(cardDmgBonus) { return 1.5 + (treeBonus("critDamage") + game.runCritDamage + (cardDmgBonus || 0)) / 100; }
  function rollCrit(cardRateBonus) { return Math.random() * 100 < critRate() + (cardRateBonus || 0); }

  const MIN_BUFF_MULTIPLIER = 0.1;
  function buffMultiplier() { return Math.max(MIN_BUFF_MULTIPLIER, 1 + game.buffBonus); }
  function cardRaw(card) {
    if (card.type === "special") return currentAtk().mul(game.n); // 渾身の一撃: 攻撃力 × 残り手数
    return currentAtk().add(card.value);
  }
  // ダメージ = (威力 × バフ倍率 × 闘気 × 会心)^累乗。累乗が全体に掛かるので、どの要素を伸ばしても桁が跳ねる
  function computeDamage(raw, buffMult, critMult) {
    return new Decimal(raw).mul(buffMult).mul(finalDamageMult()).mul(critMult).pow(currentExponent()).ceil();
  }
  // 手札のプレビュー（バフ・会心なし）
  function previewDamage(card) { return computeDamage(cardRaw(card), 1, 1); }

  // ---------------- ラン ----------------
  const FLOOR_CHECKPOINTS = [1, 11, 21, FINAL_FLOOR];
  // 直前の階（10・20・29階）をクリアしたら開く。撤退でクリア直後に帰っても開いているように
  function checkpointUnlocked(floor) { return floor === 1 || save.bestClearedFloor >= floor - 1; }

  function stat(key) { return save.stats[key] || 0; }
  function bumpStat(key) { save.stats[key] = stat(key) + 1; }
  function maxHit() { return save.stats.maxHit instanceof Decimal ? save.stats.maxHit : toDecimal(save.stats.maxHit); }

  function newRun(startFloor) {
    bumpStat("runs");
    if (!save.timerStart) save.timerStart = Date.now();
    game = {
      floor: startFloor,
      startFloor,
      floorPointsSum: 0,
      gold: treeBonus("startGold"),
      runAtkPct: 0, runHandBonus: 0, runCritRate: 0, runCritDamage: 0, runGoldPct: 0, runExponent: 0,
      deckDefs: cloneDeckDefs(save.deckDefs),
      deck: [], hand: [],
      gameOver: false,
      shopOffers: null, shopRerollsUsed: 0, shopBuyCounts: {},
    };
    persistSave();
    startFloor_(startFloor);
  }

  function buildShuffledDeck() {
    const cards = [];
    game.deckDefs.forEach((def) => {
      for (let i = 0; i < def.count; i++) {
        cards.push({ uid: cardUid++, type: def.type, name: def.name, value: def.value, calc: def.calc, critRateBonus: def.critRateBonus, critDmgBonus: def.critDmgBonus });
      }
    });
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }
  function drawOne() {
    if (game.deck.length === 0) return null;
    const card = game.deck.shift();
    game.hand.push(card);
    return card;
  }

  function startFloor_(floor) {
    game.floor = floor;
    game.enemyHpMax = computeFloorHp(floor);
    game.enemyHp = game.enemyHpMax;
    game.n = BASE_N;
    game.buffBonus = 0;
    game.gameOver = false;
    game.deck = buildShuffledDeck();
    game.hand = [];
    for (let i = 0; i < currentStartHand(); i++) drawOne();
    if (DEBUG_MODE) game.hand.unshift({ uid: cardUid++, type: "attack", name: "【DEBUG】即死", value: 0, debugKill: true });

    el.log.innerHTML = "";
    el.enemyVisual.classList.remove("defeated");
    const enemy = enemyForFloor(floor);
    addLog(`${floor}階 — ${enemy.name}が立ちはだかる。（HP ${jpUnitText(game.enemyHpMax)}）`, "info");
    if (floor === FINAL_FLOOR) addLog("塔の頂。HPはちょうど1グーゴル（10の100乗）。", "boss");
    else if (enemy.isBoss) addLog("中ボスだ！ HPがいつもより多い。", "boss");
    if (!save.hints.battle) {
      save.hints.battle = true;
      addLog("【ヒント】カードをクリック（数字キーでもOK）して攻撃。残り手数が0になる前に敵のHPを0にしよう。", "hint");
    }
    showScreen("battle");
    renderBattle();
  }

  // ---------------- DOM ----------------
  const $ = (id) => document.getElementById(id);
  const el = {
    homeLevelLabel: $("homeLevelLabel"), bestFloorLabel: $("bestFloorLabel"), homePointsLabel: $("homePointsLabel"),
    homeMaxHitLabel: $("homeMaxHitLabel"), homeSealedGrid: $("homeSealedGrid"), homeRanking: $("homeRanking"), homeSub: $("homeSub"),
    openFloorSelectBtn: $("openFloorSelectBtn"), openTreeBtn: $("openTreeBtn"), treeBadge: $("treeBadge"), resetProgressBtn: $("resetProgressBtn"),
    floorSelectBackBtn: $("floorSelectBackBtn"), floorSelectGrid: $("floorSelectGrid"),
    treeBackBtn: $("treeBackBtn"), treeGoBtn: $("treeGoBtn"), treePointsLabel: $("treePointsLabel"),
    treeMap: $("treeMap"), treeScrollWrap: $("treeScrollWrap"), treeMapScaler: $("treeMapScaler"),
    floorLabel: $("floorLabel"), battleSide: $("battleSide"), enemyVisual: $("enemyVisual"), enemyName: $("enemyName"),
    enemyHpNow: $("enemyHpNow"), enemyHpMax: $("enemyHpMax"), enemyHpUnit: $("enemyHpUnit"), enemyBar: $("enemyBar"),
    statN: $("statN"), statAtk: $("statAtk"), statBuff: $("statBuff"), statExp: $("statExp"),
    log: $("log"), hand: $("hand"), handCount: $("handCount"), deckCount: $("deckCount"), deckPile: $("deckPile"),
    deckPileCount: $("deckPileCount"), battleGold: $("battleGold"),
    floorClearSub: $("floorClearSub"), levelUpBanner: $("levelUpBanner"), shopGold: $("shopGold"), shopOptions: $("shopOptions"),
    rerollBtn: $("rerollBtn"), autoBuyRow: $("autoBuyRow"), autoBuyBtn: $("autoBuyBtn"), autoBuyToggle: $("autoBuyToggle"),
    autoBuySummary: $("autoBuySummary"), toNextFloorBtn: $("toNextFloorBtn"), retreatBtn: $("retreatBtn"),
    runEndTitle: $("runEndTitle"), runEndSub: $("runEndSub"), runEndPoints: $("runEndPoints"), runEndTotal: $("runEndTotal"),
    runEndTreeBtn: $("runEndTreeBtn"), runEndRetryBtn: $("runEndRetryBtn"), runEndHomeBtn: $("runEndHomeBtn"),
    clearTimeLabel: $("clearTimeLabel"), clearRankLabel: $("clearRankLabel"), victoryStats: $("victoryStats"),
    nameEntry: $("nameEntry"), nameInput: $("nameInput"), nameSubmitBtn: $("nameSubmitBtn"), victoryRanking: $("victoryRanking"),
    enterEndlessBtn: $("enterEndlessBtn"), victoryTeaser: $("victoryTeaser"), victoryToHomeBtn: $("victoryToHomeBtn"),
    confirmOverlay: $("confirmOverlay"), confirmMessage: $("confirmMessage"), confirmOkBtn: $("confirmOkBtn"), confirmCancelBtn: $("confirmCancelBtn"),
    sealOverlay: $("sealOverlay"), sealName: $("sealName"), sealText: $("sealText"), sealCloseBtn: $("sealCloseBtn"),
    toastArea: $("toastArea"), playTimer: $("playTimer"),
  };

  function showConfirm(message) {
    if (el.confirmOverlay.classList.contains("active")) return Promise.resolve(false);
    return new Promise((resolve) => {
      el.confirmMessage.textContent = message;
      el.confirmOverlay.classList.add("active");
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

  function showSeal(key) {
    const f = SEALED_FEATURES[key];
    if (!f) return;
    el.sealName.textContent = f.name;
    el.sealText.textContent = f.text;
    el.sealOverlay.classList.add("active");
    el.sealCloseBtn.focus();
  }
  function closeSeal() { el.sealOverlay.classList.remove("active"); }
  el.sealCloseBtn.addEventListener("click", closeSeal);
  el.sealOverlay.addEventListener("click", (e) => { if (e.target === el.sealOverlay) closeSeal(); });
  function modalOpen() { return el.sealOverlay.classList.contains("active") || el.confirmOverlay.classList.contains("active"); }

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
    $("screen-" + name).classList.add("active");
    document.body.classList.toggle("home-bg", name === "home");
    window.scrollTo(0, 0);
  }
  function activeScreen() {
    const a = document.querySelector(".screen.active");
    return a ? a.id.replace("screen-", "") : "";
  }

  function addLog(text, cls) {
    const line = document.createElement("div");
    line.className = "log-line" + (cls ? " " + cls : "");
    line.textContent = text;
    el.log.prepend(line);
  }

  // ---------------- ダメージ数字（画像グリフ。dmg-glyphs.js の data URI を使うので file:// でも出る） ----------------
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
  const DMG_GLYPHS = window.MT_DMG_GLYPHS || null;
  const DMG_CHAR_BOUNCE_STAGGER_MS = 30;
  const DMG_CHAR_STAGGER_SPAN_MS = 140;
  const DMG_LIFETIME_MS = 850; // style.css の dmgHoldFade と揃える
  function appendDmgChars(container, text) {
    const chars = [...text];
    const gap = chars.length > 1 ? Math.min(DMG_CHAR_BOUNCE_STAGGER_MS, DMG_CHAR_STAGGER_SPAN_MS / (chars.length - 1)) : 0;
    chars.forEach((ch, i) => {
      const file = DMG_GLYPHS ? DMG_GLYPH_FILES[ch] : null;
      const span = document.createElement("span");
      if (file && DMG_GLYPHS[file]) {
        span.className = "dmg-char";
        span.style.setProperty("--dmg-glyph", `url("${DMG_GLYPHS[file]}")`);
        span.style.setProperty("--dmg-aspect", DMG_GLYPH_ASPECT[file]);
      } else {
        span.className = "dmg-text";
        span.textContent = ch;
      }
      span.style.animationDelay = (i * gap) + "ms";
      container.appendChild(span);
    });
  }
  function floatDamage(amount, isCrit) {
    const rect = el.enemyVisual.getBoundingClientRect();
    const f = document.createElement("div");
    const ratio = new Decimal(amount).div(game.enemyHpMax).toNumber();
    const isHuge = ratio >= 0.5;
    let cls = "dmg-float";
    if (isCrit) { cls += " dmg-crit"; if (isHuge) cls += " dmg-huge"; }
    else if (isHuge) cls += " dmg-huge";
    else if (ratio >= 0.15) cls += " dmg-big";
    f.className = cls;
    appendDmgChars(f, (isCrit ? "CRITICAL-" : "-") + fmt(amount));
    const marginX = rect.width * 0.18;
    const marginY = rect.height * 0.18;
    f.style.left = (rect.left + marginX + Math.random() * Math.max(0, rect.width - marginX * 2)) + "px";
    f.style.top = (rect.top + marginY + Math.random() * Math.max(0, rect.height - marginY * 2)) + "px";
    document.body.appendChild(f);
    setTimeout(() => f.remove(), DMG_LIFETIME_MS);
    impactEffects(isCrit, isHuge);
  }
  function impactEffects(isCrit, isHuge) {
    el.enemyVisual.classList.remove("hit");
    void el.enemyVisual.offsetWidth;
    el.enemyVisual.classList.add("hit");
    if (!isCrit && !isHuge) return;
    const appEl = document.querySelector(".app");
    const shakeCls = isCrit && isHuge ? "shake-mega" : isCrit ? "shake-crit" : "shake-huge";
    appEl.classList.remove("shake-crit", "shake-huge", "shake-mega");
    void appEl.offsetWidth;
    appEl.classList.add(shakeCls);
    setTimeout(() => appEl.classList.remove(shakeCls), 450);
    const flash = document.createElement("div");
    flash.className = "screen-flash " + (isCrit ? "flash-crit" : "flash-huge");
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 400);
  }

  // 一撃が新しい位（万・億・兆…グーゴル）に届いた瞬間の、画面中央の大きな漢字スタンプ
  function recordHit(dmg) {
    if (dmg.gt(maxHit())) save.stats.maxHit = dmg;
    const idx = unitIndexFor(dmg);
    if (idx > save.unitReached) {
      save.unitReached = idx;
      showUnitStamp(JP_UNITS[idx]);
    }
  }
  let stampTimer = null;
  function showUnitStamp(unit) {
    document.querySelectorAll(".unit-stamp").forEach((s) => s.remove());
    clearTimeout(stampTimer);
    const s = document.createElement("div");
    s.className = "unit-stamp" + (unit.name.length > 2 ? " long" : "");
    const big = document.createElement("div");
    big.className = "unit-stamp-name";
    big.textContent = unit.name;
    const sub = document.createElement("div");
    sub.className = "unit-stamp-sub";
    sub.textContent = `一撃が「${unit.name}（${unit.read}）」の位に到達！ 10の${unit.e}乗`;
    s.appendChild(big);
    s.appendChild(sub);
    document.body.appendChild(s);
    stampTimer = setTimeout(() => s.remove(), 1600);
  }

  // ---------------- 戦闘 ----------------
  function hitEnemy(dmg) {
    game.enemyHp = Decimal.max(0, game.enemyHp.sub(dmg));
    recordHit(dmg);
  }
  function resolveCardEffect(card) {
    if (card.type === "attack" || card.type === "special") {
      if (card.debugKill) {
        const dmg = game.enemyHp;
        hitEnemy(dmg);
        addLog(`${card.name}：${fmt(dmg)} ダメージ`, "dmg");
        floatDamage(dmg, false);
        return;
      }
      const isCrit = card.type === "attack" ? rollCrit(card.critRateBonus) : rollCrit();
      const critMult = isCrit ? critMultiplier(card.critDmgBonus) : 1;
      const buff = buffMultiplier();
      const dmg = computeDamage(cardRaw(card), buff, critMult);
      hitEnemy(dmg);
      const note = buff !== 1 ? `（倍率×${fmtMult(buff)}）` : "";
      if (isCrit) addLog(`${card.name} で会心の一撃！ ${fmt(dmg)} ダメージ！${note}`, "dmg crit");
      else addLog(`${card.name} で ${fmt(dmg)} ダメージ！${note}`, "dmg");
      floatDamage(dmg, isCrit);
      game.buffBonus = 0;
    } else if (card.type === "buff") {
      // バフは足し算で重なる（×2と×3で×4）。累乗の内側なので、累乗が上がるほど効きが大きくなる
      game.buffBonus = Math.max(MIN_BUFF_MULTIPLIER - 1, game.buffBonus + (card.value - 1));
      addLog(`${card.name}：次の攻撃の倍率が×${fmtMult(buffMultiplier())}に！（累乗で ×${fmtMult(Decimal.pow(buffMultiplier(), currentExponent()))} 相当）`, "buff");
    }
  }

  // テンポ優先で本編より短い（style.css の対応するアニメーションと揃える）
  const CARD_PLAY_ANIM_MS = 160;
  const FLIP_SLIDE_MS = 180;
  const CARD_FLIP_DELAY_MS = 180;
  const KILL_PAUSE_MS = 420; // とどめの一撃の数字と撃破演出を見せてから画面を切り替える

  function playCard(uid) {
    if (!game || game.gameOver) return;
    const card = game.hand.find((c) => c.uid === uid);
    if (!card || card.playing) return;
    const thisGame = game;
    card.playing = true;
    renderBattle();
    setTimeout(() => {
      card.playing = false;
      if (game !== thisGame || game.gameOver) return;
      const idx = game.hand.findIndex((c) => c.uid === uid);
      if (idx === -1) return;
      game.hand.splice(idx, 1);
      resolveCardEffect(card);
      game.deck.push(card);
      const drawn = drawOne();
      if (drawn) drawn.justDrawn = true;
      game.n -= 1;
      renderBattle();
      checkResult();
    }, CARD_PLAY_ANIM_MS);
  }

  function enemyHpPct() { return Math.max(0, game.enemyHp.div(game.enemyHpMax).toNumber() * 100); }
  function checkResult() {
    if (game.enemyHp.lte(0)) onFloorWin();
    else if (game.n <= 0) onFloorLoss();
  }

  function onFloorWin() {
    game.gameOver = true;
    const thisGame = game;
    addLog("敵を撃破した！", "info");
    el.enemyVisual.classList.add("defeated");
    game.floorPointsSum += game.floor;
    save.bestFloor = Math.max(save.bestFloor, game.floor);
    save.bestClearedFloor = Math.max(save.bestClearedFloor, game.floor);
    bumpStat("kills");
    const levelBefore = save.level;
    const levelsGained = gainExp(game.enemyHpMax);
    persistSave();
    setTimeout(() => {
      if (game !== thisGame) return;
      if (game.floor === FINAL_FLOOR) onFinalVictory();
      else {
        const goldGain = Math.ceil((20 + game.floor * 5) * goldMultiplier());
        game.gold += goldGain;
        openFloorClear(goldGain, levelBefore, levelsGained);
      }
    }, KILL_PAUSE_MS);
  }

  // ソウル = クリアした階の階数の合計 × 1.3（× 基本強化のソウル獲得）。本編と同じく、高い階ほど多くもらえる
  const SOUL_PER_FLOOR = 1.3;
  function awardRunEndPoints() {
    const gained = Math.floor(game.floorPointsSum * SOUL_PER_FLOOR * soulMultiplier());
    save.points += gained;
    save.bestFloor = Math.max(save.bestFloor, game.floor);
    persistSave();
    return gained;
  }
  function onFloorLoss() {
    game.gameOver = true;
    addLog("手数が尽きた。塔から追い出される…", "dmg");
    const gained = awardRunEndPoints();
    setTimeout(() => openRunEnd(false, gained), KILL_PAUSE_MS);
  }
  function onRetreat() {
    game.gameOver = true;
    openRunEnd(true, awardRunEndPoints());
  }
  function openRunEnd(retreated, gained) {
    el.runEndTitle.textContent = retreated ? `${game.floor}階まで進んで撤退した` : `${game.floor}階で敗北…`;
    el.runEndTitle.className = "reward-title " + (retreated ? "win" : "lose");
    const affordable = NODES.filter((n) => nodeState(n) === "available").length;
    el.runEndSub.textContent = (retreated ? "無理をせず、ここまでの力を持ち帰った。" : "力尽きたが、倒した敵たちから得た力（ソウル）とレベルは残る。")
      + (affordable ? `いま習得できる強化が${affordable}個ある！` : "");
    el.runEndPoints.textContent = fmt(gained);
    el.runEndTotal.textContent = fmt(save.points);
    el.runEndRetryBtn.textContent = `すぐにもう一度挑む（${defaultStartFloor()}階から）`;
    showScreen("runEnd");
  }
  el.runEndTreeBtn.addEventListener("click", () => { game = null; openTree(); });
  el.runEndRetryBtn.addEventListener("click", () => { game = null; newRun(defaultStartFloor()); });
  el.runEndHomeBtn.addEventListener("click", () => { game = null; goHome(); });

  // ---------------- 商人（フロアクリア） ----------------
  const SHOP_POOL = [
    { id: "atk", name: "闘志の秘薬", desc: "攻撃力 +20%（このラン中）", baseCost: 20, apply: () => { game.runAtkPct += 20; } },
    { id: "crit", name: "会心の秘薬", desc: "会心率 +2%（このラン中、最大15回）", baseCost: 25, maxPerRun: 15, apply: () => { game.runCritRate += 2; } },
    { id: "critDmg", name: "会心撃の秘薬", desc: "会心ダメージ +20%（このラン中）", baseCost: 25, priceGrowth: 1.1, apply: () => { game.runCritDamage += 20; } },
    { id: "exponent", name: "累乗の秘薬", desc: "累乗 +0.03（このラン中）", baseCost: 40, unlockFloor: 10, weight: 0.6, priceGrowth: 1.3, apply: () => { game.runExponent += 0.03; } },
    { id: "gold", name: "強欲の秘薬", desc: "獲得金額 +15%（このラン中）", baseCost: 30, priceGrowth: 1.2, apply: () => { game.runGoldPct += 15; } },
    { id: "hand", name: "集中の秘薬", desc: "初期手札 +1（このラン中、最大2回）", baseCost: 40, unlockFloor: 10, weight: 0.15, maxPerRun: 2, apply: () => { game.runHandBonus += 1; } },
  ];
  function shopBuyCount(opt) { return game.shopBuyCounts[opt.id] || 0; }
  function availableShopPool() {
    return SHOP_POOL.filter((opt) => (!opt.unlockFloor || save.bestClearedFloor >= opt.unlockFloor)
      && (!opt.maxPerRun || shopBuyCount(opt) < opt.maxPerRun));
  }
  function shopOfferCost(opt) {
    const base = opt.baseCost + game.floor * 3;
    return opt.priceGrowth ? Math.ceil(base * Math.pow(opt.priceGrowth, shopBuyCount(opt))) : base;
  }
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
  function rollShopOffers() {
    game.shopOffers = pickWeighted(availableShopPool(), shopOfferCount()).map((opt) => ({ opt, cost: shopOfferCost(opt), bought: false }));
  }
  function rerollCost() { return Math.ceil((10 + game.floor * 2) * Math.pow(1.5, game.shopRerollsUsed)); }
  function buyOffer(offer) {
    if (offer.bought || game.gold < offer.cost) return false;
    game.gold -= offer.cost;
    offer.opt.apply();
    offer.bought = true;
    game.shopBuyCounts[offer.opt.id] = shopBuyCount(offer.opt) + 1;
    return true;
  }
  function doReroll() {
    const cost = rerollCost();
    if (game.gold < cost) return false;
    game.gold -= cost;
    game.shopRerollsUsed += 1;
    rollShopOffers();
    return true;
  }

  function openFloorClear(goldGain, levelBefore, levelsGained) {
    el.floorClearSub.textContent = `${game.floor}階クリア（+${fmt(goldGain)}G）。次は${game.floor + 1}階${(game.floor + 1) % 10 === 0 ? (game.floor + 1 === FINAL_FLOOR ? "【ラスボス】" : "【中ボス】") : ""}：HP ${jpUnitText(computeFloorHp(game.floor + 1))}`;
    if (levelsGained > 0) {
      el.levelUpBanner.innerHTML = "";
      const a = document.createElement("div");
      a.className = "levelup-main";
      a.textContent = `LEVEL UP!  Lv.${levelBefore} → Lv.${save.level}`;
      const b = document.createElement("div");
      b.className = "levelup-sub";
      b.textContent = `攻撃力 ×${fmtMult(Decimal.pow(LEVEL_ATK_MULT, levelsGained))}（1レベルごとに×${LEVEL_ATK_MULT}）`;
      el.levelUpBanner.appendChild(a);
      el.levelUpBanner.appendChild(b);
      el.levelUpBanner.style.display = "";
    } else el.levelUpBanner.style.display = "none";
    rollShopOffers();
    game.shopRerollsUsed = 0;
    el.autoBuySummary.textContent = "";
    renderShop();
    showScreen("floorClear");
    if (save.autoBuyEnabled) setTimeout(runAutoBuy, AUTO_BUY_STEP_MS);
  }

  function renderShop() {
    el.shopGold.textContent = fmt(game.gold);
    el.shopOptions.innerHTML = "";
    game.shopOffers.forEach((offer) => {
      const div = document.createElement("div");
      const affordable = !offer.bought && game.gold >= offer.cost;
      div.className = "option-card" + (offer.bought ? " bought" : "") + (!affordable || autoBuyRunning ? " disabled" : "");
      div.innerHTML = `<div class="oc-name">${offer.opt.name}</div><div class="oc-desc">${offer.opt.desc}</div><div class="oc-cost">${offer.bought ? "購入済み" : fmt(offer.cost) + " G"}</div>`;
      if (affordable) {
        div.addEventListener("click", () => {
          if (autoBuyRunning) return;
          if (buyOffer(offer)) renderShop();
        });
      }
      el.shopOptions.appendChild(div);
    });
    const cost = rerollCost();
    const canReroll = !autoBuyRunning && game.gold >= cost;
    el.rerollBtn.textContent = `リロール（${fmt(cost)}G）`;
    el.rerollBtn.disabled = !canReroll;
    el.rerollBtn.style.opacity = canReroll ? "1" : "0.5";
    el.autoBuyBtn.textContent = autoBuyRunning ? "自動購入を停止" : "自動購入";
    el.autoBuyToggle.checked = !!save.autoBuyEnabled;
  }
  el.rerollBtn.addEventListener("click", () => { if (!autoBuyRunning && doReroll()) renderShop(); });

  // 全部買う（安い順）→ リロール を所持金が尽きるまで繰り返す
  const AUTO_BUY_STEP_MS = 25;
  let autoBuyRunning = false;
  let autoBuyStopRequested = false;
  async function runAutoBuy() {
    if (autoBuyRunning || !game || !game.shopOffers) return;
    const thisGame = game;
    const stillHere = () => game === thisGame && game.shopOffers && activeScreen() === "floorClear";
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
        if (game.gold - rerollCost() < cheapest || !doReroll()) break;
        rerolls += 1;
      }
      renderShop();
      await new Promise((r) => setTimeout(r, AUTO_BUY_STEP_MS));
    }
    autoBuyRunning = false;
    if (game !== thisGame || !game.shopOffers) return;
    const items = Object.entries(bought).map(([name, n]) => `${name}×${n}`).join("、") || "なし";
    el.autoBuySummary.textContent = `自動購入：${items}（使用 ${fmt(goldBefore - game.gold)}G）`;
    renderShop();
  }
  el.autoBuyBtn.addEventListener("click", () => { if (autoBuyRunning) autoBuyStopRequested = true; else runAutoBuy(); });
  el.autoBuyToggle.addEventListener("change", () => {
    save.autoBuyEnabled = el.autoBuyToggle.checked;
    persistSave();
    if (save.autoBuyEnabled) runAutoBuy();
  });
  function goNextFloor() {
    if (!game || !game.shopOffers) return;
    autoBuyStopRequested = true;
    game.shopOffers = null;
    startFloor_(game.floor + 1);
  }
  el.toNextFloorBtn.addEventListener("click", goNextFloor);
  el.retreatBtn.addEventListener("click", () => { autoBuyStopRequested = true; onRetreat(); });

  // ---------------- ラスボス討伐・ランキング ----------------
  function loadRanking() {
    try {
      const list = JSON.parse(localStorage.getItem(RANKING_KEY) || "[]");
      return Array.isArray(list) ? list.filter((r) => r && Number.isFinite(r.ms)) : [];
    } catch (e) { return []; }
  }
  function saveRanking(list) {
    try { localStorage.setItem(RANKING_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }
  const RANKING_KEEP = 20;
  function fmtTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(sec).padStart(2, "0");
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }
  function rankFor(ms) { return loadRanking().filter((r) => r.ms < ms).length + 1; }
  function renderRankingList(ol, limit, highlightId) {
    const list = loadRanking().slice(0, limit);
    ol.innerHTML = "";
    if (!list.length) {
      const li = document.createElement("li");
      li.className = "ranking-empty";
      li.textContent = "まだ記録がありません。最初の踏破者になろう！";
      ol.appendChild(li);
      return;
    }
    list.forEach((r, i) => {
      const li = document.createElement("li");
      if (r.id && r.id === highlightId) li.className = "me";
      const rank = document.createElement("span");
      rank.className = "rk";
      rank.textContent = `${i + 1}.`;
      const name = document.createElement("span");
      name.className = "nm";
      name.textContent = r.name; // 来場者の入力なので必ず textContent
      const time = document.createElement("span");
      time.className = "tm";
      time.textContent = fmtTime(r.ms);
      li.appendChild(rank);
      li.appendChild(name);
      li.appendChild(time);
      ol.appendChild(li);
    });
  }

  let lastRankId = null;
  function onFinalVictory() {
    const firstClear = !save.clearTimeMs;
    if (firstClear) {
      save.clearTimeMs = Date.now() - save.timerStart;
      save.rankSubmitted = false;
    }
    awardRunEndPoints();
    game = null;
    persistSave();
    el.clearTimeLabel.textContent = `クリアタイム ${fmtTime(save.clearTimeMs)}`;
    el.clearRankLabel.textContent = save.rankSubmitted ? "" : `このタイムなら ランキング${rankFor(save.clearTimeMs)}位！`;
    el.victoryStats.textContent = `最大ダメージ ${fmt(maxHit())}（${jpUnitText(maxHit())}）／ Lv.${save.level} ／ 挑戦 ${stat("runs")}回`;
    el.nameEntry.style.display = save.rankSubmitted ? "none" : "";
    el.nameInput.value = "";
    renderRankingList(el.victoryRanking, 10, lastRankId);
    el.victoryTeaser.innerHTML = "";
    VICTORY_TEASER.forEach((key) => {
      const f = SEALED_FEATURES[key];
      const row = document.createElement("button");
      row.className = "teaser-row";
      row.innerHTML = `<span class="seal-stamp small">封</span><span class="teaser-name"></span>`;
      row.querySelector(".teaser-name").textContent = f.name;
      row.addEventListener("click", () => showSeal(key));
      el.victoryTeaser.appendChild(row);
    });
    showScreen("finalVictory");
    renderTimer();
  }
  el.nameSubmitBtn.addEventListener("click", () => {
    if (save.rankSubmitted || !save.clearTimeMs) return;
    const name = (el.nameInput.value || "").trim().slice(0, 10) || "名無しの挑戦者";
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const list = loadRanking();
    list.push({ id, name, ms: save.clearTimeMs, at: Date.now() });
    list.sort((a, b) => a.ms - b.ms);
    saveRanking(list.slice(0, RANKING_KEEP));
    save.rankSubmitted = true;
    lastRankId = id;
    persistSave();
    const rank = loadRanking().findIndex((r) => r.id === id) + 1;
    el.clearRankLabel.textContent = rank ? `ランキング ${rank}位に登録しました！` : "登録しました！（上位20件のみ表示）";
    el.nameEntry.style.display = "none";
    renderRankingList(el.victoryRanking, 10, id);
  });
  el.nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") el.nameSubmitBtn.click(); });
  el.enterEndlessBtn.addEventListener("click", () => showSeal("endless"));
  el.victoryToHomeBtn.addEventListener("click", goHome);

  // ---------------- プレイタイマー（画面右上） ----------------
  function renderTimer() {
    if (!save.timerStart) { el.playTimer.style.display = "none"; return; }
    el.playTimer.style.display = "";
    const cleared = !!save.clearTimeMs;
    el.playTimer.classList.toggle("cleared", cleared);
    el.playTimer.textContent = (cleared ? "CLEAR " : "⏱ ") + fmtTime(cleared ? save.clearTimeMs : Date.now() - save.timerStart);
  }
  setInterval(renderTimer, 500);

  // ---------------- 戦闘画面 ----------------
  function renderBattle() {
    const enemy = enemyForFloor(game.floor);
    el.floorLabel.textContent = `階層 ${game.floor} / ${FINAL_FLOOR}　Lv.${save.level}`;
    el.enemyName.textContent = enemy.name;
    el.enemyName.classList.toggle("boss", enemy.isBoss);
    el.enemyBar.classList.toggle("boss", enemy.isBoss);
    el.enemyVisual.classList.toggle("boss", enemy.isBoss);
    el.enemyVisual.classList.toggle("has-backdrop", !enemy.isBoss);
    el.enemyVisual.classList.toggle("boss-bg", enemy.isBoss);
    if (el.enemyVisual.dataset.art !== enemy.art) {
      el.enemyVisual.dataset.art = enemy.art;
      el.enemyVisual.innerHTML = "";
      const img = document.createElement("img");
      img.src = ASSET_ROOT + enemy.art;
      img.alt = enemy.name;
      el.enemyVisual.appendChild(img);
    }
    updateEnemyHpDisplay();
    el.statN.textContent = game.n;
    el.statAtk.textContent = fmt(currentAtk());
    el.statBuff.textContent = "×" + fmtMult(buffMultiplier() * finalDamageMult());
    el.statBuff.classList.toggle("buff-active", game.buffBonus !== 0);
    el.statExp.textContent = "^" + fmtMult(currentExponent());
    el.deckCount.textContent = game.deck.length;
    el.deckPileCount.textContent = game.deck.length;
    el.handCount.textContent = game.hand.length + "枚";
    el.battleGold.textContent = fmt(game.gold);

    const prevRects = new Map();
    el.hand.querySelectorAll("[data-uid]").forEach((node) => prevRects.set(node.dataset.uid, node.getBoundingClientRect()));
    const prevDeckRect = el.deckPile.getBoundingClientRect();
    el.hand.innerHTML = "";
    const toFlip = [];
    const newUids = [];
    game.hand.forEach((card, i) => {
      const cardClass = "card " + card.type + (card.playing ? " playing" : "");
      const typeLabel = TYPE_LABELS[card.type] || "";
      let valueLabel;
      if (card.debugKill) valueLabel = "即死";
      else if (card.type === "buff") valueLabel = "×" + fmtMult(card.value);
      else valueLabel = fmt(previewDamage(card));
      const keyBadge = i < 9 ? `<div class="card-key">${i + 1}</div>` : "";
      const critNote = `<div class="card-crit-note">${(card.critRateBonus || card.critDmgBonus) ? `会心+${card.critRateBonus || 0}%/ダメ+${card.critDmgBonus || 0}%` : card.type === "buff" ? "次の攻撃を強化" : card.calc === "n" ? "攻撃力×残り手数" : ""}</div>`;
      const contentHtml = `${keyBadge}<div class="card-type">${typeLabel}</div><div class="card-name">${card.name}</div><div class="card-value">${valueLabel}</div>${critNote}`;
      if (card.justDrawn) {
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
        outer.addEventListener("click", () => playCard(card.uid));
        el.hand.appendChild(outer);
        toFlip.push(inner);
        newUids.push(String(card.uid));
        card.justDrawn = false;
      } else {
        const div = document.createElement("div");
        div.className = cardClass;
        div.dataset.uid = card.uid;
        div.innerHTML = contentHtml;
        div.addEventListener("click", () => playCard(card.uid));
        el.hand.appendChild(div);
      }
    });
    el.hand.appendChild(el.deckPile);
    el.hand.querySelectorAll("[data-uid]").forEach((node) => {
      const uid = node.dataset.uid;
      const fromRect = prevRects.get(uid) || (newUids.includes(uid) ? prevDeckRect : null);
      if (!fromRect) return;
      const newRect = node.getBoundingClientRect();
      const dx = fromRect.left - newRect.left;
      const dy = fromRect.top - newRect.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      node.style.transition = "none";
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      void node.offsetWidth;
      node.style.transition = `transform ${FLIP_SLIDE_MS}ms ease`;
      node.style.transform = "";
      setTimeout(() => { node.style.transition = ""; }, FLIP_SLIDE_MS);
    });
    if (toFlip.length) setTimeout(() => toFlip.forEach((inner) => inner.classList.add("flipped")), CARD_FLIP_DELAY_MS);
    syncEnemyVisualHeight();
  }
  function updateEnemyHpDisplay() {
    el.enemyHpNow.textContent = fmt(game.enemyHp);
    el.enemyHpMax.textContent = fmt(game.enemyHpMax);
    el.enemyHpUnit.textContent = game.enemyHpMax.gte(1e4) ? `（最大HP ${jpUnitText(game.enemyHpMax)}）` : "";
    el.enemyBar.style.width = enemyHpPct() + "%";
  }

  const narrowBattleMQ = window.matchMedia("(max-width: 860px)");
  const landscapeBattleMQ = window.matchMedia("(max-height: 520px) and (min-width: 640px) and (orientation: landscape)");
  function isStackedBattleLayout() { return narrowBattleMQ.matches && !landscapeBattleMQ.matches; }
  function syncEnemyVisualHeight() {
    if (isStackedBattleLayout()) { el.enemyVisual.style.height = ""; return; }
    const panel = el.enemyVisual.parentElement;
    const otherContentHeight = panel.scrollHeight - el.enemyVisual.offsetHeight;
    const targetTotal = el.battleSide.getBoundingClientRect().height;
    el.enemyVisual.style.height = Math.max(160, targetTotal - otherContentHeight) + "px";
  }
  window.addEventListener("resize", () => { if (activeScreen() === "battle") syncEnemyVisualHeight(); });

  // ---------------- タイトル ----------------
  function goHome() { showScreen("home"); renderHome(); }
  function renderHome() {
    el.homeLevelLabel.textContent = save.level;
    el.bestFloorLabel.textContent = save.bestFloor > 0 ? save.bestFloor : "-";
    el.homePointsLabel.textContent = fmt(save.points);
    el.homeMaxHitLabel.textContent = maxHit().gt(0) ? jpUnitText(maxHit()) : "-";
    const canBuy = NODES.some((n) => nodeState(n) === "available");
    el.treeBadge.style.display = canBuy ? "" : "none";
    el.openTreeBtn.classList.toggle("pulse", canBuy);
    el.homeSub.textContent = save.clearTimeMs
      ? `踏破おめでとう！ クリアタイム ${fmtTime(save.clearTimeMs)}。次の人に交代するときは、下の「次の人へ」を押してください。`
      : "30階の頂に座す「塔の支配者」を倒せ。敗北しても、倒した敵の力（ソウル）とレベルは持ち帰れる。";
    el.homeSealedGrid.innerHTML = "";
    HOME_SEALED.forEach((key) => {
      const b = document.createElement("button");
      b.className = "sealed-tile";
      b.innerHTML = `<span class="seal-stamp small">封</span><span class="sealed-name"></span>`;
      b.querySelector(".sealed-name").textContent = SEALED_FEATURES[key].name;
      b.addEventListener("click", () => showSeal(key));
      el.homeSealedGrid.appendChild(b);
    });
    renderRankingList(el.homeRanking, 5, lastRankId);
    renderTimer();
  }

  function defaultStartFloor() {
    const open = FLOOR_CHECKPOINTS.filter(checkpointUnlocked);
    return open[open.length - 1];
  }
  el.openFloorSelectBtn.addEventListener("click", openTowerEntry);
  el.treeGoBtn.addEventListener("click", openTowerEntry);
  // チェックポイントが1階しかないうちは、選ぶ画面を挟まずにすぐ戦闘へ
  function openTowerEntry() {
    if (FLOOR_CHECKPOINTS.filter(checkpointUnlocked).length <= 1) newRun(1);
    else { showScreen("floorSelect"); renderFloorSelect(); }
  }
  el.floorSelectBackBtn.addEventListener("click", goHome);
  el.openTreeBtn.addEventListener("click", openTree);
  el.treeBackBtn.addEventListener("click", goHome);
  el.resetProgressBtn.addEventListener("click", async () => {
    if (!(await showConfirm("プレイデータを消去して、次の人が最初から遊べる状態にします。\n（クリアタイムのランキングは消えません）\n\nよろしいですか?"))) return;
    wipeSaveAndReload();
  });
  function wipeSaveAndReload() {
    wipingSave = true;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }

  function renderFloorSelect() {
    el.floorSelectGrid.innerHTML = "";
    FLOOR_CHECKPOINTS.forEach((floor) => {
      const isBoss = floor === FINAL_FLOOR;
      const open = checkpointUnlocked(floor);
      const div = document.createElement("div");
      div.className = "floor-select-card" + (isBoss ? " boss" : "") + (open ? "" : " locked");
      div.innerHTML = `
        <div class="fs-floor${isBoss ? " boss" : ""}">${isBoss ? "ラスボス" : floor + "階"}</div>
        <div class="fs-hp">${open ? "HP " + jpUnitText(computeFloorHp(floor)) : "未到達"}</div>`;
      if (open) div.addEventListener("click", () => newRun(floor));
      el.floorSelectGrid.appendChild(div);
    });
    [["tower", "31〜100階"], ["endless", "エンドレス"]].forEach(([key, label]) => {
      const div = document.createElement("div");
      div.className = "floor-select-card sealed-card";
      div.innerHTML = `<span class="seal-stamp small">封</span><div class="fs-floor">${label}</div><div class="fs-hp">封印</div>`;
      div.addEventListener("click", () => showSeal(key));
      el.floorSelectGrid.appendChild(div);
    });
  }

  // ---------------- 基本強化ツリー ----------------
  function nodeState(node) {
    if (save.unlockedNodes[node.id]) return "unlocked";
    if (node.requires !== null && !save.unlockedNodes[node.requires]) return "locked";
    return save.points >= node.cost ? "available" : "unaffordable";
  }
  function openTree() {
    showScreen("tree");
    renderTree();
    centerTreeOnRoot();
    if (!save.hints.tree) {
      save.hints.tree = true;
      persistSave();
      showToast("ソウルを使って強化を習得しよう。金色の枠が今すぐ習得できるノード。");
    }
  }
  function renderTree() {
    el.treePointsLabel.textContent = fmt(save.points);
    el.treeMap.innerHTML = "";
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "tree-map-svg");
    svg.setAttribute("viewBox", `0 0 ${TREE_CANVAS_WIDTH} ${TREE_CANVAS_HEIGHT}`);
    const addLine = (fromId, toId, cls) => {
      const from = TREE_POS[fromId];
      const to = TREE_POS[toId];
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", from.x);
      line.setAttribute("y1", from.y);
      line.setAttribute("x2", to.x);
      line.setAttribute("y2", to.y);
      if (cls) line.setAttribute("class", cls);
      svg.appendChild(line);
    };
    NODES.forEach((node) => { if (node.requires) addLine(node.requires, node.id, save.unlockedNodes[node.id] ? "active" : ""); });
    SEALED_NODES.forEach((s) => addLine(s.requires, s.id, "sealed"));
    el.treeMap.appendChild(svg);

    NODES.forEach((node) => {
      const pos = TREE_POS[node.id];
      const state = nodeState(node);
      const div = document.createElement("div");
      div.className = "tree-map-node " + state;
      div.style.left = pos.x + "px";
      div.style.top = pos.y + "px";
      const costLabel = state === "unlocked" ? "習得済み" : `${node.cost} ソウル`;
      div.innerHTML = `<div class="tn-name">${node.label}</div><div class="tn-desc">${node.desc}</div><div class="tn-cost">${costLabel}</div>`;
      if (state === "available") {
        div.addEventListener("click", () => {
          if (nodeState(node) !== "available") return;
          save.points -= node.cost;
          save.unlockedNodes[node.id] = true;
          if (node.kind === "startCards") node.cards.forEach((c) => addCardToDeckDefs(save.deckDefs, c));
          else if (node.kind === "grantPoints") save.points += node.pointsGrant;
          persistSave();
          renderTree();
        });
      }
      el.treeMap.appendChild(div);
    });
    SEALED_NODES.forEach((s) => {
      const pos = TREE_POS[s.id];
      const div = document.createElement("div");
      div.className = "tree-map-node sealed";
      div.style.left = pos.x + "px";
      div.style.top = pos.y + "px";
      div.innerHTML = `<span class="seal-stamp small">封</span><div class="tn-name">？？？</div><div class="tn-desc">封印されている</div>`;
      div.addEventListener("click", () => showSeal("tree"));
      el.treeMap.appendChild(div);
    });
  }

  // ドラッグでパン（本編と同じ）
  function setupDragPan(wrap) {
    let dragging = false, moved = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    const DRAG_THRESHOLD = 5;
    function pointerDown(x, y) {
      dragging = true; moved = false;
      startX = x; startY = y;
      startLeft = wrap.scrollLeft; startTop = wrap.scrollTop;
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
    function pointerUp() { dragging = false; wrap.classList.remove("dragging"); }
    wrap.addEventListener("mousedown", (e) => pointerDown(e.pageX, e.pageY));
    window.addEventListener("mousemove", (e) => pointerMove(e.pageX, e.pageY, e));
    window.addEventListener("mouseup", pointerUp);
    wrap.addEventListener("touchstart", (e) => {
      if (e.touches.length > 1) { dragging = false; moved = true; wrap.classList.remove("dragging"); return; }
      pointerDown(e.touches[0].pageX, e.touches[0].pageY);
    }, { passive: true });
    wrap.addEventListener("touchmove", (e) => {
      if (e.touches.length > 1) { dragging = false; return; }
      pointerMove(e.touches[0].pageX, e.touches[0].pageY, e);
    }, { passive: false });
    wrap.addEventListener("touchend", pointerUp);
    wrap.addEventListener("touchcancel", pointerUp);
    wrap.addEventListener("click", (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); } }, true);
  }
  setupDragPan(el.treeScrollWrap);

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

  const narrowScreen = window.matchMedia("(max-width: 640px)");
  const TREE_ZOOM_MIN = 0.35;
  const TREE_ZOOM_MAX = 2;
  // 本編より引き気味で開く: ノードが少ないので、全体が見渡せるほうが次に何を取るか決めやすい
  const TREE_OPEN_ZOOM = 0.95;
  const TREE_OPEN_ZOOM_NARROW = 0.6;
  let treeZoom = 1;
  function applyTreeZoom() {
    el.treeMap.style.width = TREE_CANVAS_WIDTH + "px";
    el.treeMap.style.height = TREE_CANVAS_HEIGHT + "px";
    el.treeMap.style.transform = `scale(${treeZoom})`;
    el.treeMapScaler.style.width = (TREE_CANVAS_WIDTH * treeZoom) + "px";
    el.treeMapScaler.style.height = (TREE_CANVAS_HEIGHT * treeZoom) + "px";
  }
  applyTreeZoom();
  function centerTreeOnRoot() {
    treeZoom = narrowScreen.matches ? TREE_OPEN_ZOOM_NARROW : TREE_OPEN_ZOOM;
    applyTreeZoom();
    const wrap = el.treeScrollWrap;
    wrap.scrollLeft = ROOT.x * treeZoom - wrap.clientWidth / 2;
    wrap.scrollTop = ROOT.y * treeZoom - wrap.clientHeight / 2;
  }
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
    const contentX = (wrap.scrollLeft + cursorX) / treeZoom;
    const contentY = (wrap.scrollTop + cursorY) / treeZoom;
    setTreeZoom(treeZoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    wrap.scrollLeft = contentX * treeZoom - cursorX;
    wrap.scrollTop = contentY * treeZoom - cursorY;
  }, { passive: false });
  setupPinchZoom(el.treeScrollWrap, () => treeZoom, setTreeZoom);

  // ---------------- キーボード（展示用のテンポ） ----------------
  // 戦闘: 1〜9 で手札を左から使う / 商人・敗北画面: Enter で次へ
  document.addEventListener("keydown", (e) => {
    if (modalOpen() || e.repeat) return;
    if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
    const screen = activeScreen();
    if (screen === "battle" && game && /^[1-9]$/.test(e.key)) {
      const card = game.hand[Number(e.key) - 1];
      if (card) playCard(card.uid);
    } else if (screen === "floorClear" && e.key === "Enter") {
      e.preventDefault();
      goNextFloor();
    } else if (screen === "runEnd" && e.key === "Enter") {
      e.preventDefault();
      el.runEndTreeBtn.click();
    }
  });

  // ---------------- デバッグコンソール ----------------
  function refreshActiveScreen() {
    const screen = activeScreen();
    if (screen === "home") renderHome();
    else if (screen === "tree") renderTree();
    else if (screen === "battle" && game) renderBattle();
    else if (screen === "floorClear" && game) renderShop();
  }
  if (DEV_CONSOLE) {
    window.mt = {
      reset() { wipeSaveAndReload(); },
      get points() { return save.points; },
      set points(n) { save.points = Math.max(0, Math.floor(Number(n) || 0)); persistSave(); refreshActiveScreen(); },
      addPoints(n) { this.points = save.points + Number(n || 0); return save.points; },
      get gold() { return game ? game.gold : null; },
      set gold(n) { if (game) { game.gold = Math.max(0, Math.floor(Number(n) || 0)); refreshActiveScreen(); } },
      get level() { return save.level; },
      addExp(n) { const lv = gainExp(n); persistSave(); refreshActiveScreen(); return `Lv.${save.level}（+${lv}）`; },
      hp(floor) { return jpUnitText(computeFloorHp(floor)) + " / " + fmt(computeFloorHp(floor)); },
      get ranking() { return loadRanking(); },
      clearRanking() { saveRanking([]); refreshActiveScreen(); return "ランキングを消去しました"; },
      help() {
        console.info([
          "マギア・タワー 文化祭体験版 デバッグコンソール",
          "  mt.points / mt.points = 999 / mt.addPoints(100)   ソウル",
          "  mt.gold = 9999                                     ゴールド（ラン中のみ）",
          "  mt.level / mt.addExp(1e30)                         レベル",
          "  mt.hp(25)                                          その階の敵HP",
          "  mt.ranking / mt.clearRanking()                     クリアタイムのランキング",
          "  mt.reset()                                         プレイデータを消去（確認なし・ランキングは残る）",
          "  URLに ?debug=1 を付けると手札に【DEBUG】即死 が入る",
        ].join("\n"));
      },
    };
    console.info("[mt] デバッグコンソール有効。使い方は mt.help()");
  }

  // ---------------- 初期化 ----------------
  goHome();
  window.addEventListener("pagehide", persistSave);
})();
