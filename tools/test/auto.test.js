// AUTO / 周回 / 速度
const { create, mulberry32 } = require("../lib/harness");

module.exports = async (t) => {
  // AUTO alone: clears floors by itself, ends on the defeat screen, never retries
  let h = create(JSON.stringify({ autoPlay: { on: true, loop: false, speed: 1 }, unlockedNodes: { root: true } }), { random: mulberry32(3) });
  let g = h.g;
  g.newRun(1);
  await h.flush(5 * 60 * 1000);
  t.ok(h.screen() === "defeat", "AUTO without 周回 should end on the defeat screen, got " + h.screen());
  t.ok((g.save.stats.kills || 0) >= 1, "AUTO cleared nothing");
  const runs = g.save.stats.runs;
  await h.flush(60 * 1000);
  t.ok(g.save.stats.runs === runs, "AUTO alone must not retry");
  t.ok(h.errors.length === 0, "errors: " + h.errors.slice(0, 3).join(" | "));

  // 周回 (needs the first clear): keeps retrying, walks into endless after the boss
  h = create(JSON.stringify({ transcendUnlocked: true, autoPlay: { on: true, loop: true, speed: 2 }, unlockedNodes: { root: true }, level: 500, exp: "0" }), { random: mulberry32(4) });
  g = h.g;
  g.newRun(91);
  await h.flush(20 * 60 * 1000);
  t.ok(g.save.stats.runs >= 3, "周回 should keep retrying: runs " + g.save.stats.runs);
  t.ok((g.save.stats.maxCleared || 0) > 100, "周回 should enter endless after the boss: best " + g.save.stats.maxCleared);
  t.ok(h.errors.length === 0, "loop errors: " + h.errors.slice(0, 3).join(" | "));

  // a hidden tab pauses AUTO
  h = create(JSON.stringify({ autoPlay: { on: true, loop: false, speed: 1 }, unlockedNodes: { root: true } }));
  g = h.g;
  Object.defineProperty(h.w.document, "visibilityState", { value: "hidden", configurable: true });
  g.newRun(1);
  await h.flush(60 * 1000);
  t.ok((g.save.stats.kills || 0) === 0, "AUTO should pause while hidden");
};
