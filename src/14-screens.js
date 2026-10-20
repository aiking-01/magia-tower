// src/14-screens.js — part of game.js (title, tabs, 拡張強化, achievements, remnants, 苦難, panel, floor select). Edit here, then run: node tools/build.js
  // ---------------- Render: home ----------------
  function renderHome() {
    el.homeLevelLabel.textContent = save.level;
    el.homeExpLabel.textContent = `（次まで ${expRemainingText()}）`;
    el.bestFloorLabel.textContent = save.bestFloor > 0 ? save.bestFloor : "-";
    el.homePointsLabel.textContent = fmt(save.points);
    el.homeTranscendStat.style.display = save.transcendUnlocked ? "inline" : "none";
    el.homeTranscendLabel.textContent = fmt(save.transcendPoints);
    el.openPanelBtn.style.display = save.transcendUnlocked ? "block" : "none";
    el.openPanelPreviewBtn.style.display = save.transcendUnlocked && !trialSealed() ? "block" : "none";
    el.openCardShopBtn.style.display = cardShopUnlocked() ? "block" : "none";
    const trials = activeTrialDefs();
    el.trialBanner.style.display = trials.length ? "" : "none";
    if (trials.length) {
      el.trialBannerText.textContent = `苦難に挑戦中：${trials.map((t) => `${t.name}（${"★".repeat(t.stars)}）`).join("・")}　`
        + `制限：${trialRuleTexts(trials).slice(1).join("／")}`;
    }
    renderHomeSeals();
    const owned = ownedItemsText();
    el.homeItems.style.display = owned ? "" : "none";
    el.homeItems.textContent = owned ? `所持している秘宝（次の転生まで）：${owned}` : "";
    // once a remnant exists, 基本強化+デッキ強化 merge into one tabbed プレイヤー強化 and the
    // デッキ強化 slot becomes 残滓強化 (during a 苦難 the remnants are sealed, so it goes back to デッキ強化)
    const hasRemnants = activeRemnantCount() > 0;
    el.openTreeBtn.textContent = hasRemnants ? "プレイヤー強化" : "基本強化を見る";
    const canBuy = NODES.some((n) => nodeState(n) === "available");
    el.openTreeBtn.classList.toggle("pulse", canBuy);
    if (canBuy) el.openTreeBtn.insertAdjacentHTML("beforeend", `<span class="btn-badge">習得可能</span>`);
    el.openDeckUpgradeBtn.textContent = hasRemnants ? "残滓強化" : "デッキ強化を見る";
    const remnantBuyable = hasRemnants && remnantAffordable();
    el.openDeckUpgradeBtn.classList.toggle("pulse", remnantBuyable);
    if (remnantBuyable) el.openDeckUpgradeBtn.insertAdjacentHTML("beforeend", `<span class="btn-badge">強化可能</span>`);
  }

  // tabs appear only once remnants exist; each tab just switches to its own existing screen
  const TAB_GROUPS = {
    player: [["tree", "基本強化"], ["treeExt", "拡張強化"], ["deckUpgrade", "デッキ強化"]],
    remnant: [["remnants", "残滓"], ["remnantTree", "残滓スキルツリー"]],
  };
  // the player tabs also appear (without remnants) once 魂の拡張 has added the 拡張強化 tab
  function tabVisible(screen) { return screen !== "treeExt" || treeExtUnlocked().length > 0; }
  function tabGroupVisible(group) { return activeRemnantCount() > 0 || (group === "player" && treeExtUnlocked().length > 0); }
  function openScreen(name) {
    showScreen(name);
    if (name === "tree") { renderTree(); centerTreeOnRoot(); }
    else if (name === "deckUpgrade") renderDeckZone();
    else if (name === "remnants") renderRemnants();
    else if (name === "remnantTree") renderRemnantTree();
    else if (name === "treeExt") renderTreeExt();
    renderTabBars(name);
  }
  function renderTabBars(current) {
    document.querySelectorAll(".tab-bar").forEach((bar) => {
      bar.style.display = tabGroupVisible(bar.dataset.group) ? "" : "none";
      bar.innerHTML = "";
      TAB_GROUPS[bar.dataset.group].filter(([screen]) => tabVisible(screen)).forEach(([screen, label]) => {
        const b = document.createElement("button");
        b.className = "tab-btn" + (screen === current ? " active" : "");
        b.textContent = label;
        b.addEventListener("click", () => { if (screen !== current) openScreen(screen); });
        bar.appendChild(b);
      });
    });
  }

  function renderTreeExt() {
    el.treeExtPointsLabel.textContent = fmt(save.points);
    el.treeExtList.innerHTML = "";
    treeExtUnlocked().forEach((def) => {
      const level = treeExtLevel(def);
      const cost = treeExtCost(def);
      const total = def.multiplicative ? fmtMult(Math.pow(def.perLevel, level)) : fmtMult(def.perLevel * level);
      const row = document.createElement("div");
      row.className = "deck-zone-row";
      row.innerHTML = `
        <div class="dz-info">
          <div class="dz-name">${def.label} Lv.${level}</div>
          <div class="dz-meta">1段ごとに ${def.unit.replace("{v}", fmtMult(def.perLevel))}（現在 ${def.unit.replace("{v}", total)}）</div>
        </div>
        <div class="dz-actions"><button class="dz-btn" data-action="buy">強化 ${fmt(cost)}pt</button></div>`;
      const btn = row.querySelector("[data-action=buy]");
      btn.disabled = save.points < cost;
      btn.addEventListener("click", () => {
        if (save.points < treeExtCost(def)) return;
        save.points -= treeExtCost(def);
        save.treeExt[def.id] = level + 1;
        persistSave();
        renderTreeExt();
      });
      el.treeExtList.appendChild(row);
    });
  }

  // the achievements screen groups entries by what they reward you for; hidden ones get their own group
  const ACHIEVEMENT_GROUPS = [
    ["tower", "塔の踏破", (a) => /^(floor|boss)\d/.test(a.id) || a.id.startsWith("guardian") || a.id.startsWith("trait1")],
    ["hit", "一撃のダメージ", (a) => a.id.startsWith("hit")],
    ["level", "レベル", (a) => /^lv\d/.test(a.id)],
    ["count", "討伐・挑戦", (a) => a.id.startsWith("kills") || a.id.startsWith("runs")],
    ["crit", "会心", (a) => a.id.startsWith("crit")],
    ["reinc", "転生・残滓", (a) => a.id.startsWith("reinc") || a.id.startsWith("remnant")],
    ["trial", "苦難", (a) => a.id.startsWith("trial")],
    ["item", "秘宝", (a) => a.id.startsWith("item")],
    ["growth", "強化・蓄え", (a) => /^(ext|deck|souls|transcend|mark)/.test(a.id)],
    ["meta", "実績", (a) => a.id.startsWith("ach")],
  ];
  function achievementGroupOf(a) {
    if (a.hidden) return "hidden";
    const g = ACHIEVEMENT_GROUPS.find(([, , test]) => test(a));
    return g ? g[0] : "meta";
  }
  function renderAchievements() {
    const done = ACHIEVEMENTS.filter((a) => save.achievements[a.id]).length;
    el.achievementsCountLabel.textContent = `${done} / ${ACHIEVEMENTS.length}`;
    const totals = Object.keys(ACHIEVEMENT_BONUS_LABELS).map((k) => [k, achievementBonus(k)]).filter(([, v]) => v > 0);
    el.achievementsTotal.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "ach-progress";
    bar.innerHTML = `<div class="ach-progress-fill" style="width:${(done / ACHIEVEMENTS.length) * 100}%"></div>`;
    el.achievementsTotal.appendChild(bar);
    const chips = document.createElement("div");
    chips.className = "ach-total-chips";
    chips.innerHTML = totals.length
      ? totals.map(([k, v]) => `<span class="ach-chip">${ACHIEVEMENT_BONUS_LABELS[k]} +${fmt(v)}%</span>`).join("")
      : `<span class="ach-chip dim">まだ効果はない</span>`;
    el.achievementsTotal.appendChild(chips);

    el.achievementsList.innerHTML = "";
    ACHIEVEMENT_GROUPS.concat([["hidden", "隠し実績"]]).forEach(([key, label]) => {
      const list = ACHIEVEMENTS.filter((a) => achievementGroupOf(a) === key);
      if (!list.length) return;
      const got = list.filter((a) => save.achievements[a.id]).length;
      const sec = document.createElement("section");
      sec.className = "ach-group";
      sec.innerHTML = `<div class="ach-group-head"><span class="ach-group-name">${label}</span><span class="ach-group-count">${got} / ${list.length}</span></div>`;
      const grid = document.createElement("div");
      grid.className = "ach-grid";
      list.forEach((a) => {
        const have = !!save.achievements[a.id];
        const secret = a.hidden && !have;
        const card = document.createElement("div");
        card.className = "ach-card" + (have ? " done" : "") + (secret ? " secret" : "");
        card.innerHTML = `
          <div class="ach-card-top"><span class="ach-mark">${have ? "✦" : "◇"}</span><span class="ach-name">${secret ? "？？？" : a.name}</span></div>
          <div class="ach-desc">${secret ? "条件は秘密" : a.desc}</div>
          <div class="ach-reward">${secret ? "？？？" : bonusText(a.bonus)}</div>`;
        grid.appendChild(card);
      });
      sec.appendChild(grid);
      el.achievementsList.appendChild(sec);
    });
  }

  function renderRemnants() {
    ensureRemnantDecks();
    el.remnantsPointsLabel.textContent = fmt(save.transcendPoints);
    const rate = idleRatePerMinute();
    const capHours = idleCapMs() / 3600000;
    el.remnantIdleInfo.textContent = rate
      ? `放置収入：経験値 ${fmt(rate.exp)}／分・ソウル ${fmt(rate.souls)}／分（最大 ${fmtMult(capHours)}時間分まで貯まる）`
      : `放置収入：なし（階層を1つでもクリアすると稼ぎ始める。最大 ${fmtMult(capHours)}時間分まで貯まる）`;
    el.remnantList.innerHTML = "";
    save.remnantDecks.slice(0, remnantCount()).forEach((deck, i) => {
      const box = document.createElement("div");
      box.className = "remnant-box";
      box.innerHTML = `<div class="remnant-name">${REMNANT_NAMES[i]}</div><div class="remnant-meta">あなたが攻撃するたび、そのダメージの一部で追撃する</div>`;
      deck.forEach((def) => {
        const cost = remnantRankCost(def);
        const row = document.createElement("div");
        row.className = "deck-zone-row";
        row.innerHTML = `
          <div class="dz-info">
            <div class="dz-name">${escapeHtml(def.name)}</div>
            <div class="dz-meta">追撃 ${fmtMult(remnantCardShare(def))}% / ${def.count}枚${def.rank ? " / Lv." + def.rank : ""}</div>
          </div>
          <div class="dz-actions"><button class="dz-btn" data-action="rank">強化 ${fmt(cost)}pt</button></div>`;
        const btn = row.querySelector("[data-action=rank]");
        btn.disabled = save.transcendPoints < cost;
        btn.addEventListener("click", () => {
          if (save.transcendPoints < cost) return;
          save.transcendPoints -= cost;
          def.rank = (def.rank || 0) + 1;
          persistSave();
          renderRemnants();
        });
        box.appendChild(row);
      });
      el.remnantList.appendChild(box);
    });
  }

  // anything on the 残滓 screens payable with the transcend points on hand (a card rank-up or a tree step)
  function remnantAffordable() {
    ensureRemnantDecks();
    const rankUp = save.remnantDecks.slice(0, remnantCount()).some((deck) => deck.some((def) => save.transcendPoints >= remnantRankCost(def)));
    return rankUp || REMNANT_TREE_BRANCHES.some((b) => b.nodes.some((n) => remnantNodeState(n) === "available"));
  }
  function remnantNodeState(node) {
    if (save.remnantTree[node.id]) return "unlocked";
    if (node.requires && !save.remnantTree[node.requires]) return "locked";
    return save.transcendPoints >= node.cost ? "available" : "unaffordable";
  }
  // with 30 steps per branch, owned steps collapse into one summary line and only the next few show
  const REMNANT_TREE_PREVIEW = 3;
  function renderRemnantTree() {
    el.remnantTreePointsLabel.textContent = fmt(save.transcendPoints);
    el.remnantTreeGrid.innerHTML = "";
    REMNANT_TREE_BRANCHES.forEach((branch) => {
      const col = document.createElement("div");
      col.className = "rt-branch";
      const owned = branch.nodes.filter((n) => save.remnantTree[n.id]).length;
      const total = remnantTreeBonus(branch.key);
      col.innerHTML = `<div class="rt-branch-title">${branch.label}</div>
        <div class="rt-summary">${owned} / ${branch.nodes.length} 段（合計 ${branch.unit.replace("{v}", fmt(total))}）</div>`;
      branch.nodes.forEach((node, i) => {
        const state = remnantNodeState(node);
        if (state === "unlocked") return;
        const firstOpen = branch.nodes.findIndex((n) => !save.remnantTree[n.id]);
        if (i >= firstOpen + REMNANT_TREE_PREVIEW) return;
        const div = document.createElement("div");
        div.className = "rt-node " + state;
        div.innerHTML = `<div class="tn-name">${branch.label} ${i + 1}</div><div class="tn-desc">${node.desc}</div><div class="tn-cost">${fmt(node.cost)}pt</div>`;
        if (state === "available") {
          div.addEventListener("click", () => {
            if (remnantNodeState(node) !== "available") return;
            save.transcendPoints -= node.cost;
            save.remnantTree[node.id] = true;
            persistSave();
            renderRemnantTree();
          });
        }
        col.appendChild(div);
      });
      if (owned === branch.nodes.length) col.insertAdjacentHTML("beforeend", `<div class="rt-node unlocked"><div class="tn-name">全段習得済み</div></div>`);
      el.remnantTreeGrid.appendChild(col);
    });
  }

  function leavePanel() {
    if (!panelFromTitle && save.trialPending) {
      if (trialsUnlockedCount() > 0) { openTrials(); return; }
      save.trialPending = false;
      persistSave();
    }
    showScreen("home");
    renderHome();
  }
  function openTrials() {
    showScreen("trial");
    renderTrials();
  }
  let trialSelection = []; // ids picked on the 苦難 screen, at most one per direction
  function renderTrials() {
    el.trialClearedLabel.textContent = `${trialsClearedCount()} / ${TRIALS.length}`;
    trialSelection = trialSelection.filter((id) => { const t = TRIALS.find((x) => x.id === id); return t && trialOpen(t); });
    const picked = trialSelection.map((id) => TRIALS.find((t) => t.id === id));
    // the sticky bar: what's picked, all of it combined, and the two ways forward
    el.trialSelection.innerHTML = picked.length
      ? `<b>${picked.length}つ選択中</b>：${picked.map((t) => t.name).join("・")}<div class="trial-selection-rules">${trialRuleTexts(picked).slice(1).join("／")}</div>`
      : "挑む苦難を選んでいない（複数選べる。各方向1段階まで）";
    el.trialStartBtn.disabled = !picked.length;
    el.trialStartBtn.textContent = picked.length ? `選んだ${picked.length}つの苦難に挑む` : "選んだ苦難に挑む";
    const best = save.trialComboBest || 0;
    el.trialCombo.innerHTML = `同時挑戦ボーナス（初めてその数を同時に越えるたびに全ダメージ×${TRIAL_COMBO_STEP}、現在 ×${fmtMult(trialComboMult())}）：`
      + [2, 3, 4, 5, 6, 7, 8].map((k) => `<span class="${k <= best ? "got" : ""}">${k}つ→合計×${fmtMult(Math.pow(TRIAL_COMBO_STEP, k - 1))}</span>`).join("");
    el.trialList.innerHTML = "";
    TRIAL_CATEGORIES.forEach((cat) => {
      const group = document.createElement("div");
      group.className = "trial-cat";
      const head = document.createElement("div");
      head.className = "trial-cat-head";
      head.innerHTML = `<span class="trial-cat-name">${cat.name}</span><span class="trial-cat-theme">${cat.theme}</span>`;
      group.appendChild(head);
      const row = document.createElement("div");
      row.className = "trial-row";
      TRIALS.filter((t) => t.cat === cat).forEach((t) => {
        const open = trialOpen(t);
        const cleared = !!save.trialsCleared[t.id];
        const selected = trialSelection.includes(t.id);
        const card = document.createElement("div");
        card.className = "trial-card" + (open ? "" : " locked") + (cleared ? " cleared" : "") + (selected ? " selected" : "");
        const lockText = t.level > trialsUnlockedCount() ? `苦難の門 ${t.level}段目で解放` : `「${TRIAL_LEVEL_NAMES[t.level - 2]}」を越えると解放`;
        card.innerHTML = `
          <div class="trial-head"><span class="trial-name">${t.name}</span><span class="trial-stars">${"★".repeat(t.stars)}</span></div>
          <ul class="trial-rules">${trialRuleTexts(t).slice(1).map((r) => `<li>${r}</li>`).join("")}</ul>
          <div class="trial-foot">
            <span class="trial-reward">報酬：${t.rewardText}${cleared ? "（獲得済み）" : ""}</span>
            <span class="trial-pick">${!open ? lockText : selected ? "✔ 選択中" : "選ぶ"}</span>
          </div>`;
        if (open) {
          card.addEventListener("click", () => {
            trialSelection = trialSelection.filter((id) => !id.startsWith(cat.id));
            if (!selected) trialSelection.push(t.id);
            renderTrials();
          });
        }
        row.appendChild(card);
      });
      group.appendChild(row);
      el.trialList.appendChild(group);
    });
  }
  function startTrials(ids) {
    save.activeTrials = ids.slice();
    track("trial", { op: "start", ids: ids.slice() });
    save.trialPending = false;
    // the souls 継承の礎 just granted come from the panel, which a 苦難 seals: held back until it ends
    save.trialHeldPoints = save.points;
    save.points = 0;
    bumpStat("trialsStarted");
    trialSelection = [];
    checkAchievements();
    persistSave();
    showScreen("home");
    renderHome();
  }
  el.trialStartBtn.addEventListener("click", () => { if (trialSelection.length) startTrials(trialSelection); });
  el.trialBackBtn.addEventListener("click", () => openPanel(false));
  el.trialSkipBtn.addEventListener("click", () => {
    save.trialPending = false;
    trialSelection = [];
    persistSave();
    showScreen("home");
    renderHome();
  });
  el.abandonTrialBtn.addEventListener("click", async () => {
    const defs = activeTrialDefs();
    if (!defs.length) return;
    if (!(await showConfirm(`苦難（${defs.map((t) => t.name).join("・")}）を放棄します。報酬は得られず、転生パネルの封印が解けます。よろしいですか?`))) return;
    track("trial", { op: "abandon", ids: defs.map((t) => t.id) });
    save.activeTrials = [];
    releaseHeldPoints();
    persistSave();
    renderHome();
  });

  // during a 苦難 the panel-given features show as sealed plates (like the festival build's teasers)
  const SEAL_TEXT = "苦難の間は封印されている。苦難を放棄するか、ラスボスを倒すと封印が解ける。";
  const SEAL_DESC = {
    転生パネル: "転生ポイントで永続強化を買うパネル。苦難の間は、買ってある強化の効果もすべて止まる。",
    残滓: "あなたの攻撃に続いて追撃し、留守の間も稼いでくれる残滓。苦難の間は戦わず、放置収入も止まる。",
    カードショップ: "ソウルで強力なカードを買えるショップ。苦難の間は店を開けられない。",
    拡張強化: "ソウルで何度でも強化できる拡張強化。苦難の間はタブごと封じられる。",
  };
  function renderHomeSeals() {
    const sealed = [];
    if (trialSealed()) {
      if (save.transcendUnlocked) sealed.push("転生パネル");
      if (remnantCount() > 0) sealed.push("残滓");
      if (panelLevel(PANEL_SHOP_CHAIN) > 0) sealed.push("カードショップ");
      if (panelLevel(PANEL_TREE_EXT_CHAIN) > 0) sealed.push("拡張強化");
    }
    el.homeSealed.style.display = sealed.length ? "" : "none";
    el.homeSealedGrid.innerHTML = "";
    sealed.forEach((name) => {
      const b = document.createElement("button");
      b.className = "sealed-tile";
      b.innerHTML = `<span class="seal-stamp small">封</span><span class="sealed-name"></span>`;
      b.querySelector(".sealed-name").textContent = name;
      b.addEventListener("click", () => showToast(`「${name}」は${SEAL_TEXT}`));
      attachMenuDesc(b, () => `封印：${name}`, () => `${SEAL_DESC[name]}\n${SEAL_TEXT}`);
      el.homeSealedGrid.appendChild(b);
    });
  }

  function showIdleReport(result) {
    if (!result || result.minutes < 1) return; // a quick reload isn't worth a notice
    const hours = result.minutes / 60;
    const span = hours >= 1 ? `${fmtMult(hours)}時間` : `${Math.round(result.minutes)}分`;
    const text = `留守中（${span}）に残滓が稼いだ：経験値 ${fmt(result.exp)}・ソウル ${fmt(result.souls)}${result.levels ? `（${result.levels}レベルアップ）` : ""}`;
    el.idleReport.textContent = text;
    showToast(text);
  }

  el.openFloorSelectBtn.addEventListener("click", () => { showScreen("floorSelect"); renderFloorSelect(); });
  el.resetProgressBtn.addEventListener("click", async () => {
    if (!(await showConfirm("進行状況を全てリセットします。所持カード・強化・転生ポイントなど全てのセーブデータが消え、元に戻せません。よろしいですか?"))) return;
    wipingSave = true;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
  el.floorSelectBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  el.openTreeBtn.addEventListener("click", () => openScreen("tree"));
  el.treeBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  el.openDeckUpgradeBtn.addEventListener("click", () => openScreen(activeRemnantCount() > 0 ? "remnants" : "deckUpgrade"));
  el.deckUpgradeBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  el.openAchievementsBtn.addEventListener("click", () => { showScreen("achievements"); renderAchievements(); });
  el.achievementsBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  el.remnantsBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  el.remnantTreeBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  el.treeExtBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  el.openCardShopBtn.addEventListener("click", () => { showScreen("cardShop"); renderCardShop(); });
  el.cardShopBackBtn.addEventListener("click", () => { showScreen("home"); renderHome(); });
  // the reincarnation panel's only way out used to be the core node buried in the middle of the
  // pannable map, which is easy to lose track of once you scroll away from it
  el.panelBackBtn.addEventListener("click", leavePanel);
  el.openPanelPreviewBtn.addEventListener("click", () => openPanel(true));
  el.treeBulkBtn.addEventListener("click", bulkBuyTree);
  el.panelBulkBtn.addEventListener("click", bulkBuyPanel);
  // reincarnateNow() wipes real progress the instant it runs and persists it, so this gets the same
  // confirm the reset button has. The numbers are spelled out because the title screen only shows
  // the transcend points, not what is about to be given up.
  el.openPanelBtn.addEventListener("click", async () => {
    const message =
      (panelHasAnythingToBuy() ? "" : "※転生パネルにはもう購入できる強化がありません（転生ポイントの使い道がありません）。\n\n") +
      "転生します。\n\n" +
      "【獲得するもの】\n" +
      `・転生ポイント +${fmt(transcendGainForLevel(save.level))}（Lv.${save.level}から）\n\n` +
      "【失われるもの】\n" +
      `・レベル（Lv.${save.level} → 1）\n` +
      `・ソウル（${fmt(save.points)}）\n` +
      "・基本強化（習得済みノード・拡張強化）\n" +
      "・デッキ編成\n" +
      (itemsOwnedTotal() ? `・秘宝（${ownedItemsText()}）\n` : "") +
      `・最高到達階（${save.bestFloor > 0 ? save.bestFloor + "階" : "なし"}）\n\n` +
      "【引き継がれるもの】\n" +
      `・転生ポイント（${fmt(save.transcendPoints)}）\n` +
      "・転生パネルの強化・実績・残滓・乗り越えた苦難の報酬\n\n" +
      (trialSealed() ? `※挑戦中の苦難（${activeTrialDefs().map((t) => t.name).join("・")}）は達成できないまま終わります。\n\n` : "") +
      "元に戻せません。よろしいですか?";
    if (!(await showConfirm(message))) return;
    reincarnateNow();
  });

  // reincarnation panel: permanent, paid with transcend points, never reset by reincarnation.
  // rendered as several long branches radiating from the core (same visual language as the basic
  // tree); the center "核" is the only way out of this screen — clicking it proceeds to the next
  // loop (title screen).
  function panelChainNodeState(cat, tier) {
    const level = panelLevel(cat);
    if (level >= tier) return "unlocked";
    if (level < tier - 1) return "locked"; // previous tier in this chain not owned yet
    if (cat.continues && panelLevel(cat.continues) < cat.continues.maxLevel) return "locked";
    return save.transcendPoints >= panelTierCost(cat, tier) ? "available" : "unaffordable";
  }
  function panelSpecialState(special) {
    if (panelSpecialOwned(special)) return "unlocked";
    if (special.requires && !save.panelSpecials[special.requires]) return "locked";
    return save.transcendPoints >= special.cost ? "available" : "unaffordable";
  }

  // opened from the title (not right after a reincarnation): same panel, purchases included; the header also
  // shows what the next reincarnation would pay. (It used to be view-only, which stranded the points of a
  // reincarnation whenever the page was closed before spending them.)
  let panelFromTitle = false;
  function openPanel(fromTitle) {
    panelFromTitle = fromTitle;
    showScreen("panel");
    renderPanel();
    centerPanelOnCore();
  }
  function panelProgress() {
    const all = PANEL_CATEGORIES.concat(PANEL_CHAINS);
    const total = all.reduce((n, c) => n + c.maxLevel, 0) + PANEL_SPECIALS.length;
    const owned = all.reduce((n, c) => n + Math.min(c.maxLevel, panelLevel(c)), 0) + PANEL_SPECIALS.filter(panelSpecialOwned).length;
    return owned / total;
  }
  // a purchase is { chain, tier, cost } (a category or an unlock chain) or { special, cost }
  function applyPanelPurchase(buy) {
    save.transcendPoints -= buy.cost;
    if (buy.special) {
      save.panelSpecials[buy.special.id] = true;
      return;
    }
    save.panelLevels[buy.chain.id] = buy.tier;
    if (buy.chain === PANEL_REMNANT_CHAIN) ensureRemnantDecks();
  }
  function buyPanelOne(buy) {
    const before = panelProgress();
    applyPanelPurchase(buy);
    checkAchievements();
    persistSave();
    renderPanel();
    celebrateIfCompleted(before, panelProgress(), "転生パネル");
  }
  function affordablePanelPurchases() {
    const out = [];
    PANEL_CATEGORIES.concat(PANEL_CHAINS).forEach((c) => {
      if (c === PANEL_TRIAL_CHAIN) return;
      const tier = panelLevel(c) + 1;
      if (tier <= c.maxLevel && panelChainNodeState(c, tier) === "available") out.push({ chain: c, tier, cost: panelTierCost(c, tier) });
    });
    PANEL_SPECIALS.forEach((sp) => { if (panelSpecialState(sp) === "available") out.push({ special: sp, cost: sp.cost }); });
    return out;
  }
  function bulkBuyPanel() {
    const before = panelProgress();
    let count = 0;
    let spent = 0;
    for (;;) {
      const buy = affordablePanelPurchases().sort((a, b) => a.cost - b.cost)[0];
      if (!buy) break;
      spent += buy.cost;
      applyPanelPurchase(buy);
      count += 1;
    }
    if (!count) { showToast("いま買える転生パネルの強化はない"); return; }
    checkAchievements();
    persistSave();
    renderPanel();
    showToast(`一括購入：転生パネルを${count}段強化した（転生ポイント -${fmt(spent)}）`);
    celebrateIfCompleted(before, panelProgress(), "転生パネル");
  }
  function panelHasAnythingToBuy() {
    return PANEL_CATEGORIES.some((c) => panelLevel(c) < c.maxLevel)
      || PANEL_CHAINS.some((c) => panelLevel(c) < c.maxLevel)
      || PANEL_SPECIALS.some((sp) => !panelSpecialOwned(sp));
  }

  function renderPanel() {
    el.panelPointsLabel.textContent = fmt(save.transcendPoints)
      + (panelFromTitle ? `（転生すると +${fmt(transcendGainForLevel(save.level))}）` : "");
    el.panelSub.textContent = panelFromTitle
      ? "転生ポイントで永続的な強化を買える（転生しなくても買える）。ここでの強化は転生しても失われない。"
      : "転生した！ソウル・基本強化・デッキ・秘宝は初期状態に戻った。ここでの強化は転生しても失われない。中心の「核」をクリックすると次の周回へ進む。";
    el.panelMap.innerHTML = "";

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "tree-map-svg");
    svg.setAttribute("viewBox", `0 0 ${PANEL_CANVAS_WIDTH} ${PANEL_CANVAS_HEIGHT}`);

    PANEL_CATEGORIES.forEach((cat) => {
      cat.nodeIds.forEach((id, i) => {
        const from = i === 0 ? PANEL_POS.core : PANEL_POS[cat.nodeIds[i - 1]];
        const to = PANEL_POS[id];
        const line = document.createElementNS(svgNS, "line");
        line.setAttribute("x1", from.x);
        line.setAttribute("y1", from.y);
        line.setAttribute("x2", to.x);
        line.setAttribute("y2", to.y);
        if (panelLevel(cat) >= i + 1) line.setAttribute("class", "active");
        svg.appendChild(line);
      });
    });
    [...PANEL_SPECIALS, PANEL_MARK].forEach((special, i, list) => {
      const from = i === 0 ? PANEL_POS.core : PANEL_POS[list[i - 1].id];
      const to = PANEL_POS[special.id];
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", from.x);
      line.setAttribute("y1", from.y);
      line.setAttribute("x2", to.x);
      line.setAttribute("y2", to.y);
      if (special === PANEL_MARK ? markLevelRaw() > 0 : panelSpecialOwned(special)) line.setAttribute("class", "active");
      svg.appendChild(line);
    });
    PANEL_CHAINS.forEach((chain) => chain.nodeIds.forEach((id, i) => {
      const from = panelChainLineStart(chain, i);
      const to = PANEL_POS[id];
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", from.x);
      line.setAttribute("y1", from.y);
      line.setAttribute("x2", to.x);
      line.setAttribute("y2", to.y);
      if (panelLevel(chain) >= i + 1) line.setAttribute("class", "active");
      svg.appendChild(line);
    }));
    // magic-circle backdrop behind everything: a ring per row, the outer rune band, the stars, and the
    // 12 slice borders
    const core = PANEL_POS.core;
    drawMagicBackdrop(svg, core.x, core.y, Array.from({ length: panelRowCount }, (_, row) => PANEL_ROW_START + PANEL_ROW_STEP * row), "panel", panelProgress());
    const deco = document.createElementNS(svgNS, "g");
    deco.setAttribute("class", "panel-circle");
    const outer = PANEL_ROW_START + PANEL_ROW_STEP * (panelRowCount - 0.5);
    for (let i = 0; i < 360 / PANEL_SECTOR_DEG; i++) {
      const rad = ((panelSpokeAngle(i) + PANEL_SECTOR_DEG / 2) * Math.PI) / 180;
      const spoke = document.createElementNS(svgNS, "line");
      spoke.setAttribute("x1", core.x + Math.cos(rad) * (PANEL_ROW_START - PANEL_ROW_STEP / 2));
      spoke.setAttribute("y1", core.y - Math.sin(rad) * (PANEL_ROW_START - PANEL_ROW_STEP / 2));
      spoke.setAttribute("x2", core.x + Math.cos(rad) * outer);
      spoke.setAttribute("y2", core.y - Math.sin(rad) * outer);
      deco.appendChild(spoke);
    }
    svg.insertBefore(deco, svg.firstChild);
    el.panelMap.appendChild(svg);

    const coreDiv = document.createElement("div");
    coreDiv.className = "tree-map-node core";
    coreDiv.style.left = PANEL_POS.core.x + "px";
    coreDiv.style.top = PANEL_POS.core.y + "px";
    coreDiv.innerHTML = EMBLEM_SVG + `<div>核</div><div class="core-sub">次の周回へ</div>`;
    coreDiv.addEventListener("click", leavePanel);
    el.panelMap.appendChild(coreDiv);

    PANEL_CATEGORIES.forEach((cat) => {
      cat.nodeIds.forEach((id, i) => {
        const tier = i + 1;
        const pos = PANEL_POS[id];
        const state = panelChainNodeState(cat, tier);
        const div = document.createElement("div");
        div.className = "tree-map-node " + state;
        div.style.left = pos.x + "px";
        div.style.top = pos.y + "px";
        const costLabel = state === "unlocked" ? "習得済み" : `${fmt(panelTierCost(cat, tier))}pt`;
        div.innerHTML = `<div class="tn-name">${cat.label} ${tier}</div><div class="tn-desc">${cat.desc} +${fmtMult(panelTierAmount(cat, tier))}</div><div class="tn-cost">${costLabel}</div>`;
        if (state === "available") {
          div.addEventListener("click", () => {
            if (panelChainNodeState(cat, tier) !== "available") return;
            buyPanelOne({ chain: cat, tier, cost: panelTierCost(cat, tier) });
          });
        }
        el.panelMap.appendChild(div);
      });
    });

    PANEL_SPECIALS.forEach((special) => {
      const pos = PANEL_POS[special.id];
      const state = panelSpecialState(special);
      const div = document.createElement("div");
      div.className = "tree-map-node panel-special " + state;
      div.style.left = pos.x + "px";
      div.style.top = pos.y + "px";
      const costLabel = state === "unlocked" ? "習得済み" : `${fmt(special.cost)}pt`;
      div.innerHTML = `<div class="tn-name">${special.label}</div><div class="tn-desc">${special.desc}</div><div class="tn-cost">${costLabel}</div>`;
      if (state === "available") {
        div.addEventListener("click", () => {
          if (panelSpecialState(special) !== "available") return;
          buyPanelOne({ special, cost: special.cost });
        });
      }
      el.panelMap.appendChild(div);
    });
    {
      const pos = PANEL_POS[PANEL_MARK.id];
      const state = markState();
      const div = document.createElement("div");
      div.className = "tree-map-node panel-special panel-mark " + state;
      div.style.left = pos.x + "px";
      div.style.top = pos.y + "px";
      const lv = markLevelRaw();
      div.innerHTML = `<div class="tn-name">${PANEL_MARK.label} Lv.${lv}</div><div class="tn-desc">全ダメージ ×${PANEL_MARK.step}（何度でも・現在 ×${fmtMult(Math.pow(PANEL_MARK.step, lv))}）</div>`
        + `<div class="tn-cost">${state === "locked" ? "特殊強化を全て習得で解放" : lv >= PANEL_MARK.maxLevel ? "最大" : fmt(markCost()) + "pt"}</div>`;
      if (state === "available") {
        div.addEventListener("click", () => {
          if (markState() !== "available") return;
          save.transcendPoints -= markCost();
          save.panelLevels[PANEL_MARK.id] = lv + 1;
          checkAchievements();
          persistSave();
          renderPanel();
        });
      }
      el.panelMap.appendChild(div);
    }

    PANEL_CHAINS.forEach((chain) => chain.nodeIds.forEach((id, i) => {
      const tier = i + 1;
      const pos = PANEL_POS[id];
      const state = panelChainNodeState(chain, tier);
      const div = document.createElement("div");
      div.className = "tree-map-node " + state;
      div.style.left = pos.x + "px";
      div.style.top = pos.y + "px";
      const costLabel = state === "unlocked" ? "習得済み" : `${fmt(panelTierCost(chain, tier))}pt`;
      div.innerHTML = `<div class="tn-name">${chain.label} ${tier}</div><div class="tn-desc">${chain.nodeDesc(tier)}</div><div class="tn-cost">${costLabel}</div>`;
      if (state === "available") {
        div.addEventListener("click", () => {
          if (panelChainNodeState(chain, tier) !== "available") return;
          buyPanelOne({ chain, tier, cost: panelTierCost(chain, tier) });
        });
      }
      el.panelMap.appendChild(div);
    }));
  }

  // endless checkpoints follow the same 10-floor rhythm (101, 111, …), each opening once the floor
  // before it (the 100F final boss / a 10F mid-boss) has been cleared since the last reincarnation.
  // Only 101 and the deepest ones are listed, so a very deep save doesn't build thousands of cards.
  const ENDLESS_CHECKPOINTS_SHOWN = 30;
  function endlessCheckpointsAll() {
    const out = [];
    for (let f = FINAL_FLOOR + 1; f - 1 <= save.bestClearedFloor; f += 10) out.push(f);
    return out;
  }
  function endlessCheckpoints() {
    const out = endlessCheckpointsAll();
    return out.length > ENDLESS_CHECKPOINTS_SHOWN ? [out[0]].concat(out.slice(-(ENDLESS_CHECKPOINTS_SHOWN - 1))) : out;
  }

  function renderFloorSelect() {
    el.floorSelectGrid.innerHTML = "";
    FLOOR_CHECKPOINTS.concat(endlessCheckpoints()).forEach((floor) => {
      const isBoss = floor === FINAL_FLOOR;
      const div = document.createElement("div");
      div.className = "floor-select-card" + (isBoss ? " boss" : "");
      const hpPreview = fmt(enemyHpForFloor(floor));
      div.innerHTML = `
        <div class="fs-floor${isBoss ? " boss" : ""}">${isBoss ? "ラスボス" : floor + "階"}</div>
        <div class="fs-hp">${floor > FINAL_FLOOR ? "エンドレス・" : ""}HP ${hpPreview}</div>
      `;
      div.addEventListener("click", () => newRun(floor));
      el.floorSelectGrid.appendChild(div);
    });
  }

