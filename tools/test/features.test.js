// 秘宝の覚醒・破魔の護符, 超越の刻印, 倍率の内訳 (adds up to the real multiplier), speed unlocks
const { create, mulberry32 } = require("../lib/harness");

module.exports = async (t) => {
  // ---- 覚醒 ----
  let h = create(JSON.stringify({ transcendUnlocked: true, level: 50, exp: "0", unlockedNodes: { root: true }, items: { dragonHeart: 3, philosopherStone: 3 } }), { random: mulberry32(2) });
  let g = h.g;
  g.newRun(1);
  await h.flush(400);
  const heart = g.ITEM_DEFS.find((d) => d.id === "dragonHeart");
  const stone = g.ITEM_DEFS.find((d) => d.id === "philosopherStone");
  const before = g.finalDamageMult();
  // the pool: a maxed multiplier 秘宝 comes back as its 覚醒, a maxed 累乗 one never does
  let sawHeartAwaken = false;
  let sawStone = false;
  for (let i = 0; i < 400; i++) {
    g.game.guaranteedItem = true;
    g.rollItemOffers();
    g.game.itemOffers.forEach((o) => {
      if (o.def === heart) { t.ok(o.awaken, "a maxed 竜の心臓 must be offered as 覚醒"); sawHeartAwaken = true; }
      if (o.def === stone) sawStone = true;
    });
  }
  t.ok(sawHeartAwaken, "竜の心臓の覚醒 never came up");
  t.ok(!sawStone, "賢者の石 (累乗) must never awaken");
  const offer = { def: heart, awaken: true, cost: 1, bought: false };
  g.game.gold = 10;
  t.ok(g.buyItemOffer(offer), "buying a 覚醒");
  t.ok(g.itemAwakenLevel(heart) === 1, "覚醒 level 1");
  // ×3 -> ×(1 + 2×1.5) = ×4 per copy, three copies
  t.ok(Math.abs(g.finalDamageMult() / before - Math.pow(4 / 3, 3)) < 1e-9, "覚醒 should make each 竜の心臓 ×4: " + g.finalDamageMult() / before);
  g.game = null;
  g.reincarnateNow();
  t.ok(!g.save.itemAwaken || Object.keys(g.save.itemAwaken).length === 0, "reincarnation clears 覚醒");

  // 破魔の護符: only past 100F, multiplies against 特性 enemies only
  h = create(JSON.stringify({ transcendUnlocked: true, level: 300, exp: "0", unlockedNodes: { root: true }, bestClearedFloor: 999, items: { wardCharm: 2 } }), { random: mulberry32(3) });
  g = h.g;
  g.newRun(151);
  await h.flush(400);
  g.game.traits = [];
  const noTrait = g.situationalItemMult();
  g.game.traits = ["regen"];
  t.ok(Math.abs(g.situationalItemMult() / noTrait - 16) < 1e-9, "破魔の護符 ×4 ×2 copies against a 特性 enemy");
  g.game.floor = 50;
  let wardAt50 = false;
  for (let i = 0; i < 400; i++) {
    g.game.guaranteedItem = true;
    g.rollItemOffers();
    if (g.game.itemOffers.some((o) => o.def.id === "wardCharm")) wardAt50 = true;
  }
  t.ok(!wardAt50, "破魔の護符 (and its 覚醒) must not be sold at or below 100F");

  // ---- 超越の刻印 ----
  h = create(JSON.stringify({ transcendUnlocked: true, transcendPoints: 1e9, panelSpecials: { panelCritRateBurst: true, panelCritMultDouble: true } }));
  g = h.g;
  h.w.document.getElementById("openPanelPreviewBtn").click();
  const markNode = () => h.w.document.querySelector("#panelMap .panel-mark");
  t.ok(markNode() && /\blocked\b/.test(markNode().className), "刻印 locked until every special is owned");
  g.save.panelSpecials.panelDmgFormula = true;
  g.renderPanel();
  t.ok(/\bavailable\b/.test(markNode().className), "刻印 available once the specials are done");
  const progress = g.panelProgress();
  markNode().click();
  markNode().click();
  t.ok(g.save.panelLevels.panelMark === 2 && Math.abs(g.save.transcendPoints - (1e9 - 1e7 - 2.5e7)) < 1, "two levels bought at 1000万 then 2500万: " + g.save.transcendPoints);
  t.ok(g.panelProgress() === progress, "刻印 must not count toward the circle's progress");
  g.bulkBuyPanel();
  t.ok(g.save.panelLevels.panelMark === 2, "一括購入 must not buy 刻印");
  g.newRun(1);
  await h.flush(400);
  t.ok(Math.abs(g.finalDamageMult() - 2.25) < 1e-9, "刻印 Lv2 = ×2.25 (nothing else multiplies here): " + g.finalDamageMult());

  // ---- 倍率の内訳 adds up ----
  h = create(JSON.stringify({ transcendUnlocked: true, level: 120, exp: "0", unlockedNodes: { root: true, n1: true, n2: true, nHand1: true }, items: { dragonHeart: 1, philosopherStone: 1 }, panelLevels: { panelExponent: 5 } }), { random: mulberry32(4) });
  g = h.g;
  g.newRun(10);
  await h.flush(400);
  g.game.buffBonus = 2;
  const b = g.damageBreakdown();
  const sec = (title) => b.sections.find((x) => x.title === title);
  t.ok(["基礎攻撃力", "バフ", "レベル倍率", "累乗", "最終倍率", "会心", "その場の倍率"].every((x) => !!sec(x)), "all sections present");
  const num = (v) => Number(String(v).replace(/[×,]/g, ""));
  t.ok(Math.abs(num(sec("累乗").total) - g.currentExponent()) < 0.01, "累乗 total");
  const expect = g.damageMultiplier().mul(g.situationalItemMult()).toNumber();
  t.ok(Math.abs(num(b.next) / expect - 1) < 0.01, `内訳の倍率 ${b.next} vs ${expect}`);
  h.w.document.getElementById("statBuff").parentElement.click();
  t.ok(h.w.document.getElementById("breakdownPanel").classList.contains("active") && h.w.document.getElementById("breakdownBody").textContent.includes("累乗"), "tapping 倍率 opens the breakdown");

  // ---- speed unlocks ----
  h = create(JSON.stringify({ autoPlay: { on: false, loop: false, speed: 4 } }));
  t.ok(h.g.gameSpeed() === 1 && h.g.autoSpeeds().join() === "1", "fresh save: ×1 only even if ×4 was saved");
  h = create(JSON.stringify({ transcendUnlocked: true, autoPlay: { on: false, loop: false, speed: 4 } }));
  t.ok(h.g.gameSpeed() === 1 && h.g.autoSpeeds().join() === "1,2", "after the first clear: ×2");
  h = create(JSON.stringify({ transcendUnlocked: true, stats: { maxCleared: 500 }, autoPlay: { on: false, loop: false, speed: 4 } }));
  t.ok(h.g.gameSpeed() === 4, "500F cleared: the saved ×4 counts again");
  t.ok(h.errors.length === 0, "errors: " + h.errors.slice(0, 3).join(" | "));
};
