// src/03-save.js — part of game.js (save: defaults, load, sanitize). Edit here, then run: node tools/build.js
  function defaultSave() {
    return {
      points: 0, unlockedNodes: {}, bestFloor: 0,
      deckDefs: cloneDeckDefs(BASE_DECK_DEFS), // the permanent deck: rank-ups/deletions from the title screen persist here
      startCardsBackfilled: true, // fresh saves have nothing to backfill
      transcendPoints: 0, // earned only from endless-mode (floor > 100) progress, spent on the panel below
      panelLevels: {}, // reincarnation panel: the one thing that survives a reincarnation reset
      panelSpecials: {}, // one-shot, very expensive panel purchases (also survives reincarnation)
      transcendUnlocked: false, // becomes true forever the first time the final boss is defeated
      cardShopPurchases: {}, // card shop item id -> times bought since the last reincarnation (drives its rising price)
      bestClearedFloor: 0, // highest floor actually beaten (bestFloor also counts the floor you lost on); gates shop potions
      autoBuyEnabled: false, // merchant auto-buy runs on its own every floor clear (once 自動購入開放 is bought)
      level: 1, exp: new Decimal(0), // player level: earned from kills, kept across runs, reset by reincarnation
      achievements: {}, // achievement id -> true; never reset by reincarnation
      stats: {}, // lifetime counters the achievements read (maxHit, kills, runs, …); never reset
      remnantDecks: [], // one deck (array of card defs) per summoned remnant; never reset
      remnantTree: {}, // remnant skill tree node id -> true; shared by all remnants, never reset
      lastSeen: 0, // ms timestamp of the last time the game was open (offline remnant income)
      activeTrials: [], // ids of the 苦難 being attempted together this loop (one per direction); see TRIALS
      trialComboBest: 0, // most 苦難 ever beaten at once (each new record 2…8 adds its 同時挑戦ボーナス)
      trialPending: false, // set by reincarnating: the 苦難 screen comes up once the panel is left
      trialsCleared: {}, // 苦難 id -> true once beaten (its reward is permanent)
      treeExt: {}, // 拡張強化 id -> level; bought with souls, reset by reincarnation like the basic tree
      items: {}, // 秘宝 id -> copies owned; bought from the floor-clear merchant, kept until the next reincarnation
      itemAwaken: {}, // 秘宝 id -> 覚醒 level (bought once that 秘宝 is at its cap); reset by reincarnation too
      autoPlay: { on: false, loop: false, speed: 1 }, // オート (battle + next floor) / 周回 (auto retry) / 演出の速さ
    };
  }
  function loadSave() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultSave();
      const parsed = JSON.parse(raw);
      const loadedDeckDefs = Array.isArray(parsed.deckDefs) ? parsed.deckDefs : cloneDeckDefs(BASE_DECK_DEFS);
      const merged = Object.assign(defaultSave(), parsed, {
        unlockedNodes: Object.assign({}, parsed.unlockedNodes || {}),
        panelLevels: Object.assign({}, parsed.panelLevels || {}),
        panelSpecials: Object.assign({}, parsed.panelSpecials || {}),
        cardShopPurchases: Object.assign({}, parsed.cardShopPurchases || {}),
        achievements: Object.assign({}, parsed.achievements || {}),
        stats: Object.assign({}, parsed.stats || {}),
        remnantTree: Object.assign({}, parsed.remnantTree || {}),
        treeExt: Object.assign({}, parsed.treeExt || {}),
        items: Object.assign({}, parsed.items || {}),
        itemAwaken: Object.assign({}, parsed.itemAwaken || {}),
        autoPlay: Object.assign({ on: false, loop: false, speed: 1 }, parsed.autoPlay || {}),
        trialsCleared: Object.assign({}, parsed.trialsCleared || {}),
        remnantDecks: Array.isArray(parsed.remnantDecks) ? parsed.remnantDecks : [],
        deckDefs: loadedDeckDefs,
      });
      sanitizeSave(merged);
      // draw cards are disabled for now; strip any that survived in an older save
      merged.deckDefs = merged.deckDefs.filter((d) => d.type !== "draw");
      // one-time migration: startCards nodes used to grant their cards fresh every run instead
      // of permanently; backfill anything already unlocked so it isn't silently lost.
      if (!parsed.startCardsBackfilled) {
        NODES.forEach((node) => {
          if (merged.unlockedNodes[node.id] && node.kind === "startCards") {
            node.cards.forEach((c) => addCardToDeckDefs(merged.deckDefs, c));
          }
        });
        merged.startCardsBackfilled = true;
      }
      enforceMinDeck(merged.deckDefs);
      // big numbers are saved as strings (Decimal#toJSON); older saves have plain numbers, or null
      // where an overflowed Infinity was written
      merged.exp = toDecimal(merged.exp);
      // a single 苦難 used to be stored as activeTrial
      if (!Array.isArray(merged.activeTrials)) merged.activeTrials = [];
      if (typeof merged.activeTrial === "string" && !merged.activeTrials.length) merged.activeTrials = [merged.activeTrial];
      delete merged.activeTrial;
      merged.stats.maxHit = toDecimal(merged.stats.maxHit);
      return merged;
    } catch (e) {
      // never let a save that failed to load be overwritten by the fresh one on the next persistSave():
      // keep its text aside (shown as a notice at start-up, see Init)
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) { localStorage.setItem(STORAGE_KEY + ".broken", raw); brokenSaveKept = true; }
      } catch (e2) { /* ignore */ }
      return defaultSave();
    }
  }
  let brokenSaveKept = false;

  // A save can come from another device or another person (データ管理の読み込み・クラウドの復元), so every value that
  // reaches the page or a loop is forced back to the type the game expects. Card names are escaped wherever they
  // are shown (escapeHtml). Unknown cards are kept: an old but legitimate card must never be thrown away.
  // Runs inside loadSave(), i.e. before most definitions below exist -- so it only touches plain data; the ranges
  // that need the definitions (panel tiers, 秘宝 caps, …) are clamped later by clampSaveToDefinitions().
  function toInt(v, min, max, fallback) {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }
  function toNum(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  function sanitizeCardDef(d) {
    if (!d || typeof d !== "object") return null;
    const out = { type: String(d.type || "attack").slice(0, 20), name: String(d.name == null ? "?" : d.name).slice(0, 40), count: toInt(d.count, 0, 999, 1) };
    if (d.value != null) out.value = toNum(d.value, 0);
    if (d.active != null) out.active = toInt(d.active, 0, 999, out.count);
    if (d.rank != null) out.rank = toInt(d.rank, 0, 99999, 0);
    if (d.deleteUses != null) out.deleteUses = toInt(d.deleteUses, 0, 99999, 0);
    if (d.critRateBonus != null) out.critRateBonus = toNum(d.critRateBonus, 0);
    if (d.critDmgBonus != null) out.critDmgBonus = toNum(d.critDmgBonus, 0);
    if (Array.isArray(d.randomValues)) out.randomValues = d.randomValues.slice(0, 8).map((v) => toNum(v, 1));
    if (d.calc != null) out.calc = String(d.calc).slice(0, 20);
    if (Array.isArray(d.tags)) out.tags = d.tags.slice(0, 8).map((v) => String(v).slice(0, 20));
    if (d.targetTag != null) out.targetTag = String(d.targetTag).slice(0, 20);
    return out;
  }
  function sanitizeNumberMap(m, max) {
    const out = {};
    Object.keys(m || {}).slice(0, 2000).forEach((k) => { out[String(k).slice(0, 60)] = toInt(m[k], 0, max, 0); });
    return out;
  }
  function sanitizeFlagMap(m) {
    const out = {};
    Object.keys(m || {}).slice(0, 2000).forEach((k) => { if (m[k]) out[String(k).slice(0, 60)] = true; });
    return out;
  }
  function sanitizeSave(s) {
    const cards = (list) => (Array.isArray(list) ? list.slice(0, 200).map(sanitizeCardDef).filter(Boolean) : []);
    s.deckDefs = cards(s.deckDefs);
    s.remnantDecks = (Array.isArray(s.remnantDecks) ? s.remnantDecks : []).slice(0, 12).map(cards);
    s.panelLevels = sanitizeNumberMap(s.panelLevels, 1e6);
    s.treeExt = sanitizeNumberMap(s.treeExt, 1e6);
    s.items = sanitizeNumberMap(s.items, 1e3);
    s.itemAwaken = sanitizeNumberMap(s.itemAwaken, 1e3);
    s.cardShopPurchases = sanitizeNumberMap(s.cardShopPurchases, 1e6);
    ["unlockedNodes", "panelSpecials", "achievements", "trialsCleared", "remnantTree"].forEach((k) => { s[k] = sanitizeFlagMap(s[k]); });
    const stats = {};
    Object.keys(s.stats || {}).slice(0, 500).forEach((k) => { stats[String(k).slice(0, 60)] = k === "maxHit" ? s.stats[k] : toNum(s.stats[k], 0); });
    s.stats = stats;
    s.points = Math.max(0, toNum(s.points, 0));
    s.transcendPoints = Math.max(0, toNum(s.transcendPoints, 0));
    s.trialHeldPoints = Math.max(0, toNum(s.trialHeldPoints, 0));
    s.level = toInt(s.level, 1, 1e8, 1);
    s.bestFloor = toInt(s.bestFloor, 0, 1e9, 0);
    s.bestClearedFloor = toInt(s.bestClearedFloor, 0, 1e9, 0);
    s.trialComboBest = toInt(s.trialComboBest, 0, 8, 0);
    s.lastSeen = toNum(s.lastSeen, 0);
    ["transcendUnlocked", "autoBuyEnabled", "trialPending", "startCardsBackfilled"].forEach((k) => { s[k] = !!s[k]; });
    const ap = s.autoPlay || {};
    s.autoPlay = { on: !!ap.on, loop: !!ap.loop, speed: toInt(ap.speed, 1, 4, 1) };
    if (Array.isArray(s.activeTrials)) s.activeTrials = s.activeTrials.slice(0, 8).map((v) => String(v).slice(0, 20));
    if (s.activeTrial != null) s.activeTrial = String(s.activeTrial).slice(0, 20);
    return s;
  }
  // the ranges that need the definitions further down; called once at Init, before anything is shown
  function clampSaveToDefinitions() {
    PANEL_CATEGORIES.concat(PANEL_CHAINS, [PANEL_MARK]).forEach((c) => {
      if (save.panelLevels[c.id] > c.maxLevel) save.panelLevels[c.id] = c.maxLevel;
    });
    ITEM_DEFS.forEach((d) => {
      const cap = d.max + ITEM_CHAIN_TIERS.reduce((n, tier) => n + (tier.limit || 0), 0);
      if (save.items[d.id] > cap) save.items[d.id] = cap;
    });
    save.activeTrials = save.activeTrials.filter((id) => TRIALS.some((t) => t.id === id));
  }
  // card names (and anything else a save can carry) go through this before they're put into innerHTML
  function escapeHtml(v) {
    return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function toDecimal(v) {
    try {
      const d = new Decimal(v == null ? 0 : v);
      return Number.isFinite(d.mantissa) && Number.isFinite(d.exponent) ? d : new Decimal(0);
    } catch (e) { return new Decimal(0); }
  }
  // set while a reset is wiping the save: the reload fires pagehide, and persistSave() would write the
  // in-memory save straight back, so the reset would silently do nothing
  let wipingSave = false;
  // ?debug=1: souls, transcend points and run gold are topped back up whenever the game saves, so every
  // purchase can be tried freely
  const DEBUG_FUNDS = 1e15;
  function debugTopUp() {
    if (!DEBUG_MODE) return;
    if (!(save.points >= DEBUG_FUNDS)) save.points = DEBUG_FUNDS;
    if (!(save.transcendPoints >= DEBUG_FUNDS)) save.transcendPoints = DEBUG_FUNDS;
    if (game && !(game.gold >= DEBUG_FUNDS)) game.gold = DEBUG_FUNDS;
  }
  function persistSave() {
    debugTopUp();
    if (wipingSave) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
  }

  let save = loadSave();
  let cardUid = 0;
  let game = null;

  // 苦難「束縛」scales the numeric tree effects (and its reward boosts the tree's atk); counts like hand
  // size and shop slots are never scaled
  const TRIAL_SCALED_TREE_KEYS = ["atk", "critRate", "critDamage", "goldPct", "exponent"];
  function treeBonus(key) {
    let total = 0;
    NODES.forEach((node) => {
      if (save.unlockedNodes[node.id] && node.effect && node.effect[key]) total += node.effect[key];
    });
    if (TRIAL_SCALED_TREE_KEYS.includes(key)) total *= trialRule("treeMult", 1);
    if (key === "atk") total *= trialRule("treeAtkMult", 1);
    if (key === "atk" || key === "exponent") total *= trialRewardProduct("treeBoost");
    return total;
  }

