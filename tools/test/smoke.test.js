// basic health: a fresh save plays, an old save loads, reincarnation resets what it should, the panel chains lock
// and unlock in order
const { create, mulberry32 } = require("../lib/harness");

module.exports = async (t) => {
  // fresh save: a few runs with the tree bought in between
  let h = create(null, { random: mulberry32(1) });
  let g = h.g;
  for (let run = 0; run < 6; run++) {
    g.bulkBuyTree();
    g.newRun(1);
    for (let i = 0; i < 400 && g.game && h.screen() !== "defeat"; i++) {
      await h.flush(300);
      if (h.screen() === "battle" && !g.game.gameOver && !g.game.followUpBusy) {
        const c = g.chooseAutoCard();
        if (c) g.playCard(c.uid);
      } else if (h.screen() === "floorClear") g.goNextFloor();
    }
    g.game = null;
  }
  t.ok((g.save.stats.maxCleared || 0) >= 3, "fresh runs cleared too little: " + g.save.stats.maxCleared);
  t.ok(h.errors.length === 0, "fresh errors: " + h.errors.slice(0, 3).join(" | "));

  // an old save: no items/autoPlay fields, old 拡張強化 levels, plain-number exp and maxHit
  const old = JSON.stringify({
    points: 100, level: 50, exp: "10", unlockedNodes: { root: true, atk1: true }, treeExt: { extAtk: 5 },
    panelLevels: { panelTreeExt: 1, panelShop: 4 }, transcendUnlocked: true, transcendPoints: 1e6, stats: { maxHit: 12345 },
    deckDefs: [{ type: "attack", name: "斬撃", value: 15, count: 9 }],
  });
  h = create(old);
  g = h.g;
  t.ok(g.save.items && typeof g.save.items === "object", "old save: items not initialised");
  t.ok(g.save.autoPlay && g.save.autoPlay.speed === 1, "old save: autoPlay not initialised");
  g.newRun(1);
  await h.flush(400);
  t.ok(Math.abs(g.levelDamageMult().toNumber() - Math.pow(1.025, 49)) < 1e-6, "level multiplier wrong at Lv50");
  t.ok(g.damageMultiplier().gt(1), "damage multiplier should include the level multiplier");
  g.save.items = { dragonHeart: 2 };
  t.ok(g.finalDamageMult() >= 9 - 1e-9, "竜の心臓×2 should give ×9: " + g.finalDamageMult());
  g.game = null;
  g.reincarnateNow();
  t.ok(Object.keys(g.save.items).length === 0, "reincarnation must clear items");
  t.ok(g.save.level === 1 && g.save.points >= 0, "reincarnation must reset level");
  t.ok(h.errors.length === 0, "old save errors: " + h.errors.slice(0, 3).join(" | "));

  // panel: 秘宝の契約 waits for 商人との契約, 輪廻の理 for 継承の記憶; bulk buy finishes both, never 苦難の門
  h = create(JSON.stringify({ transcendUnlocked: true, transcendPoints: 1e12, panelLevels: { panelShop: 3 } }));
  g = h.g;
  h.w.document.getElementById("openPanelPreviewBtn").click();
  const cls = (re) => h.w.eval(`[...document.querySelectorAll("#panelMap .tree-map-node")].filter((n) => ${re}.test(n.textContent)).map((n) => n.className)[0] || ""`);
  t.ok(/\blocked\b/.test(cls("/秘宝の契約 1/")), "item chain should be locked until 商人との契約 is finished");
  t.ok(/\blocked\b/.test(cls("/輪廻の理 1/")), "輪廻の理 should be locked until 継承の記憶 is finished");
  g.bulkBuyPanel();
  t.ok(g.save.panelLevels.panelItem === 12, "bulk buy should finish 秘宝の契約: " + g.save.panelLevels.panelItem);
  t.ok(g.save.panelLevels.panelTranscendPower === 4, "bulk buy should finish 輪廻の理: " + g.save.panelLevels.panelTranscendPower);
  t.ok(!g.save.panelLevels.panelTrial, "bulk buy must not buy 苦難の門");
  t.ok(Math.abs(g.transcendPower() - 3) < 1e-9, "輪廻の理 ×4 should make the payout Lv^3");
  t.ok(h.errors.length === 0, "panel errors: " + h.errors.slice(0, 3).join(" | "));
};
