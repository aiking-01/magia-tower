// src/02-tree.js — part of game.js (basic tree definition and layout). Edit here, then run: node tools/build.js
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
  // With `center` (a point in posMap), the canvas is laid out symmetrically around it, so that node
  // (the tree's 起点, the panel's 核) is the exact middle of the map: centred at every zoom level,
  // and still in the middle when the whole map fits on screen.
  // `minHalf` widens the canvas to at least that far from the centre in every direction (the magic
  // circle drawn behind the nodes reaches further out than the outermost node).
  function fitCanvasToPositions(posMap, edgePad, center, minHalf) {
    const pts = Object.values(posMap);
    if (center) {
      const cx = center.x;
      const cy = center.y;
      const halfW = Math.max(minHalf || 0, Math.max(...pts.map((p) => Math.abs(p.x - cx))) + edgePad);
      const halfH = Math.max(minHalf || 0, Math.max(...pts.map((p) => Math.abs(p.y - cy))) + edgePad);
      pts.forEach((p) => { p.x = p.x - cx + halfW; p.y = p.y - cy + halfH; });
      return { width: halfW * 2, height: halfH * 2 };
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs) - edgePad;
    const maxX = Math.max(...xs) + edgePad;
    const minY = Math.min(...ys) - edgePad;
    const maxY = Math.max(...ys) + edgePad;
    pts.forEach((p) => { p.x -= minX; p.y -= minY; });
    return { width: maxX - minX, height: maxY - minY };
  }
  const TREE_EDGE_PAD = 90; // half a node's footprint (card is 84px wide, plus its text/border) so nothing clips
  // how far the backdrop reaches past its last ring: the outer band (+80, see drawMagicBackdrop), the
  // golden aura once complete (+60) and a little air
  const MAGIC_CIRCLE_REACH = 80 + 60 + 20;
  // the tree's magic-circle rings (150, 300, then every 140 out past the farthest node)
  function treeMagicRings() {
    const root = TREE_POS.root;
    const maxR = Math.max(...Object.values(TREE_POS).map((q) => Math.hypot(q.x - root.x, q.y - root.y)));
    const rings = [150, 300];
    for (let r = 440; r < maxR + 60; r += 140) rings.push(r);
    return rings;
  }
  const TREE_RINGS = treeMagicRings();
  const { width: TREE_CANVAS_WIDTH, height: TREE_CANVAS_HEIGHT } =
    fitCanvasToPositions(TREE_POS, TREE_EDGE_PAD, TREE_POS.root, TREE_RINGS[TREE_RINGS.length - 1] + MAGIC_CIRCLE_REACH);

