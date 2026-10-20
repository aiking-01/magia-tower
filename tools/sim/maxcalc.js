// 理論上の到達限界: with everything bought (tree, panel incl. N levels of 超越の刻印, every 苦難, every achievement,
// every 秘宝 at its cap with A levels of 覚醒, 拡張強化 at level L), find the deepest boss floor whose HP one perfect
// turn still beats -- 10 buffs (狂乱の咆哮) then 終焉の使者, a crit, on a boss, as the floor's first hit, on a 特性 enemy.
// The level is what climbing to that floor pays (exp = Σ HP).   node tools/sim/maxcalc.js [L=25] [mark=0] [awaken=0]
const { create } = require("../lib/harness");

const extL = Number(process.argv[2] || 25);
const mark = Number(process.argv[3] || 0);
const awaken = Number(process.argv[4] || 0);
const h = create(null);
const g = h.g;
const D = h.D;
const s = g.save;
g.NODES.forEach((n) => { s.unlockedNodes[n.id] = true; if (n.kind === "startCards") n.cards.forEach((c) => s.deckDefs.push(Object.assign({}, c, { count: 1 }))); });
g.PANEL_CATEGORIES.concat(g.PANEL_CHAINS).forEach((c) => { s.panelLevels[c.id] = c.maxLevel; });
g.PANEL_SPECIALS.forEach((sp) => { s.panelSpecials[sp.id] = true; });
s.panelLevels.panelMark = mark;
g.TRIALS.forEach((t) => { s.trialsCleared[t.id] = true; });
s.trialComboBest = 8;
g.ACHIEVEMENTS.forEach((a) => { s.achievements[a.id] = true; });
g.TREE_EXT_DEFS.forEach((d) => { s.treeExt[d.id] = extL; });
g.ITEM_DEFS.forEach((d) => { s.items[d.id] = g.itemMax(d); if (!d.additive && !d.flat) s.itemAwaken[d.id] = awaken; });
s.transcendUnlocked = true;
s.deckDefs.push({ type: "buff", name: "狂乱の咆哮", value: 3, count: 20 }, { type: "special", name: "終焉の使者", calc: "atk2", count: 1 });
g.newRun(1);
const moves = g.game.n;
function levelAt(f) {
  let sum = new D(0);
  for (let k = 1; k <= f; k++) sum = sum.add(g.computeFloorHp(k));
  s.level = 1;
  s.exp = new D(0);
  g.gainExp(sum);
  return s.level;
}
function hitAt(f, L) {
  s.level = L;
  g.game.floor = f;
  g.game.traits = ["regen"];
  g.game.firstHitDone = false;
  g.game.buffBonus = 0;
  g.game.buffBonus = (g.buffApplied(3) - 1) * (moves - 1);
  return g.damageMultiplier().mul(g.specialCardRaw({ calc: "atk2" })).mul(g.critMultiplier()).mul(g.situationalItemMult());
}
let best = null;
for (let f = 200; f <= 400000; f += 100) {
  const L = levelAt(Math.min(f, 6000)) + (f > 6000 ? Math.floor((f - 6000) * 0.655) : 0);
  const hit = hitAt(f, L);
  const hp = g.enemyHpForFloor(f);
  if (hit.gte(hp)) best = { floor: f, level: L, hit: hit.toExponential(2), hp: hp.toExponential(2) };
  else break;
}
console.log(JSON.stringify({ extL, mark, awaken, moves, exponent: g.currentExponent(), best }));
process.exit(0);
