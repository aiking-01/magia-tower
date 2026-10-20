// long-run progression bot: plays from a fresh save for N hours of game time and prints a line per hour.
// AUTO plays the cards (with 自動購入); between runs it buys the tree in bulk, 拡張強化 cheapest first, card-shop
// cards and attack ranks; it reincarnates once a loop stops improving (3 runs in a row) and then buys the panel in
// bulk and the 超越の刻印 with what is left. Time is counted at a person's pace (AUTO ×1), however fast it runs.
//   node tools/sim/bot.js [hours=8] [seed=1] [label]
const { create, mulberry32 } = require("../lib/harness");

const hours = Number(process.argv[2] || 8);
const seed = Number(process.argv[3] || 1);
const label = process.argv[4] || "bot";

(async () => {
  const h = create(JSON.stringify({ autoPlay: { on: true, loop: false, speed: 4 }, autoBuyEnabled: true }), { random: mulberry32(seed), fast: true });
  const g = h.g;
  const S = () => g.save;
  // game time: every card is ~0.6s by hand and every floor ~1.5s more, whatever speed the sim runs at
  let cardsAtReport = 0;
  let floorsAtReport = 0;
  let gameSeconds = 0;
  const tick = () => {
    const c = S().stats.cardsPlayed || 0;
    const f = S().stats.kills || 0;
    gameSeconds += (c - cardsAtReport) * 0.6 + (f - floorsAtReport) * 1.5;
    cardsAtReport = c;
    floorsAtReport = f;
  };
  let nextReport = 3600;
  let loopBest = 0;
  let staleRuns = 0;
  let firstClear = null;
  const report = (tag) => {
    const s = S();
    console.log(`${label} ${tag} t=${(gameSeconds / 3600).toFixed(2)}h best=${s.stats.maxCleared || 0} loop=${loopBest} Lv${s.level} reinc=${s.stats.reincarnations || 0} `
      + `maxHit=${g.maxHit().toExponential(2)} ach=${Object.keys(s.achievements).length} items=${g.itemsOwnedTotal()} tp=${Number(s.transcendPoints).toExponential(2)} mark=${s.panelLevels.panelMark || 0}`);
  };
  function spend() {
    const s = S();
    g.bulkBuyTree();
    if (g.shopUnlockedCount() > 0) {
      for (let k = 0; k < 20; k++) {
        const it = g.CARD_SHOP_POOL.slice(0, g.shopUnlockedCount()).map((i) => [i, g.cardShopPrice(i)]).filter(([, p]) => p <= s.points * 0.3).sort((a, b) => a[1] - b[1])[0];
        if (!it) break;
        s.points -= it[1];
        s.cardShopPurchases[it[0].id] = (s.cardShopPurchases[it[0].id] || 0) + 1;
        const ex = s.deckDefs.find((d) => d.name === it[0].card.name && d.type === it[0].card.type);
        if (ex) { ex.count += 1; if (ex.active != null) ex.active += 1; } else s.deckDefs.push(Object.assign({}, it[0].card, { count: 1 }));
      }
    }
    for (let k = 0; k < 500; k++) {
      const d = g.treeExtUnlocked().map((x) => [x, g.treeExtCost(x)]).sort((a, b) => a[1] - b[1])[0];
      if (!d || d[1] > s.points) break;
      s.points -= d[1];
      s.treeExt[d[0].id] = g.treeExtLevel(d[0]) + 1;
    }
    for (let k = 0; k < 50; k++) {
      const d = s.deckDefs.filter((x) => x.type === "attack").map((x) => [x, g.rankUpCost(x)]).sort((a, b) => a[1] - b[1])[0];
      if (!d || d[1] > s.points * 0.5) break;
      s.points -= d[1];
      d[0].rank = (d[0].rank || 0) + 1;
    }
    g.persistSave();
  }
  while (gameSeconds < hours * 3600) {
    spend();
    g.newRun(1);
    let runBest = 0;
    for (let i = 0; i < 200000; i++) {
      await h.flush(2000);
      const scr = h.screen();
      if (g.game) runBest = Math.max(runBest, g.game.floor - 1);
      if (scr === "finalVictory") {
        if (firstClear == null) { tick(); firstClear = gameSeconds; report("FIRST CLEAR"); }
        h.w.document.getElementById("enterEndlessBtn").click();
        continue;
      }
      if (scr === "defeat" || scr === "retreat" || !g.game) break;
    }
    g.game = null;
    tick();
    if (runBest > loopBest) { loopBest = runBest; staleRuns = 0; } else staleRuns += 1;
    if (S().transcendUnlocked && staleRuns >= 3 && S().level > 40) {
      g.reincarnateNow();
      g.bulkBuyPanel();
      // what the panel can't use goes into the 超越の刻印
      for (let k = 0; k < 100; k++) {
        const s = S();
        if (!g.PANEL_SPECIALS.every((sp) => s.panelSpecials[sp.id])) break;
        const cost = Math.ceil(g.PANEL_MARK.baseCost * Math.pow(g.PANEL_MARK.costMult, s.panelLevels.panelMark || 0));
        if (s.transcendPoints < cost) break;
        s.transcendPoints -= cost;
        s.panelLevels.panelMark = (s.panelLevels.panelMark || 0) + 1;
      }
      S().trialPending = false;
      g.leavePanel();
      loopBest = 0;
      staleRuns = 0;
    }
    while (gameSeconds >= nextReport) { report("hour"); nextReport += 3600; }
  }
  report("END");
  if (h.errors.length) console.log("ERRORS:\n" + [...new Set(h.errors)].slice(0, 5).join("\n"));
  process.exit(0);
})();
