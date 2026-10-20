// src/19-init.js — part of game.js (keyboard, dev console, init). Edit here, then run: node tools/build.js
  // ---------------- Keyboard (tempo) ----------------
  // battle: 1-9 play the hand from the left / shop: Enter = next floor / defeat・retreat: Enter = retry
  document.addEventListener("keydown", (e) => {
    if (el.confirmOverlay.classList.contains("active") || e.repeat) return;
    // only typing fields swallow keys: a focused checkbox (自動購入「毎回自動で実行」) used to block Enter
    const typing = e.target instanceof HTMLInputElement && !["checkbox", "radio", "button"].includes(e.target.type);
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const active = document.querySelector(".screen.active");
    const screen = active ? active.id.replace("screen-", "") : "";
    if (screen === "battle" && game && /^[1-9]$/.test(e.key)) {
      const card = game.hand[Number(e.key) - 1];
      if (card) playCard(card.uid);
    } else if (screen === "battle" && (e.key === "a" || e.key === "A")) {
      setAutoPlay(!save.autoPlay.on);
    } else if (screen === "battle" && (e.key === "s" || e.key === "S")) {
      cycleSpeed();
    } else if (screen === "battle" && (e.key === "l" || e.key === "L")) {
      toggleAutoLoop();
    } else if (screen === "floorClear" && e.key === "Enter") {
      e.preventDefault();
      goNextFloor();
    } else if ((screen === "defeat" || screen === "retreat") && e.key === "Enter") {
      e.preventDefault();
      retryRun();
    }
  });

  // ---------------- Dev console ----------------
  // re-renders whichever screen happens to be open, so a value changed from the console shows up
  // straight away instead of only after navigating somewhere else and back
  function refreshActiveScreen() {
    const renderers = {
      "screen-home": renderHome,
      "screen-tree": renderTree,
      "screen-deckUpgrade": renderDeckZone,
      "screen-cardShop": renderCardShop,
      "screen-panel": renderPanel,
      "screen-achievements": renderAchievements,
      "screen-remnants": renderRemnants,
      "screen-remnantTree": renderRemnantTree,
      "screen-treeExt": renderTreeExt,
    };
    const active = document.querySelector(".screen.active");
    const render = active && renderers[active.id];
    if (render) render();
  }

  // gold only shows up on the battle screen and on the floor-clear shop. renderBattle() rebuilds
  // the whole hand (and drives its flip animations), so the battle screen gets just the one label
  // updated; the shop needs the full re-render because what you can afford depends on gold.
  function refreshRunGold() {
    const active = document.querySelector(".screen.active");
    if (!active) return;
    if (active.id === "screen-battle") el.battleGold.textContent = fmt(game.gold);
    else if (active.id === "screen-floorClear") renderShop();
  }

  function writeGold(n) {
    // gold lives on the run object, not in the save: outside a run there is nothing to set
    if (!game) {
      console.warn("[mt] ゴールドはラン中のみ設定できます（「塔に挑む」でランを開始してください）");
      return null;
    }
    const value = Number(n);
    if (!Number.isFinite(value)) {
      console.warn("[mt] 数値を渡してください。例: mt.gold = 9999");
      return game.gold;
    }
    game.gold = Math.max(0, Math.floor(value));
    refreshRunGold();
    console.info("[mt] ゴールド =", fmt(game.gold));
    return game.gold;
  }

  function writePoints(n) {
    const value = Number(n);
    if (!Number.isFinite(value)) {
      console.warn("[mt] 数値を渡してください。例: mt.points = 9999");
      return save.points;
    }
    save.points = Math.max(0, Math.floor(value));
    persistSave();
    refreshActiveScreen();
    console.info("[mt] ソウル =", fmt(save.points));
    return save.points;
  }

  function writeTranscend(n) {
    const value = Number(n);
    if (!Number.isFinite(value)) {
      console.warn("[mt] 数値を渡してください。例: mt.transcend = 9999");
      return save.transcendPoints;
    }
    save.transcendPoints = Math.max(0, Math.floor(value));
    persistSave();
    refreshActiveScreen();
    console.info("[mt] 転生ポイント =", fmt(save.transcendPoints));
    // the title hides both the transcend readout and the 転生 button until the final boss has been
    // beaten once, so points set before that are real but have nowhere to be spent
    if (!save.transcendUnlocked) {
      console.warn("[mt] 転生パネルは未解放です。開くには mt.unlockTranscend() を実行してください");
    }
    return save.transcendPoints;
  }

  // normally set by beating the final boss; needed to reach the panel at all
  function unlockTranscend() {
    save.transcendUnlocked = true;
    persistSave();
    refreshActiveScreen();
    console.info("[mt] 転生パネルを解放しました（タイトルに「転生」ボタンが出ます）");
    return true;
  }

  if (DEV_CONSOLE) {
    window.mt = {
      // `mt.points` reads, `mt.points = 500` writes -- an accessor rather than a plain field so
      // the assignment itself persists the save and repaints, which is how you'd expect it to work
      // when poking at it from devtools
      get points() { return save.points; },
      set points(n) { writePoints(n); },
      setPoints(n) { return writePoints(n); },
      addPoints(n) { return writePoints(save.points + Number(n || 0)); },
      // null outside a run rather than a warning, so devtools autocomplete can preview it quietly
      get gold() { return game ? game.gold : null; },
      set gold(n) { writeGold(n); },
      setGold(n) { return writeGold(n); },
      addGold(n) { return game ? writeGold(game.gold + Number(n || 0)) : writeGold(n); },
      get transcend() { return save.transcendPoints; },
      set transcend(n) { writeTranscend(n); },
      setTranscend(n) { return writeTranscend(n); },
      addTranscend(n) { return writeTranscend(save.transcendPoints + Number(n || 0)); },
      // experience goes through the normal level-up path (achievement bonus included)
      get level() { return save.level; },
      addExp(n) {
        const levels = gainExp(Number(n || 0));
        persistSave();
        refreshActiveScreen();
        console.info("[mt] Lv." + save.level + "（+" + levels + "）");
        return save.level;
      },
      unlockTranscend() { return unlockTranscend(); },
      help() {
        console.info(
          [
            "マギア・タワー デバッグコンソール",
            "",
            "ソウル（永続・自動セーブ）",
            "  mt.points            現在値を表示",
            "  mt.points = 9999     設定",
            "  mt.addPoints(500)    加算（マイナスで減算）",
            "  mt.setPoints(0)      mt.points = 0 と同じ",
            "",
            "ゴールド（ラン中のみ・セーブされません）",
            "  mt.gold              現在値を表示（ラン外は null）",
            "  mt.gold = 9999       設定",
            "  mt.addGold(500)      加算（マイナスで減算）",
            "  mt.setGold(0)        mt.gold = 0 と同じ",
            "",
            "転生ポイント（永続・自動セーブ）",
            "  mt.transcend         現在値を表示",
            "  mt.transcend = 9999  設定",
            "  mt.addTranscend(500) 加算（マイナスで減算）",
            "  mt.setTranscend(0)   mt.transcend = 0 と同じ",
            "  mt.unlockTranscend() 転生パネルを解放（通常はラスボス撃破で解放）",
            "",
            "レベル（永続・自動セーブ、転生でリセット）",
            "  mt.level             現在のレベルを表示",
            "  mt.addExp(1e6)       経験値を加算（レベルアップ処理あり）",
            "",
            "変更は開いている画面に即座に反映されます。",
          ].join("\n")
        );
      },
    };
    console.info("[mt] デバッグコンソール有効。使い方は mt.help()");
  }

  // ---------------- Init ----------------
  clampSaveToDefinitions();
  applyGameSpeed();
  if (save.autoPlay.on) scheduleAuto(300);
  showScreen("home");
  debugTopUp();
  showIdleReport(settleIdle(true)); // time spent closed (capped) is paid out by the remnants on load
  renderHome();
  if (save.trialPending) {
    if (trialsUnlockedCount() > 0) openTrials();
    else { save.trialPending = false; persistSave(); }
  }
  if (brokenSaveKept) showToast("セーブを読み込めなかったため、新しく始めた。元のデータは端末内に退避してある（magiaTower.save.v2.broken）");
  // play data: asked once; a session note when it's on
  if (NETWORK_ENABLED && telemetry.consent === null) dataEl.consent.classList.add("active");
  else trackSession();
  if (NETWORK_ENABLED && (cloud.creds || telemetryOn())) checkServer();
  // visible play time (stats.playMs): feeds the play data's "how long until …" numbers
  let playTickAt = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (document.visibilityState === "visible") bumpStat("playMs", Math.max(0, Math.min(60000, now - playTickAt)));
    playTickAt = now;
  }, 15000);
  setInterval(() => { if (document.visibilityState === "visible") flushTelemetry(false); }, TELEMETRY_FLUSH_MS);
  setInterval(() => { if (document.visibilityState === "visible") cloudUpload(); }, CLOUD_UPLOAD_MS);
  // while visible: just keep lastSeen fresh (so a crash/kill without pagehide pays nothing extra)
  setInterval(() => { if (document.visibilityState === "visible") settleIdle(false); }, IDLE_TICK_MS);
  // hiding stamps the time; coming back pays for the hidden stretch the same way a reload would
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { settleIdle(false); return; }
    const result = settleIdle(true);
    showIdleReport(result);
    if (result && document.getElementById("screen-home").classList.contains("active")) renderHome();
  });
  // closing a tab that was already hidden must keep the stamp from when it was hidden, or that whole
  // hidden stretch is never paid
  window.addEventListener("pagehide", () => {
    if (document.visibilityState === "visible") save.lastSeen = Date.now();
    persistSave();
    if (!wipingSave) {
      flushTelemetry(true);
      cloudUpload({ keepalive: true });
    }
  });
})();
