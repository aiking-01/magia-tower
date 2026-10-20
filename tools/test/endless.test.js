// endless: 特性 (chances, exclusions, each effect), 深層の守護者, the "打つ手がない" fix, AUTO's 特性 handling
const { create, mulberry32 } = require("../lib/harness");

// Math.random that first returns the queued values, then a seeded stream
function scripted(queue, seed) {
  const rest = mulberry32(seed || 1);
  return () => (queue.length ? queue.shift() : rest());
}
const strong = JSON.stringify({ transcendUnlocked: true, level: 300, exp: "0", unlockedNodes: { root: true }, bestClearedFloor: 999 });

module.exports = async (t) => {
  // ---- chances and exclusions ----
  let h = create(strong, { random: mulberry32(5) });
  let g = h.g;
  const share = (floor) => {
    let n = 0;
    let two = 0;
    for (let i = 0; i < 4000; i++) {
      const tr = g.rollTraits(floor);
      if (tr.length) n += 1;
      if (tr.length === 2) {
        two += 1;
        t.ok(!["harden,miasma", "miasma,harden", "harden,phantom", "phantom,harden"].includes(tr.join(",")), "excluded pair rolled: " + tr);
      }
    }
    return { any: n / 4000, two: two / 4000 };
  };
  t.ok(g.rollTraits(100).length === 0 && g.rollTraits(57).length === 0, "no 特性 up to 100F");
  const s150 = share(150), s250 = share(250), s350 = share(350), s600 = share(650);
  t.ok(Math.abs(s150.any - 0.25) < 0.04 && s150.two === 0, "150F ≈25%: " + JSON.stringify(s150));
  t.ok(Math.abs(s250.any - 0.4) < 0.04, "250F ≈40%: " + JSON.stringify(s250));
  t.ok(Math.abs(s350.any - 0.6) < 0.04 && s350.two === 0, "350F ≈60%, one only: " + JSON.stringify(s350));
  t.ok(Math.abs(s600.two - 0.18) < 0.04, "650F: two 特性 ≈18%: " + JSON.stringify(s600));

  // ---- guardians ----
  const gd = g.enemyForFloor(200);
  t.ok(gd.isGuardian && gd.isBoss && gd.traits.length === 2 && gd.name === "第2層の守護者", "200F guardian: " + JSON.stringify(gd));
  t.ok(g.enemyHpForFloor(200).div(g.computeFloorHp(200)).toNumber() === 3, "guardian HP ×3");
  t.ok(!g.enemyForFloor(100).isGuardian && g.enemyForFloor(110).isMidBoss, "100F is still the final boss, 110F a mid-boss");
  for (let f = 200; f <= 3000; f += 100) {
    const tr = g.guardianForFloor(f).traits;
    t.ok(!(tr.includes("harden") && (tr.includes("miasma") || tr.includes("phantom"))), `guardian ${f}F has an excluded pair`);
  }

  // ---- effects (traits forced onto a running floor) ----
  g.newRun(151);
  await h.flush(400);
  const gm = () => g.game;
  const attack = { type: "attack", name: "斬撃", value: 15, rank: 0, uid: -1 };
  const withTraits = (list) => { gm().traits = list; gm().phantomUsed = false; };
  // 鉄壁: non-crit ×0.25, crit untouched
  withTraits(["armor"]);
  const D = h.D;
  t.ok(g.applyTraitsToHit(new D(1000), false).eq(250) && g.applyTraitsToHit(new D(1000), true).eq(1000), "鉄壁: non-crit ×0.25, crit untouched");
  withTraits([]);
  t.ok(g.applyTraitsToHit(new D(1000), false).eq(1000), "no 特性: hit unchanged");
  // 硬化 caps at 30% of max HP
  withTraits(["harden"]);
  const cap = gm().enemyHpMax.mul(0.3).ceil();
  // drive real card plays for 幻影 / 鏡面 / 硬化
  const playOne = async (card) => {
    gm().hand.unshift(card);
    gm().inputReadyAt = 0;
    g.playCard(card.uid);
    await h.flush(400);
  };
  // 幻影: the first damage card deals nothing
  withTraits(["phantom"]);
  gm().enemyHp = gm().enemyHpMax;
  const hpBefore = gm().enemyHp;
  await playOne(Object.assign({}, attack, { uid: 900001 }));
  t.ok(gm().enemyHp.eq(hpBefore), "幻影 should swallow the first hit");
  await playOne(Object.assign({}, attack, { uid: 900002 }));
  t.ok(gm().enemyHp.lt(hpBefore) || gm().gameOver, "the second hit lands");
  // 硬化: one huge hit takes at most 30%
  if (!gm().gameOver) {
    withTraits(["harden"]);
    gm().phantomUsed = true;
    gm().enemyHp = gm().enemyHpMax;
    gm().n = 5;
    await playOne({ type: "attack", name: "【DEBUG】確定会心", value: 1e30, rank: 0, uid: 900003, forceCrit: true });
    const lost = gm().enemyHpMax.sub(gm().enemyHp);
    t.ok(lost.lte(cap.mul(1.0001)) && lost.gt(0), `硬化 cap: lost ${lost} cap ${cap}`);
  }
  // 鏡面: 処刑の火 does nothing
  if (!gm().gameOver) {
    withTraits(["mirror"]);
    gm().enemyHp = gm().enemyHpMax;
    gm().n = 5;
    gm().percentUsed = false;
    await playOne({ type: "percent", name: "処刑の火", value: 0.3, rank: 0, uid: 900004 });
    t.ok(gm().enemyHp.eq(gm().enemyHpMax), "鏡面 should block 処刑の火");
  }
  // 呪縛 halves a buff's bonus
  withTraits([]);
  const full = g.buffApplied(3);
  withTraits(["curse"]);
  t.ok(Math.abs(g.buffApplied(3) - 1 - (full - 1) / 2) < 1e-9, `呪縛: ${g.buffApplied(3)} vs ${full}`);
  // 再生 heals 8% after a move that doesn't kill
  if (!gm().gameOver) {
    withTraits(["regen"]);
    gm().phantomUsed = true;
    gm().enemyHp = gm().enemyHpMax.mul(0.5).ceil();
    gm().n = 5;
    await playOne({ type: "buff", name: "双撃の構え", value: 2, rank: 0, uid: 900005 });
    const ratio = gm().enemyHp.div(gm().enemyHpMax).toNumber();
    t.ok(Math.abs(ratio - 0.58) < 0.01, "再生 should heal 8%: " + ratio);
  }
  t.ok(h.errors.length === 0, "effect errors: " + h.errors.slice(0, 3).join(" | "));

  // 瘴気 / 狂化 apply when the floor starts: script the dice (chance, then which 特性)
  const idx = (id) => (["armor", "regen", "curse", "miasma", "mirror", "frenzy", "phantom", "harden"].indexOf(id) + 0.5) / 8;
  h = create(strong, { random: scripted([]) });
  g = h.g;
  h.w.Math.random = scripted([0.01, idx("miasma")], 2);
  g.newRun(151);
  await h.flush(400);
  t.ok(g.game.traits[0] === "miasma" && g.game.n === g.game.floorStartN && g.game.n === 4, "瘴気: 5 moves -> 4: " + g.game.n);
  g.game = null;
  h.w.Math.random = scripted([0.01, idx("frenzy")], 3);
  g.newRun(151);
  await h.flush(400);
  t.ok(g.game.traits[0] === "frenzy" && g.game.enemyHpMax.div(g.enemyHpForFloor(151)).toNumber() === 2, "狂化: HP ×2");

  // ---- 打つ手がない: a hand of spent 処刑の火 ends the floor instead of freezing it ----
  g.game.traits = [];
  g.game.percentUsed = true;
  g.game.hand = [1, 2, 3].map((i) => ({ type: "percent", name: "処刑の火", value: 0.3, rank: 0, uid: 800000 + i }));
  g.game.enemyHp = g.game.enemyHpMax;
  g.game.n = 3;
  g.checkResult();
  await h.flush(1000);
  t.ok(h.screen() === "defeat", "no usable card should end the floor: " + h.screen());

  // ---- AUTO under 幻影 opens with the weakest damage card ----
  h = create(strong, { random: mulberry32(8) });
  g = h.g;
  g.newRun(151);
  await h.flush(400);
  g.game.traits = ["phantom"];
  g.game.phantomUsed = false;
  g.game.hand = [
    { type: "attack", name: "強撃", value: 20, rank: 0, uid: 1 },
    { type: "buff", name: "双撃の構え", value: 2, rank: 0, uid: 2 },
    { type: "attack", name: "斬撃", value: 15, rank: 0, uid: 3 },
  ];
  t.ok(g.chooseAutoCard().uid === 3, "AUTO should open a 幻影 floor with the weakest attack");

  // ---- a guardian kill guarantees a 秘宝 at the next merchant ----
  g.game.guaranteedItem = true;
  g.game.floor = 201;
  g.rollItemOffers();
  t.ok(g.game.itemOffers.length >= 1, "a guardian kill must put a 秘宝 on offer");
  t.ok(h.errors.length === 0, "errors: " + h.errors.slice(0, 3).join(" | "));
};
