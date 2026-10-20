// 苦難: the HP multiplier grows in with the floor, the panel is sealed, rewards and the combo bonus apply
const { create } = require("../lib/harness");

module.exports = async (t) => {
  for (const id of ["hp1", "hp2", "hp3", "crit3"]) {
    const h = create(JSON.stringify({ transcendUnlocked: true, activeTrials: [id] }));
    const g = h.g;
    const mult = g.TRIALS.find((x) => x.id === id).rules.hpMult;
    const ratio = (f) => g.enemyHpForFloor(f).div(g.computeFloorHp(f)).toNumber();
    t.ok(Math.abs(ratio(1) - Math.pow(mult, 0.01)) / Math.pow(mult, 0.01) < 0.01, `${id}: 1F multiplier ${ratio(1)}`);
    t.ok(Math.abs(ratio(100) - mult) / mult < 0.001, `${id}: 100F multiplier ${ratio(100)}`);
  }
  // the panel is sealed during a 苦難, and so are 秘宝の契約 / 輪廻の理
  const h = create(JSON.stringify({ transcendUnlocked: true, activeTrials: ["atk1"], panelLevels: { panelAtk: 10, panelItem: 12, panelTranscendGain: 16, panelTranscendPower: 4 }, level: 100 }));
  const g = h.g;
  t.ok(Math.abs(g.itemChance() - 0.015) < 1e-9, "秘宝の契約 must be sealed during a 苦難: " + g.itemChance());
  t.ok(g.transcendPower() === 2, "輪廻の理 must be sealed during a 苦難");
  // combo bonus: ×1.5 per record
  g.save.trialComboBest = 8;
  t.ok(Math.abs(g.trialComboMult() - Math.pow(1.5, 7)) < 1e-9, "combo ×1.5^7 expected: " + g.trialComboMult());
  t.ok(h.errors.length === 0, "errors: " + h.errors.slice(0, 3).join(" | "));

  // a 苦難's HP multiplier must not pay extra exp (it used to, and the climb paid for itself)
  const exp = async (trials) => {
    const hh = create(JSON.stringify({ transcendUnlocked: true, activeTrials: trials, level: 1, exp: "0" }));
    hh.g.newRun(50);
    await hh.flush(400);
    hh.g.game.enemyHp = new hh.D(0);
    hh.g.checkResult();
    return hh.g.save.level;
  };
  const withTrial = await exp(["hp3"]);
  const without = await exp([]);
  t.ok(without > 1 && withTrial === without, `exp from a 堅牢★★★ kill must equal a normal kill's: Lv${withTrial} vs Lv${without}`);
};
