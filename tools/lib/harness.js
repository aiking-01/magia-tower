// Headless harness for マギア・タワー: loads index.html + its scripts in jsdom with a virtual clock and exposes
// the game's internals as `g` (the game is one IIFE, so a hook is spliced in just before its closing line).
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..", "..");

// names the tests/bots may reach into; anything missing from game.js is simply skipped
const EXPOSE = [
  "save", "game", "newRun", "playCard", "goNextFloor", "buyOffer", "buyItemOffer", "bulkBuyTree", "bulkBuyPanel",
  "reincarnateNow", "leavePanel", "nodeState", "NODES", "TREE_EXT_DEFS", "treeExtUnlocked", "treeExtCost", "treeExtLevel",
  "attackBaseDamage", "specialCardRaw", "damageMultiplier", "currentAtk", "currentExponent", "finalDamageMult",
  "levelDamageMult", "enemyHpForFloor", "transcendGainForLevel", "persistSave", "checkAchievements", "critMultiplier", "critRate",
  "CARD_SHOP_POOL", "shopUnlockedCount", "cardShopPrice", "rankUpCost", "ITEM_DEFS", "itemCount", "itemsOwnedTotal",
  "situationalItemMult", "maxHit", "completeTrial", "startTrials", "TRIALS", "itemChance", "buffApplied",
  "PANEL_CATEGORIES", "PANEL_CHAINS", "PANEL_SPECIALS", "ACHIEVEMENTS", "itemMax", "computeFloorHp", "trialComboMult",
  "achievementBonus", "critDamageBonus", "transcendPower", "gainExp", "trialRewardProduct", "itemProduct", "currentStartN",
  "chooseAutoCard", "setAutoPlay", "gameSpeed", "autoSpeeds", "loadSave", "sanitizeSave", "encodeSaveText", "decodeSaveText",
  "damageBreakdown", "enemyTraits", "TRAIT_DEFS", "rollTraits", "guardianForFloor", "enemyForFloor", "itemAwakenLevel",
  "markLevel", "PANEL_MARK", "panelProgress", "openPanel", "renderPanel", "renderBattle", "rollItemOffers", "trialHpMultForFloor",
  "cloud", "telemetry", "retryRun", "checkResult", "STORAGE_KEY", "applyTraitsToHit", "autoCardDamage", "hasTrait",
];

function create(saveJson, opts = {}) {
  const root = opts.root || ROOT;
  let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g)].map((m) => m[1]);
  html = html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
  const url = (opts.origin || "http://localhost:8746") + "/" + (opts.debug ? "?debug=1" : "");
  const errors = [];
  // jsdom can't reload a page (the game does after a 読み込み/復元); everything else it reports is a real error
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => { if (!/Not implemented: navigation/.test(e.message)) errors.push(String(e.stack || e.message)); });
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const w = dom.window;
  // ---- virtual clock: setTimeout/setInterval/performance.now/Date all run on `now`, advanced by flush() ----
  let now = 0;
  const timers = [];
  let seq = 0;
  w.setTimeout = (fn, ms) => { const id = ++seq; timers.push({ id, t: now + (ms || 0), fn, iv: 0 }); return id; };
  w.clearTimeout = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
  w.setInterval = (fn, ms) => { const id = ++seq; timers.push({ id, t: now + ms, fn, iv: ms }); return id; };
  w.clearInterval = w.clearTimeout;
  w.requestAnimationFrame = (fn) => w.setTimeout(() => fn(now), 16);
  w.cancelAnimationFrame = w.clearTimeout;
  Object.defineProperty(w.performance, "now", { value: () => now, configurable: true });
  const baseDate = opts.baseDate || 1.7e12;
  const RealDate = w.Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(baseDate + now); }
    static now() { return baseDate + now; }
  }
  w.Date = FakeDate;
  w.HTMLElement.prototype.scrollTo = function () {};
  w.Element.prototype.scrollIntoView = function () {};
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  // the network: tests may hand in their own fetch (pointed at the fake API); otherwise every call fails
  w.fetch = opts.fetch || (() => Promise.reject(new Error("offline (harness)")));
  // browsers have these; jsdom doesn't
  if (!w.TextEncoder) w.TextEncoder = TextEncoder;
  if (!w.TextDecoder) w.TextDecoder = TextDecoder;
  w.navigator.sendBeacon = opts.sendBeacon || (() => false);
  if (saveJson) w.localStorage.setItem("magiaTower.save.v2", saveJson);
  if (opts.storage) Object.entries(opts.storage).forEach(([k, v]) => w.localStorage.setItem(k, v));
  w.addEventListener("error", (e) => errors.push(String((e.error && e.error.stack) || e.message)));
  w.console.error = (...a) => errors.push(a.join(" "));
  w.console.info = () => {};
  if (opts.random) w.Math.random = opts.random;
  for (const src of scripts) {
    let code = fs.readFileSync(path.join(root, src.split("?")[0]), "utf8");
    if (/game\.js$/.test(src.split("?")[0])) {
      const avail = EXPOSE.filter((n) => new RegExp("(function\\s+" + n + "\\b|(const|let)\\s+" + n + "\\b)").test(code));
      const hook = "window.__g = {" + avail.map((n) => (n === "save" || n === "game"
        ? `get ${n}() { return ${n}; }, set ${n}(v) { ${n} = v; }`
        : `get ${n}() { return ${n}; }`)).join(",") + "};\n";
      const idx = code.lastIndexOf("})();");
      code = code.slice(0, idx) + hook + code.slice(idx);
      // opts.fast (long balance runs): skip the battle screen's drawing and the damage numbers -- the game logic
      // never reads them back, it only shows them
      if (opts.fast) {
        ["function renderBattle() {", "function floatDamage(amount, isCrit, isRemnant) {"].forEach((sig) => {
          if (!code.includes(sig)) throw new Error("harness fast mode: not found: " + sig);
          code = code.replace(sig, sig + " if (window.__fast) return;");
        });
        // and let it run at ×4 whatever the save has cleared (speed only divides waiting times)
        code = code.replace("const SPEED_4_FLOOR = 500;", "const SPEED_4_FLOOR = 0;");
        w.__fast = true;
      }
    }
    w.eval(code);
  }
  const g = w.__g;
  async function flush(ms) {
    const end = now + ms;
    for (;;) {
      await new Promise((r) => setImmediate(r));
      timers.sort((a, b) => a.t - b.t || a.id - b.id);
      const t = timers[0];
      if (!t || t.t > end) break;
      timers.shift();
      now = Math.max(now, t.t);
      if (t.iv) timers.push({ id: t.id, t: now + t.iv, fn: t.fn, iv: t.iv });
      try { t.fn(); } catch (e) { errors.push(String(e.stack || e)); }
    }
    now = end;
    await new Promise((r) => setImmediate(r));
  }
  const screen = () => { const a = w.document.querySelector(".screen.active"); return a ? a.id.replace("screen-", "") : ""; };
  return { w, g, flush, errors, screen, get now() { return now; }, dom, D: w.Decimal };
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { create, mulberry32, ROOT };
