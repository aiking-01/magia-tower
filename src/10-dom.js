// src/10-dom.js — part of game.js (DOM refs, confirm, toast, number format, damage numbers). Edit here, then run: node tools/build.js
  // ---------------- DOM refs ----------------
  const el = {
    bestFloorLabel: document.getElementById("bestFloorLabel"),
    homePointsLabel: document.getElementById("homePointsLabel"),
    openFloorSelectBtn: document.getElementById("openFloorSelectBtn"),
    resetProgressBtn: document.getElementById("resetProgressBtn"),
    openDataBtn: document.getElementById("openDataBtn"),
    openTreeBtn: document.getElementById("openTreeBtn"),
    openDeckUpgradeBtn: document.getElementById("openDeckUpgradeBtn"),
    openCardShopBtn: document.getElementById("openCardShopBtn"),

    deckUpgradeBackBtn: document.getElementById("deckUpgradeBackBtn"),
    deckUpgradePointsLabel: document.getElementById("deckUpgradePointsLabel"),

    cardShopBackBtn: document.getElementById("cardShopBackBtn"),
    cardShopPointsLabel: document.getElementById("cardShopPointsLabel"),
    cardShopOptions: document.getElementById("cardShopOptions"),

    floorSelectBackBtn: document.getElementById("floorSelectBackBtn"),
    floorSelectGrid: document.getElementById("floorSelectGrid"),

    treeBackBtn: document.getElementById("treeBackBtn"),
    treePointsLabel: document.getElementById("treePointsLabel"),
    treeMap: document.getElementById("treeMap"),
    treeScrollWrap: document.getElementById("treeScrollWrap"),
    treeMapScaler: document.getElementById("treeMapScaler"),

    floorLabel: document.getElementById("floorLabel"),
    battleSide: document.getElementById("battleSide"),
    enemyVisual: document.getElementById("enemyVisual"),
    enemyName: document.getElementById("enemyName"),
    enemyTraits: document.getElementById("enemyTraits"),
    enemyHpNow: document.getElementById("enemyHpNow"),
    enemyHpMax: document.getElementById("enemyHpMax"),
    enemyBar: document.getElementById("enemyBar"),
    statN: document.getElementById("statN"),
    statAtk: document.getElementById("statAtk"),
    statBuff: document.getElementById("statBuff"),
    breakdownPanel: document.getElementById("breakdownPanel"),
    breakdownBody: document.getElementById("breakdownBody"),
    breakdownClose: document.getElementById("breakdownClose"),
    log: document.getElementById("log"),
    hand: document.getElementById("hand"),
    handCount: document.getElementById("handCount"),
    deckCount: document.getElementById("deckCount"),
    deckPile: document.getElementById("deckPile"),
    deckPileCount: document.getElementById("deckPileCount"),
    battleGold: document.getElementById("battleGold"),

    floorClearSub: document.getElementById("floorClearSub"),
    shopGold: document.getElementById("shopGold"),
    shopOptions: document.getElementById("shopOptions"),
    deckZoneList: document.getElementById("deckZoneList"),
    deckZoneTotal: document.getElementById("deckZoneTotal"),
    rerollBtn: document.getElementById("rerollBtn"),
    autoBuyRow: document.getElementById("autoBuyRow"),
    autoBuyBtn: document.getElementById("autoBuyBtn"),
    autoBuyToggle: document.getElementById("autoBuyToggle"),
    autoBuySummary: document.getElementById("autoBuySummary"),
    shopItems: document.getElementById("shopItems"),
    autoPlayBtn: document.getElementById("autoPlayBtn"),
    autoLoopBtn: document.getElementById("autoLoopBtn"),
    speedBtn: document.getElementById("speedBtn"),
    floorClearAutoNote: document.getElementById("floorClearAutoNote"),
    defeatAutoNote: document.getElementById("defeatAutoNote"),
    victoryAutoNote: document.getElementById("victoryAutoNote"),
    homeItems: document.getElementById("homeItems"),
    toNextFloorBtn: document.getElementById("toNextFloorBtn"),
    retreatBtn: document.getElementById("retreatBtn"),

    defeatFloor: document.getElementById("defeatFloor"),
    defeatPoints: document.getElementById("defeatPoints"),
    defeatToHomeBtn: document.getElementById("defeatToHomeBtn"),

    retreatFloor: document.getElementById("retreatFloor"),
    retreatPoints: document.getElementById("retreatPoints"),
    retreatToHomeBtn: document.getElementById("retreatToHomeBtn"),

    victoryPoints: document.getElementById("victoryPoints"),
    victoryToHomeBtn: document.getElementById("victoryToHomeBtn"),
    enterEndlessBtn: document.getElementById("enterEndlessBtn"),

    homeTranscendStat: document.getElementById("homeTranscendStat"),
    homeTranscendLabel: document.getElementById("homeTranscendLabel"),
    openPanelBtn: document.getElementById("openPanelBtn"),
    panelBackBtn: document.getElementById("panelBackBtn"),
    panelSub: document.getElementById("panelSub"),
    openPanelPreviewBtn: document.getElementById("openPanelPreviewBtn"),
    panelPointsLabel: document.getElementById("panelPointsLabel"),
    panelMap: document.getElementById("panelMap"),
    panelScrollWrap: document.getElementById("panelScrollWrap"),
    panelMapScaler: document.getElementById("panelMapScaler"),

    homeLevelLabel: document.getElementById("homeLevelLabel"),
    homeExpLabel: document.getElementById("homeExpLabel"),
    idleReport: document.getElementById("idleReport"),
    openAchievementsBtn: document.getElementById("openAchievementsBtn"),
    achievementsBackBtn: document.getElementById("achievementsBackBtn"),
    achievementsCountLabel: document.getElementById("achievementsCountLabel"),
    achievementsTotal: document.getElementById("achievementsTotal"),
    achievementsList: document.getElementById("achievementsList"),
    remnantsBackBtn: document.getElementById("remnantsBackBtn"),
    remnantsPointsLabel: document.getElementById("remnantsPointsLabel"),
    remnantIdleInfo: document.getElementById("remnantIdleInfo"),
    remnantList: document.getElementById("remnantList"),
    remnantTreeBackBtn: document.getElementById("remnantTreeBackBtn"),
    remnantTreePointsLabel: document.getElementById("remnantTreePointsLabel"),
    remnantTreeGrid: document.getElementById("remnantTreeGrid"),
    toastArea: document.getElementById("toastArea"),
    enemyHpUnit: document.getElementById("enemyHpUnit"),
    levelUpBanner: document.getElementById("levelUpBanner"),
    defeatRetryBtn: document.getElementById("defeatRetryBtn"),
    defeatTreeBtn: document.getElementById("defeatTreeBtn"),
    defeatHint: document.getElementById("defeatHint"),
    retreatRetryBtn: document.getElementById("retreatRetryBtn"),
    retreatTreeBtn: document.getElementById("retreatTreeBtn"),
    retreatHint: document.getElementById("retreatHint"),
    trialList: document.getElementById("trialList"),
    trialClearedLabel: document.getElementById("trialClearedLabel"),
    trialBackBtn: document.getElementById("trialBackBtn"),
    trialSkipBtn: document.getElementById("trialSkipBtn"),
    menuDescTitle: document.getElementById("menuDescTitle"),
    treeBulkBtn: document.getElementById("treeBulkBtn"),
    panelBulkBtn: document.getElementById("panelBulkBtn"),
    menuDescText: document.getElementById("menuDescText"),
    trialStartBtn: document.getElementById("trialStartBtn"),
    trialSelection: document.getElementById("trialSelection"),
    trialCombo: document.getElementById("trialCombo"),
    homeSealed: document.getElementById("homeSealed"),
    homeSealedGrid: document.getElementById("homeSealedGrid"),
    trialBanner: document.getElementById("trialBanner"),
    trialBannerText: document.getElementById("trialBannerText"),
    abandonTrialBtn: document.getElementById("abandonTrialBtn"),
    trialClearNote: document.getElementById("trialClearNote"),
    treeExtBackBtn: document.getElementById("treeExtBackBtn"),
    treeExtPointsLabel: document.getElementById("treeExtPointsLabel"),
    treeExtList: document.getElementById("treeExtList"),

    confirmOverlay: document.getElementById("confirmOverlay"),
    confirmMessage: document.getElementById("confirmMessage"),
    confirmOkBtn: document.getElementById("confirmOkBtn"),
    confirmCancelBtn: document.getElementById("confirmCancelBtn"),
  };

  // in-page stand-in for window.confirm(): some embedded/in-app browser views auto-dismiss the
  // native dialog (it resolves to false immediately without ever being shown), which made the
  // 転生/reset buttons look completely unresponsive there. Resolves true/false like confirm() did.
  // Only one can be open: a second request (keyboard re-activating the button that opened it, or
  // tabbing to the other destructive button) is refused, since two stacked confirmations could
  // both resolve true and run reset + reincarnate back to back. Clicking the backdrop does NOT
  // cancel -- the second click of a double-click lands there and silently dismissed the dialog.
  function showConfirm(message) {
    if (el.confirmOverlay.classList.contains("active")) return Promise.resolve(false);
    return new Promise((resolve) => {
      el.confirmMessage.textContent = message;
      el.confirmOverlay.classList.add("active");
      // Enter/Space on whatever button launched this would otherwise stay on that background button
      el.confirmCancelBtn.focus();
      function cleanup(result) {
        el.confirmOverlay.classList.remove("active");
        el.confirmOkBtn.removeEventListener("click", onOk);
        el.confirmCancelBtn.removeEventListener("click", onCancel);
        document.removeEventListener("keydown", onKey);
        resolve(result);
      }
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onKey(e) { if (e.key === "Escape") cleanup(false); }
      el.confirmOkBtn.addEventListener("click", onOk);
      el.confirmCancelBtn.addEventListener("click", onCancel);
      document.addEventListener("keydown", onKey);
    });
  }

  const TOAST_MS = 3500;
  function showToast(text) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = text;
    el.toastArea.appendChild(t);
    setTimeout(() => t.remove(), TOAST_MS);
  }

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    document.getElementById("screen-" + name).classList.add("active");
    document.body.classList.toggle("title-bg", name === "home");
  }

  const E_NOTATION_THRESHOLD = 1e9; // below this, plain comma-separated numbers; at/above, "+E" notation
  function fmt(n) {
    if (n instanceof Decimal) {
      if (n.abs().lt(E_NOTATION_THRESHOLD)) return fmt(n.toNumber());
      // "1.23e+1234" -> "1.23E1234" (no "+"); very long exponents get digit grouping (the glyph set has ",")
      const [mant, exp] = n.toExponential(2).split("e");
      const e = Number(exp);
      return mant + "E" + (e < 0 ? "-" : "") + (Math.abs(e) >= 1e4 ? Math.abs(e).toLocaleString("ja-JP") : Math.abs(e));
    }
    const rounded = Math.round(n);
    if (Math.abs(rounded) >= E_NOTATION_THRESHOLD) {
      return rounded.toExponential(2).replace("e+", "E").replace("e-", "E-");
    }
    return rounded.toLocaleString("ja-JP");
  }
  // for multipliers (buff cards): fmt() rounds to a whole number, which would hide a fractional
  // bonus like 継承の闘気's +0.1/level; round to 2dp instead (also mops up float noise like 2.3000000000000003)
  function fmtMult(n) {
    if (n instanceof Decimal) return n.lt(E_NOTATION_THRESHOLD) ? fmtMult(n.toNumber()) : fmt(n);
    return (Math.round(n * 100) / 100).toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  }

  function addLog(text, cls) {
    const line = document.createElement("div");
    line.className = "log-line" + (cls ? " " + cls : "");
    line.textContent = text;
    el.log.prepend(line);
  }

  // floating damage numbers are drawn from pre-rendered glyph IMAGES (assets/dmg-font/), not a
  // web font: the licensed font they come from forbids shipping the font file itself anywhere a
  // third party could extract it (a @font-face file is trivially saveable from the browser cache/
  // network tab, which is exactly what that clause rules out). Only these small PNGs -- one per
  // character actually needed here -- ever leave this machine; see assets/dmg-font/LICENSE-NOTE.txt.
  // Each PNG shares one common baseline/height from rasterization, so different glyphs' natural
  // proportions (e.g. "," small and low, "C" full-height) still line up when mixed in one string.
  const DMG_GLYPH_FILES = {
    "0": "d0", "1": "d1", "2": "d2", "3": "d3", "4": "d4", "5": "d5", "6": "d6", "7": "d7", "8": "d8", "9": "d9",
    ",": "comma", ".": "dot", "-": "minus", "+": "plus", "E": "E",
    "C": "C", "R": "R", "I": "I", "T": "T", "A": "A", "L": "L",
  };
  const DMG_GLYPH_ASPECT = {
    d0: 0.608, d1: 0.395, d2: 0.608, d3: 0.608, d4: 0.641, d5: 0.611, d6: 0.608, d7: 0.611, d8: 0.608, d9: 0.608,
    comma: 0.286, dot: 0.286, minus: 0.379, plus: 0.482, E: 0.625,
    A: 0.711, C: 0.611, I: 0.352, L: 0.625, R: 0.658, T: 0.654,
  };
  const DMG_CHAR_BOUNCE_STAGGER_MS = 30; // per-character delay so the string bounces in left-to-right, like a wave
  // the WHOLE string's stagger is kept within this total span so the last character's bounce
  // never lands after the hold/fade has already started (see DMG_LIFETIME_MS below). For a short
  // string the per-character gap is the full 45ms above; a longer string (e.g. "CRITICAL-1,234")
  // shrinks that gap so every character still gets its OWN distinct delay -- capping the delay
  // instead of shrinking the gap would bunch every character past a fixed count into one lockstep
  // group, which reads as the wave animation abruptly stopping partway through the string.
  const DMG_CHAR_STAGGER_SPAN_MS = 140;
  const DMG_LIFETIME_MS = 850; // total on-screen time for a damage number; keep in sync with style.css's dmgHoldFade duration
  // mask-image fetches its image in CORS mode, which a page opened via file:// is never allowed to
  // do -- the glyphs come out fully transparent -- so file:// falls back to plain text
  const DMG_GLYPHS_USABLE = location.protocol !== "file:";
  function appendDmgChars(container, text) {
    const chars = [...text];
    const gap = (chars.length > 1 ? Math.min(DMG_CHAR_BOUNCE_STAGGER_MS, DMG_CHAR_STAGGER_SPAN_MS / (chars.length - 1)) : 0) / gameSpeed();
    chars.forEach((ch, i) => {
      const file = DMG_GLYPHS_USABLE ? DMG_GLYPH_FILES[ch] : null;
      const span = document.createElement("span");
      if (file) {
        span.className = "dmg-char";
        span.style.setProperty("--dmg-glyph", `url("assets/dmg-font/${file}.png")`);
        span.style.setProperty("--dmg-aspect", DMG_GLYPH_ASPECT[file]);
      } else {
        span.className = "dmg-text"; // file:// or a character outside the rasterized set above
        span.textContent = ch;
      }
      span.style.animationDelay = (i * gap) + "ms";
      container.appendChild(span);
    });
  }

  // isRemnant: a remnant's follow-up -- its own color, no screen shake (a flurry of them would
  // otherwise shake the screen nonstop), and a quick hit-flash on the enemy instead
  function floatDamage(amount, isCrit, isRemnant) {
    const rect = el.enemyVisual.getBoundingClientRect();
    const f = document.createElement("div");
    const ratio = new Decimal(amount).div(game.enemyHpMax).toNumber();
    const isHuge = ratio >= 0.5;
    let cls = "dmg-float";
    if (isRemnant) {
      cls += " dmg-remnant";
    } else if (isCrit) {
      cls += " dmg-crit";
      if (isHuge) cls += " dmg-huge";
    } else if (isHuge) {
      cls += " dmg-huge";
    } else if (ratio >= 0.15) {
      cls += " dmg-big";
    }
    f.className = cls;
    appendDmgChars(f, (isCrit ? "CRITICAL-" : "-") + fmt(amount));
    // land at a random spot over the enemy art each hit (instead of always dead center) so
    // consecutive hits don't just stack on top of each other now that the number no longer
    // floats away; margin keeps it clear of the art's own edges.
    const marginX = rect.width * 0.18;
    const marginY = rect.height * 0.18;
    const randX = rect.left + marginX + Math.random() * Math.max(0, rect.width - marginX * 2);
    const randY = rect.top + marginY + Math.random() * Math.max(0, rect.height - marginY * 2);
    f.style.left = randX + "px";
    f.style.top = randY + "px";
    document.body.appendChild(f);
    // matches .dmg-float's dmgHoldFade animation duration in style.css (bounce, then a brief
    // hold, then a quick fade) -- removal is timed to land exactly as that fade reaches 0 so
    // there's no visible pop-off.
    setTimeout(() => f.remove(), spd(DMG_LIFETIME_MS));
    if (isRemnant) {
      el.enemyVisual.classList.remove("remnant-hit");
      void el.enemyVisual.offsetWidth; // restart the flash for back-to-back hits
      el.enemyVisual.classList.add("remnant-hit");
    } else {
      impactEffects(isCrit, isHuge);
    }
  }

  // screen shake + flash, layered on top of the floating number for extra "juice" on big hits.
  // shakes .app (not body) so the fixed-position damage number / flash overlay stay viewport-stable
  // instead of jittering along with the transform (position:fixed re-anchors to a transformed ancestor).
  function impactEffects(isCrit, isHuge) {
    el.enemyVisual.classList.remove("hit");
    void el.enemyVisual.offsetWidth;
    el.enemyVisual.classList.add("hit");
    if (!isCrit && !isHuge) return;
    const appEl = document.querySelector(".app");
    const shakeCls = isCrit && isHuge ? "shake-mega" : isCrit ? "shake-crit" : "shake-huge";
    appEl.classList.remove("shake-crit", "shake-huge", "shake-mega");
    void appEl.offsetWidth; // restart the animation even if the same class was just applied
    appEl.classList.add(shakeCls);
    setTimeout(() => appEl.classList.remove(shakeCls), 500);

    const flash = document.createElement("div");
    flash.className = "screen-flash " + (isCrit ? "flash-crit" : "flash-huge");
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 450);
  }

