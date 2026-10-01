// 文化祭体験版のバランス確認用シミュレーター（ゲーム本体では使わない）。
//   node festival/tools/balance-sim.js
// 欲張りなボットが「挑戦 → 敗北 → 安いノードから基本強化 → 一番深いチェックポイントから再挑戦」を
// ラスボス討伐まで繰り返し、人間のペースを仮定したプレイ時間を出す。
// 敵HP・ダメージは log10 で扱うので 1E+308 を超えても平気。
// festival/game.js の数値を変えたら、ここの P / TREE / SHOP も合わせて変えること。
const P = {
  FINAL: 30,
  HP_LOG_START: Math.log10(60), HP_LOG_STEP: 0.1, HP_LOG_GROWTH: 1.2, // computeFloorHp()
  BOSS_EXTRA: { 10: 0.4, 20: 1.5 }, FINAL_HP_LOG: 100,
  BASE_ATK: 10, BASE_N: 5, BASE_HAND: 5, BASE_CRIT: 5,
  LEVEL_ATK_MULT: 1.5, LEVEL_EXP_GROWTH: 3, LEVEL_EXP_BASE: 30,
  SOUL_PER_FLOOR: 1.3,
  // 人間のペースの仮定（秒）: カード1枚 / 階クリア画面 / 挑戦の開始と終了 / 強化画面1回 / ノード1つ / 最初の説明
  T_CARD: 2.5, T_FLOOR: 4, T_RUN: 15, T_TREE: 45, T_NODE: 5, T_INTRO: 60,
};
const card = (name, type, v, cnt, cr, cd) => ({ name, type, v, cnt: cnt || 1, cr: cr || 0, cd: cd || 0 });
const BASE_DECK = [card("斬撃", "attack", 15, 5), card("強撃", "attack", 20, 3), card("会心撃", "attack", 18, 2, 5, 20)];
function chain(prefix, req, list) { let prev = req; return list.map((e, i) => { const n = Object.assign({ id: prefix + (i + 1), requires: prev }, e); prev = n.id; return n; }); }
const TREE = [].concat(
  [{ id: "root", requires: null, cost: 1, grant: 3 }],
  chain("atk", "root", [{ cost: 1, atk: 5 }, { cost: 2, atkPct: 50 }]),
  chain("atkP", "atk2", [{ cost: 5, atkPct: 100 }, { cost: 12, atkPct: 200 }, { cost: 23, exp: 0.5 }, { cost: 40, atkPct: 500 }, { cost: 65, exp: 0.75 }]),
  chain("atkA", "atk2", [{ cost: 3, card: card("双撃の構え", "buff", 2) }, { cost: 9, card: card("超会心撃", "attack", 30, 1, 10, 50) }, { cost: 20, card: card("狂乱の咆哮", "buff", 3) }, { cost: 38, card: card("渾身の一撃", "special", 0) }, { cost: 60, card: card("狂乱の咆哮", "buff", 3) }]),
  chain("n", "root", [{ cost: 1, crit: 5 }, { cost: 2, critDmg: 50 }]),
  chain("nCrit", "n2", [{ cost: 5, crit: 5 }, { cost: 13, crit: 10 }, { cost: 28, crit: 10 }]),
  chain("nDmg", "n2", [{ cost: 7, critDmg: 50 }, { cost: 15, critDmg: 100 }, { cost: 33, critDmg: 200 }]),
  chain("nMult", "n2", [{ cost: 8, fm: 3 }, { cost: 18, exp: 0.25 }, { cost: 38, fm: 3 }, { cost: 70, exp: 0.5, hand: 1 }]),
  chain("gold", "root", [{ cost: 1, soul: 20 }, { cost: 2, gold: 50 }]),
  chain("goldS", "gold2", [{ cost: 5, slots: 1 }, { cost: 10, startGold: 100 }, { cost: 20, gold: 100 }]),
  chain("goldSoul", "gold2", [{ cost: 7, soul: 30 }, { cost: 15, soul: 40 }, { cost: 30, soul: 50 }]),
  chain("goldExp", "gold2", [{ cost: 4, exp: 0.15 }, { cost: 13, exp: 0.25 }, { cost: 30, exp: 0.35 }]),
);
const log10 = Math.log10;
function floorHpLog(f) {
  if (f === P.FINAL) return P.FINAL_HP_LOG;
  let L = P.HP_LOG_START + (P.BOSS_EXTRA[f] || 0);
  for (let k = 1; k < f; k++) L += P.HP_LOG_STEP * Math.pow(P.HP_LOG_GROWTH, k - 1);
  return L;
}
function lsum(a, b) { if (a === -Infinity) return b; if (b === -Infinity) return a; const m = Math.max(a, b); return m + log10(Math.pow(10, a - m) + Math.pow(10, b - m)); }
function expToNextLog(L) { return log10(P.LEVEL_EXP_BASE) + (L - 1) * log10(P.LEVEL_EXP_GROWTH); }

function simulate(seed, verbose, randomPlay) {
  let rng = seed || 1;
  const rand = () => { rng = (rng * 16807) % 2147483647; return rng / 2147483647; };
  const save = { souls: 0, owned: {}, level: 1, expLog: -Infinity, bestCleared: 0, deck: BASE_DECK.map((c) => Object.assign({}, c)) };
  const sum = (k) => TREE.reduce((s, n) => s + (save.owned[n.id] && n[k] ? n[k] : 0), 0);
  const prod = (k) => TREE.reduce((s, n) => s * (save.owned[n.id] && n[k] ? n[k] : 1), 1);
  let t = P.T_INTRO, runs = 0;
  const log = [], cnt = { cards: 0, floors: 0, nodes: 0, trees: 0 };
  while (runs < 30) {
    runs++;
    const cps = [1, 11, 21, 30].filter((c) => c === 1 || save.bestCleared >= c - 1);
    let floor = cps[cps.length - 1];
    const start = floor;
    const run = { atkPct: 0, crit: 0, critDmg: 0, exp: 0, gold: sum("startGold"), goldPct: 0, buys: {} };
    let soulsSum = 0, won = false;
    t += P.T_RUN;
    for (;;) {
      const hpLog = floorHpLog(floor);
      const atkLog = log10((P.BASE_ATK + sum("atk")) * (1 + (sum("atkPct") + run.atkPct) / 100)) + (save.level - 1) * log10(P.LEVEL_ATK_MULT);
      const E = 1 + sum("exp") + run.exp;
      const critRate = (P.BASE_CRIT + sum("crit") + run.crit) / 100;
      const critMult = 1.5 + (sum("critDmg") + run.critDmg) / 100;
      const fm = prod("fm");
      const deck = [];
      save.deck.forEach((c) => { for (let i = 0; i < c.cnt; i++) deck.push(c); });
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
      const hand = deck.splice(0, P.BASE_HAND + sum("hand"));
      let n = P.BASE_N, buff = 0, dealt = -Infinity;
      const hitLog = (c, b) => {
        const pLog = c.type === "special" ? atkLog + log10(n) : lsum(log10(c.v), atkLog);
        const isCrit = rand() < critRate + c.cr / 100;
        return E * (pLog + log10(Math.max(0.1, 1 + b)) + log10(fm) + log10(isCrit ? critMult + c.cd / 100 : 1));
      };
      while (n > 0 && dealt < hpLog) {
        const buffs = hand.filter((c) => c.type === "buff");
        const atks = hand.filter((c) => c.type !== "buff");
        let c;
        if (randomPlay) c = hand[Math.floor(rand() * hand.length)];
        else if (buffs.length && atks.length && n >= 2) c = buffs.sort((a, b) => b.v - a.v)[0];
        else c = (atks.length ? atks : hand).sort((a, b) => (b.type === "special" ? 1e9 : b.v) - (a.type === "special" ? 1e9 : a.v))[0];
        hand.splice(hand.indexOf(c), 1);
        if (c.type === "buff") buff += c.v - 1;
        else { dealt = lsum(dealt, hitLog(c, buff)); buff = 0; }
        deck.push(c); hand.push(deck.shift());
        n--; t += P.T_CARD; cnt.cards++;
      }
      if (dealt < hpLog) break; // 敗北
      soulsSum += floor;
      save.bestCleared = Math.max(save.bestCleared, floor);
      save.expLog = lsum(save.expLog, hpLog);
      while (save.expLog >= expToNextLog(save.level)) {
        const need = expToNextLog(save.level);
        const rest = Math.pow(10, save.expLog - need) - 1;
        save.expLog = rest > 0 ? need + log10(rest) : -Infinity;
        save.level++;
      }
      t += P.T_FLOOR; cnt.floors++;
      if (floor === P.FINAL) { won = true; break; }
      // 商人（自動購入をざっくり再現: 安いものから買う）
      run.gold += (20 + floor * 5) * (1 + (sum("gold") + run.goldPct) / 100);
      const shop = [["atk", 20, 0], ["crit", 25, 0], ["critDmg", 25, 1.1], ["gold", 30, 1.2]].concat(save.bestCleared >= 10 ? [["exp", 40, 1.3]] : []);
      for (let guard = 0; guard < 50; guard++) {
        const offers = shop.map(([id, base, g]) => [id, (base + floor * 3) * Math.pow(g || 1, run.buys[id] || 0)]).filter(([id]) => id !== "crit" || (run.buys.crit || 0) < 15);
        const pick = offers[Math.floor(rand() * offers.length)];
        if (run.gold < pick[1]) break;
        run.gold -= pick[1]; run.buys[pick[0]] = (run.buys[pick[0]] || 0) + 1;
        if (pick[0] === "atk") run.atkPct += 20; else if (pick[0] === "crit") run.crit += 2; else if (pick[0] === "critDmg") run.critDmg += 20; else if (pick[0] === "gold") run.goldPct += 15; else run.exp += 0.03;
      }
      floor++;
    }
    const souls = Math.floor(soulsSum * P.SOUL_PER_FLOOR * (1 + sum("soul") / 100));
    save.souls += souls;
    log.push(`挑戦${runs}: ${start}階→${floor}階${won ? " 討伐" : ""} Lv${save.level} 累乗${(1 + sum("exp")).toFixed(2)} ソウル+${souls} 経過${(t / 60).toFixed(1)}分`);
    if (won) break;
    t += P.T_TREE; cnt.trees++;
    for (;;) {
      const avail = TREE.filter((nd) => !save.owned[nd.id] && (!nd.requires || save.owned[nd.requires]) && nd.cost <= save.souls).sort((a, b) => a.cost - b.cost);
      if (!avail.length) break;
      const nd = avail[0];
      save.souls -= nd.cost; save.owned[nd.id] = true; t += P.T_NODE; cnt.nodes++;
      if (nd.grant) save.souls += nd.grant;
      if (nd.card) save.deck.push(nd.card);
    }
  }
  if (verbose) console.log(log.join("\n") + "\n" + JSON.stringify(cnt));
  return t / 60;
}

console.log("各階の敵HP（log10）:", Array.from({ length: P.FINAL }, (_, i) => `${i + 1}:${floorHpLog(i + 1).toFixed(1)}`).join(" "));
console.log("基本強化の合計:", TREE.reduce((s, n) => s + n.cost, 0), "ソウル\n");
simulate(7, true);
for (const randomPlay of [false, true]) {
  const ts = [];
  for (let s = 1; s <= 300; s++) ts.push(simulate(s * 7919, false, randomPlay));
  ts.sort((a, b) => a - b);
  console.log(`${randomPlay ? "でたらめに" : "考えて"}カードを使う場合のクリア時間（分） 下位10% / 中央値 / 上位10%: ${ts[30].toFixed(1)} / ${ts[150].toFixed(1)} / ${ts[270].toFixed(1)}`);
}
