// 苦難の手間: how many cards it takes to beat 100F under a 苦難, from the state a player is in when the 苦難 open up
// (just reincarnated: Lv1, no souls, empty tree; achievements from a first loop; no earlier 苦難 rewards).
// The baseline "none" is the same start without any 苦難. AUTO plays; between runs the tree is bought in bulk and
// spare souls go into attack-card ranks, like a straightforward player.
//   node tools/sim/trial-effort.js <trialId|none> [seed] [maxCards]      (several at once: hp1+atk1)
//   TRIAL_RULES='{"hp1":{"hpMult":100}}' node tools/sim/trial-effort.js hp1 1   -> try other numbers
const { create, mulberry32 } = require("../lib/harness");

const trial = process.argv[2] || "none";
const seed = Number(process.argv[3] || 1);
const MAX_CARDS = Number(process.argv[4] || 150000);

// the peak of a first loop (≈ the v6 bot at its first reincarnation): achievements are judged against this
const PEAK = { level: 215, stats: { maxCleared: 280, kills: 3000, runs: 60, maxCritStreak: 10, bossKills: 3, reincarnations: 1, maxHit: "1e20" } };

(async () => {
  const h = create(JSON.stringify({
    transcendUnlocked: true, level: PEAK.level, exp: "0", stats: PEAK.stats, unlockedNodes: {},
    autoPlay: { on: true, loop: false, speed: 4 }, autoBuyEnabled: true, // 自動購入 as soon as the tree has it
  }), { random: mulberry32(seed), fast: true });
  const g = h.g;
  const s = g.save;
  // TRIAL_RULES='{"hp1":{"hpMult":100}}' tries other numbers without editing game.js (the rules are read live)
  if (process.env.TRIAL_RULES) {
    Object.entries(JSON.parse(process.env.TRIAL_RULES)).forEach(([id, rules]) => { g.TRIALS.find((t) => t.id === id).rules = rules; });
  }
  // earn what that peak earns, then drop to the 苦難 start
  g.ACHIEVEMENTS.forEach((a) => { try { if (!a.hidden && a.test()) s.achievements[a.id] = true; } catch (e) { /* needs a run */ } });
  s.level = 1;
  s.exp = new h.D(0);
  s.points = 0;
  s.stats.maxCleared = 0; // speed/achievement gates would otherwise act on the old peak
  s.activeTrials = trial === "none" ? [] : trial.split("+");
  const achCount = Object.keys(s.achievements).length;
  const startCards = () => s.stats.cardsPlayed || 0;
  let runs = 0;
  const cleared = () => (trial === "none" ? (s.stats.bossKills || 0) > PEAK.stats.bossKills : !s.activeTrials.length);
  while (!cleared() && startCards() < MAX_CARDS) {
    g.bulkBuyTree();
    for (let k = 0; k < 40; k++) {
      const d = s.deckDefs.filter((x) => x.type === "attack").map((x) => [x, g.rankUpCost(x)]).sort((a, b) => a[1] - b[1])[0];
      if (!d || d[1] > s.points * 0.5) break;
      s.points -= d[1];
      d[0].rank = (d[0].rank || 0) + 1;
    }
    g.newRun(1);
    runs += 1;
    for (let i = 0; i < 100000; i++) {
      await h.flush(2000);
      const scr = h.screen();
      if (scr === "defeat" || scr === "retreat" || scr === "finalVictory" || !g.game) break;
      if (cleared()) break;
    }
    if (process.env.EFFORT_LOG && runs % 10 === 0) console.error(`run ${runs} reached ${g.game ? g.game.floor : "?"} souls ${Math.round(s.points)} nodes ${Object.keys(s.unlockedNodes).length} Lv${s.level} cards ${startCards()}`);
    g.game = null;
  }
  const out = { trial, rules: process.env.TRIAL_RULES || "", seed, cleared: cleared(), cards: startCards(), runs, level: s.level, ach: achCount, errors: h.errors.length };
  console.log(JSON.stringify(out));
  process.exit(0);
})();
