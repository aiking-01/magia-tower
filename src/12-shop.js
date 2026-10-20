// src/12-shop.js — part of game.js (merchant, 秘宝, deck zone, card shop, auto-buy). Edit here, then run: node tools/build.js
  // ---------------- Shop (floor clear) ----------------
  // shop only sells temporary this-run stat boosts now; deck changes (rank-up/delete, new
  // cards via the skill tree) are permanent, meta-level actions handled outside a run.
  const SHOP_POOL = [
    // a percent, not +3 flat: auto-buy stacked hundreds of +3s, which dwarfed the whole early tree
    { id: "atk3", name: "闘志の秘薬", desc: "攻撃力 +3%（このラン中）", baseCost: 20, apply: () => { game.runAtkPctBonus += 3; } },
    // 初期手札+1は全フロアの手数効率に効き続ける強力な効果なので、序盤の周回では商人に並ばない。
    // 手札が山札に近づくと使ったカードがすぐ手元に戻るので、出現率を大きく下げ（weight）、1ラン3個まで。
    // 手札+2がデッキ枚数に届いたら並ばない（手札9=デッキ9で双撃の構えの連打が復活していた）
    { id: "hand1", name: "集中の秘薬", desc: "初期手札 +1（このラン中、最大3回）", baseCost: 30, unlockFloor: 11, weight: 0.15, maxPerRun: 3, apply: () => { game.runHandBonus += 1; } },
    // +1% with a per-run cap: at +10% a few purchases hit 100% crit and made the crit-rate tree pointless
    { id: "critRate1", name: "会心の秘薬", desc: "クリティカル率 +1%（このラン中、最大30回）", baseCost: 25, maxPerRun: 30, apply: () => { game.runCritRateBonus += 1; } },
    // unlimited at a flat price, long runs just stacked it forever; ×1.1 per buy keeps it the crit sink
    { id: "critDmg1", name: "会心撃の秘薬", desc: "クリティカルダメージ +15%（このラン中、買うたび価格上昇）", baseCost: 25, priceGrowth: 1.1, apply: () => { game.runCritDamageBonus += 15; } },
    // gold feeds every other purchase, so it snowballed (+26,850% in one tested run at +50% each): now
    // +10% and each repeat buy in the same run costs ×1.2 more
    { id: "goldRun1", name: "強欲の秘薬", desc: "獲得金額 +10%（このラン中、買うたび価格上昇）", baseCost: 30, unlockFloor: 21, priceGrowth: 1.2, apply: () => { game.runGoldPctBonus += 10; } },
    //{ id: "runN1", name: "疾風の秘薬", desc: "初期手数 +2（このラン中）", baseCost: 35, apply: () => { game.runNBonus += 2; } },
  ];

  // ---------------- 秘宝 (rare merchant items) ----------------
  // now and then the floor-clear merchant also lays out one 秘宝: a strong, permanent effect that is kept
  // across runs until the next reincarnation. Each kind can be held up to `max` copies (+ 秘宝の契約's
  // 所持上限); copies stack (multipliers multiply, additions add). 秘宝の契約 also raises the chance and
  // scales the effect: a ×v item becomes ×(1 + (v−1)(1 + power)), a +v item +v(1 + power); `flat` ones
  // (counts like 手数) are never scaled. Rolled once per merchant visit, so rerolling can't fish for them.
  const ITEM_BASE_CHANCE = 0.015;
  const ITEM_DEFS = [
    { id: "dragonHeart", name: "竜の心臓", desc: "全ダメージ ×{v}", key: "dmgMult", value: 3, max: 3, weight: 1, price: 1 },
    { id: "philosopherStone", name: "賢者の石", desc: "累乗 +{v}", key: "exponent", value: 0.1, max: 3, weight: 0.5, price: 1.5, additive: true },
    { id: "hourglass", name: "刻の砂時計", desc: "手数 +{v}", key: "n", value: 1, max: 2, weight: 0.4, price: 1.5, additive: true, flat: true },
    { id: "seerCrystal", name: "千里眼の水晶", desc: "会心率 +{v}%", key: "critRate", value: 15, max: 2, weight: 1, price: 0.8, additive: true },
    { id: "starGem", name: "星砕きの宝玉", desc: "会心倍率 ×{v}", key: "critMult", value: 2, max: 2, weight: 0.8, price: 1 },
    { id: "warBangle", name: "闘神の腕輪", desc: "バフカードの倍率 +{v}", key: "buffAdd", value: 1, max: 2, weight: 0.8, price: 1, additive: true },
    { id: "giantHammer", name: "巨人殺しの槌", desc: "中ボス・ラスボスへのダメージ ×{v}", key: "bossMult", value: 10, max: 2, weight: 0.8, price: 0.8 },
    { id: "warHorn", name: "先駆けの角笛", desc: "各階で最初に使う攻撃・特殊カードのダメージ ×{v}", key: "firstMult", value: 10, max: 2, weight: 0.8, price: 0.8 },
    { id: "echoBell", name: "残響の鈴", desc: "残滓のダメージ ×{v}", key: "remnantMult", value: 3, max: 2, weight: 0.6, price: 1, needsRemnant: true },
    { id: "goldScale", name: "黄金の天秤", desc: "獲得金額 ×{v}", key: "goldMult", value: 2, max: 2, weight: 1.2, price: 0.6 },
    { id: "soulGrail", name: "魂喰らいの杯", desc: "ソウル獲得 ×{v}", key: "soulMult", value: 2, max: 2, weight: 0.8, price: 1 },
    { id: "sageTome", name: "叡智の古書", desc: "経験値 ×{v}", key: "expMult", value: 3, max: 2, weight: 0.8, price: 1 },
    { id: "chaosShard", name: "混沌の欠片", desc: "全ダメージ ×{v}", key: "dmgMult", value: 30, max: 1, weight: 0.08, price: 3, legendary: true },
    // only sold past 100F, where the 特性 are
    { id: "wardCharm", name: "破魔の護符", desc: "特性を持つ敵へのダメージ ×{v}", key: "traitMult", value: 4, max: 2, weight: 0.8, price: 1, deepOnly: true },
  ];
  // 秘宝の覚醒: a 秘宝 held at its cap comes back to the merchant as "〇〇の覚醒": each level adds +50% to that one
  // 秘宝's effect (like 秘宝の契約's 効果+%), at its next-copy price ×3 per level. Kept until the next reincarnation.
  // Only multiplying 秘宝 awaken: 累乗 could run away (it multiplies the level curve), 手数 is a count, 会心率 caps at
  // 100%, and the 腕輪's +buff adds up without end.
  const ITEM_AWAKEN_STEP = 0.5;
  const ITEM_AWAKEN_PRICE_GROWTH = 3;
  function itemAwakenable(def) { return !def.additive && !def.flat; }
  function itemAwakenLevel(def) { return (save.itemAwaken && save.itemAwaken[def.id]) || 0; }
  function itemCount(def) { return save.items[def.id] || 0; }
  function itemMax(def) { return def.max + itemChainBonus("limit"); }
  function itemPower() { return itemChainBonus("power") / 100; }
  function itemValue(def, awakenExtra) {
    if (def.flat) return def.value;
    if (def.additive) return def.value * (1 + itemPower());
    return 1 + (def.value - 1) * (1 + itemPower() + ITEM_AWAKEN_STEP * (itemAwakenLevel(def) + (awakenExtra || 0)));
  }
  function itemDescText(def) { return def.desc.replace("{v}", fmtMult(itemValue(def))); }
  function itemSum(key) {
    return ITEM_DEFS.reduce((sum, d) => sum + (d.key === key && d.additive ? itemValue(d) * itemCount(d) : 0), 0);
  }
  function itemProduct(key) {
    return ITEM_DEFS.reduce((m, d) => m * (d.key === key && !d.additive && itemCount(d) ? Math.pow(itemValue(d), itemCount(d)) : 1), 1);
  }
  function itemsOwnedTotal() { return ITEM_DEFS.reduce((n, d) => n + itemCount(d), 0); }
  function itemChance() { return ITEM_BASE_CHANCE * (1 + itemChainBonus("rate") / 100); }
  // each further copy of the same 秘宝 costs ×2; the base follows the floor like the potions do
  function itemCost(def) { return Math.ceil((60 + game.floor * 12) * def.price * Math.pow(2, itemCount(def))); }
  function itemAwakenCost(def) { return Math.ceil(itemCost(def) * Math.pow(ITEM_AWAKEN_PRICE_GROWTH, itemAwakenLevel(def))); }
  // one pool entry per 秘宝: a new copy while below the cap, its 覚醒 once at the cap
  function itemOfferPool() {
    return ITEM_DEFS.filter((d) => (!d.needsRemnant || activeRemnantCount() > 0) && (!d.deepOnly || game.floor > FINAL_FLOOR))
      .filter((d) => itemCount(d) < itemMax(d) || itemAwakenable(d))
      .map((d) => ({ def: d, weight: d.weight, awaken: itemCount(d) >= itemMax(d) }));
  }
  function rollItemOffers() {
    game.itemOffers = [];
    if (trialRule("noShop", false)) return;
    const pool = itemOfferPool();
    const slots = 1 + itemChainBonus("slots");
    const guaranteed = !!game.guaranteedItem;
    game.guaranteedItem = false;
    for (let i = 0; i < slots; i++) {
      if (!(DEBUG_MODE && i === 0) && !(guaranteed && i === 0) && Math.random() >= itemChance()) continue;
      const pick = pickWeighted(pool.filter((e) => !game.itemOffers.some((o) => o.def === e.def)), 1)[0];
      if (pick) game.itemOffers.push({ def: pick.def, awaken: pick.awaken, cost: pick.awaken ? itemAwakenCost(pick.def) : itemCost(pick.def), bought: false });
    }
    if (game.itemOffers.length) bumpStat("itemsSeen", game.itemOffers.length);
  }
  function buyItemOffer(offer) {
    debugTopUp();
    if (offer.bought || game.gold < offer.cost) return false;
    if (offer.awaken) {
      game.gold -= offer.cost;
      save.itemAwaken[offer.def.id] = itemAwakenLevel(offer.def) + 1;
      offer.bought = true;
      bumpStat("itemsAwakened");
      track("item", { id: offer.def.id, floor: game.floor, awaken: itemAwakenLevel(offer.def) });
      addLog(`秘宝の覚醒：${offer.def.name}（覚醒${itemAwakenLevel(offer.def)}・${itemDescText(offer.def)}）`, "levelup");
      showToast(`秘宝「${offer.def.name}」が覚醒した！ 覚醒${itemAwakenLevel(offer.def)}：${itemDescText(offer.def)}（次の転生まで有効）`);
      checkAchievements();
      persistSave();
      return true;
    }
    if (itemCount(offer.def) >= itemMax(offer.def)) return false;
    game.gold -= offer.cost;
    save.items[offer.def.id] = itemCount(offer.def) + 1;
    offer.bought = true;
    bumpStat("itemsBought");
    track("item", { id: offer.def.id, floor: game.floor });
    addLog(`秘宝を入手：${offer.def.name}（${itemDescText(offer.def)}）`, "levelup");
    showToast(`秘宝「${offer.def.name}」を手に入れた！ ${itemDescText(offer.def)}（次の転生まで有効）`);
    checkAchievements();
    persistSave();
    return true;
  }
  function ownedItemsText() {
    return ITEM_DEFS.filter((d) => itemCount(d) > 0)
      .map((d) => `${d.name}${itemCount(d) > 1 ? "×" + itemCount(d) : ""}${itemAwakenLevel(d) ? `（覚醒${itemAwakenLevel(d)}）` : ""}`).join("・");
  }

  function shopBuyCount(opt) { return game.shopBuyCounts[opt.id] || 0; }
  function runDeckSize() { return game.deckDefs.reduce((sum, d) => sum + d.count, 0); }
  function availableShopPool() {
    if (trialRule("noShop", false)) return [];
    return SHOP_POOL.filter((opt) => (!opt.unlockFloor || save.bestClearedFloor >= opt.unlockFloor)
      && (!opt.maxPerRun || shopBuyCount(opt) < opt.maxPerRun)
      // the hand must stay 2+ cards short of the deck, or a played card comes straight back
      && !(opt.id === "hand1" && currentStartHand() + 2 >= runDeckSize()));
  }
  function shopOfferCost(opt) {
    const base = opt.baseCost + game.floor * 2;
    return opt.priceGrowth ? Math.ceil(base * Math.pow(opt.priceGrowth, shopBuyCount(opt))) : base;
  }
  function rollShopOffers() {
    game.shopOffers = pickWeighted(availableShopPool(), shopOfferCount()).map((opt) => ({ opt, cost: shopOfferCost(opt), bought: false }));
  }
  // distinct picks, each item's chance proportional to its weight (default 1)
  function pickWeighted(arr, count) {
    const copy = arr.slice();
    const out = [];
    while (out.length < count && copy.length > 0) {
      const total = copy.reduce((sum, o) => sum + (o.weight || 1), 0);
      let r = Math.random() * total;
      let i = 0;
      while (i < copy.length - 1 && (r -= copy[i].weight || 1) >= 0) i++;
      out.push(copy.splice(i, 1)[0]);
    }
    return out;
  }

  function openFloorClear(goldGain, levelBefore, levelsGained) {
    debugTopUp();
    const next = game.floor + 1;
    const nextTag = next === FINAL_FLOOR ? "【ラスボス】" : next % 10 === 0 ? "【中ボス】" : "";
    el.floorClearSub.textContent = `${game.floor}階クリア（+${fmt(goldGain)}G）。次は${next}階${nextTag}：HP ${jpUnitText(enemyHpForFloor(next))}　Lv.${save.level}（次まで ${expRemainingText()}）`;
    if (levelsGained > 0) {
      el.levelUpBanner.innerHTML = "";
      const a = document.createElement("div");
      a.className = "levelup-main";
      a.textContent = `LEVEL UP!  Lv.${levelBefore} → Lv.${save.level}`;
      const b = document.createElement("div");
      b.className = "levelup-sub";
      b.textContent = `レベル倍率 ×${fmtMult(Decimal.pow(levelDamageMultPer(), levelsGained))}・会心ダメージ +${fmt(levelsGained * LEVEL_CRIT_DMG)}%`;
      el.levelUpBanner.appendChild(a);
      el.levelUpBanner.appendChild(b);
      el.levelUpBanner.style.display = "";
    } else el.levelUpBanner.style.display = "none";
    rollShopOffers();
    rollItemOffers();
    game.shopRerollsUsed = 0;
    el.autoBuySummary.textContent = "";
    renderShop();
    showScreen("floorClear");
    if (autoBuyUnlocked() && save.autoBuyEnabled) setTimeout(runAutoBuy, spd(AUTO_BUY_STEP_MS));
  }

  // deck strengthening screen: title-screen-only, permanent, paid with level-up points (save.points)
  function renderDeckZone() {
    el.deckUpgradePointsLabel.textContent = fmt(save.points);
    el.deckZoneTotal.textContent = `編成デッキ: ${fmt(totalActiveCards())}枚`;
    el.deckZoneList.innerHTML = "";
    save.deckDefs.forEach((def) => {
      const rCost = rankUpCost(def);
      const dCost = deleteCost(def);
      const deletable = canDeleteCard(def);
      const active = activeCount(def);
      const canDec = canDecreaseActive(def);
      const canInc = canIncreaseActive(def);
      const row = document.createElement("div");
      row.className = "deck-zone-row";
      const rankVoid = trialRule("noRank", false); // 苦難「枯渇」: ranks have no effect, so buying one would be wasted
      const rankEligible = !rankVoid && def.type !== "chain" && def.type !== "special" && def.type !== "poison" && def.type !== "percent" && !def.randomValues;
      const rankLabel = def.rank ? ` / Lv.${def.rank}` : "";
      row.innerHTML = `
        <div class="dz-info">
          <div class="dz-name">${escapeHtml(def.name)}</div>
          <div class="dz-meta">${TYPE_LABELS[def.type] || escapeHtml(def.type)} / 所持${def.count}枚${rankLabel}</div>
        </div>
        <div class="dz-active">
          <button class="dz-btn" ${canDec ? "" : "disabled"} data-action="activeDown">−</button>
          <span class="dz-active-count">編成 ${active}/${def.count}</span>
          <button class="dz-btn" ${canInc ? "" : "disabled"} data-action="activeUp">＋</button>
        </div>
        <div class="dz-actions">
          <button class="dz-btn" ${rankEligible ? "" : "disabled"} data-action="rank">${rankVoid ? "苦難で無効" : `強化 ${fmt(rCost)}pt`}</button>
          <button class="dz-btn danger" ${deletable ? "" : "disabled"} data-action="delete">削除 ${deletable ? fmt(dCost) + "pt" : "これ以上不可"}</button>
        </div>
      `;
      const rankBtn = row.querySelector('[data-action="rank"]');
      const deleteBtn = row.querySelector('[data-action="delete"]');
      const activeDownBtn = row.querySelector('[data-action="activeDown"]');
      const activeUpBtn = row.querySelector('[data-action="activeUp"]');
      if (rankEligible) {
        rankBtn.disabled = save.points < rCost;
        rankBtn.addEventListener("click", () => {
          rankUpDeckDef(def);
          renderDeckZone();
        });
      }
      if (deletable) {
        deleteBtn.disabled = save.points < dCost;
        deleteBtn.addEventListener("click", () => {
          deleteDeckDef(def);
          renderDeckZone();
        });
      }
      if (canDec) activeDownBtn.addEventListener("click", () => { adjustActive(def, -1); renderDeckZone(); });
      if (canInc) activeUpBtn.addEventListener("click", () => { adjustActive(def, 1); renderDeckZone(); });
      el.deckZoneList.appendChild(row);
    });
  }

  // each purchase of the same item raises its next price, the same anti-snowball idea as the deck
  // screen's rank-up/delete costs -- a flat price let one strong card be bought without limit.
  const CARD_SHOP_PRICE_GROWTH = 1.5;
  function cardShopPurchaseCount(item) {
    const recorded = save.cardShopPurchases[item.id];
    if (recorded != null) return recorded;
    // saves from before this counter existed: every shop card came only from the shop, so the
    // copies owned are the best available stand-in for how many were bought
    const owned = save.deckDefs.find((d) => d.name === item.card.name && d.type === item.card.type);
    return owned ? owned.count : 0;
  }
  function cardShopPrice(item) {
    return Math.ceil(item.cost * Math.pow(CARD_SHOP_PRICE_GROWTH, cardShopPurchaseCount(item)));
  }

  function renderCardShop() {
    el.cardShopPointsLabel.textContent = fmt(save.points);
    el.cardShopOptions.innerHTML = "";
    // the panel's 商人との契約 chain unlocks these one at a time, in order
    CARD_SHOP_POOL.slice(0, shopUnlockedCount()).forEach((item) => {
      const owned = save.deckDefs.find((d) => d.name === item.card.name && d.type === item.card.type);
      const countLabel = owned ? `（所持 ${owned.count}枚）` : "";
      const price = cardShopPrice(item);
      const affordable = save.points >= price;
      const div = document.createElement("div");
      div.className = "option-card" + (affordable ? "" : " disabled");
      div.innerHTML = `<div class="oc-name">${item.name}${countLabel}</div><div class="oc-desc">${item.desc}</div><div class="oc-cost">${fmt(price)}pt</div>`;
      if (affordable) {
        div.addEventListener("click", () => {
          if (save.points < price) return;
          save.points -= price;
          save.cardShopPurchases[item.id] = cardShopPurchaseCount(item) + 1;
          addCardToDeckDefs(save.deckDefs, item.card);
          persistSave();
          renderCardShop();
        });
      }
      el.cardShopOptions.appendChild(div);
    });
  }

  function rerollCost() {
    const freeLeft = freeRerollAllowance() - game.shopRerollsUsed;
    if (freeLeft > 0) return 0;
    // ×1.5 per paid reroll within this visit: the old +5G steps were so cheap that rerolling
    // hundreds of times per floor was the optimal play
    const paidRerolls = game.shopRerollsUsed - freeRerollAllowance();
    return Math.ceil((10 + game.floor * 2) * Math.pow(1.5, paidRerolls));
  }

  function buyOffer(offer) {
    debugTopUp();
    if (offer.bought || game.gold < offer.cost) return false;
    game.gold -= offer.cost;
    offer.opt.apply();
    offer.bought = true;
    game.shopBuyCounts[offer.opt.id] = shopBuyCount(offer.opt) + 1;
    addLog(`購入：${offer.opt.name}`, "gold");
    return true;
  }

  function doReroll() {
    debugTopUp();
    if (!availableShopPool().length) return false; // nothing can come up (苦難「飢餓」★★★)
    const cost = rerollCost();
    if (game.gold < cost) return false;
    game.gold -= cost;
    game.shopRerollsUsed += 1;
    rollShopOffers();
    addLog(cost > 0 ? `商人のラインナップをリロール（-${fmt(cost)}G）` : `商人のラインナップをリロール（無料）`, "gold");
    return true;
  }

  function renderShop() {
    el.shopGold.textContent = fmt(game.gold);
    el.shopOptions.innerHTML = "";
    (game.itemOffers || []).forEach((offer) => {
      const div = document.createElement("div");
      const affordable = !offer.bought && game.gold >= offer.cost;
      div.className = "option-card item-offer" + (offer.def.legendary ? " legendary" : "") + (offer.bought || !affordable || autoBuyRunning ? " disabled" : "");
      const owned = itemCount(offer.def);
      const body = offer.awaken
        ? `${offer.def.desc.replace("{v}", fmtMult(itemValue(offer.def)))} → ${offer.def.desc.replace("{v}", fmtMult(itemValue(offer.def, 1)))}（1つあたり）<br><small>覚醒 ${itemAwakenLevel(offer.def)} → ${itemAwakenLevel(offer.def) + 1}・次の転生まで有効</small>`
        : `${itemDescText(offer.def)}<br><small>次の転生まで有効・所持 ${owned}/${itemMax(offer.def)}</small>`;
      div.innerHTML = `<div class="oc-tag">${offer.awaken ? "秘宝の覚醒" : offer.def.legendary ? "伝説の秘宝" : "秘宝"}</div>`
        + `<div class="oc-name">${offer.def.name}${offer.awaken ? "の覚醒" : ""}</div>`
        + `<div class="oc-desc">${body}</div>`
        + `<div class="oc-cost">${offer.bought ? "購入済み" : fmt(offer.cost) + " G"}</div>`;
      if (!offer.bought && affordable) {
        div.addEventListener("click", () => {
          if (autoBuyRunning) return;
          if (buyItemOffer(offer)) renderShop();
        });
      }
      el.shopOptions.appendChild(div);
    });
    game.shopOffers.forEach((offer) => {
      const div = document.createElement("div");
      const affordable = !offer.bought && game.gold >= offer.cost;
      div.className = "option-card" + (offer.bought || !affordable || autoBuyRunning ? " disabled" : "");
      div.innerHTML = `<div class="oc-name">${offer.opt.name}</div><div class="oc-desc">${offer.opt.desc}</div><div class="oc-cost">${offer.bought ? "購入済み" : fmt(offer.cost) + " G"}</div>`;
      if (!offer.bought && affordable) {
        div.addEventListener("click", () => {
          if (autoBuyRunning) return;
          if (buyOffer(offer)) renderShop();
        });
      }
      el.shopOptions.appendChild(div);
    });

    const cost = rerollCost();
    const free = cost === 0;
    const canReroll = !autoBuyRunning && availableShopPool().length > 0 && (free || game.gold >= cost);
    el.rerollBtn.textContent = free ? `リロール（無料）` : `リロール（${fmt(cost)}G）`;
    el.rerollBtn.disabled = !canReroll;
    el.rerollBtn.style.opacity = canReroll ? "1" : "0.5";

    const unlocked = autoBuyUnlocked();
    el.autoBuyRow.style.display = unlocked ? "" : "none";
    el.autoBuyBtn.textContent = autoBuyRunning ? "自動購入を停止" : "自動購入";
    el.autoBuyToggle.checked = !!save.autoBuyEnabled;
    const owned = ownedItemsText();
    el.shopItems.style.display = owned ? "" : "none";
    el.shopItems.textContent = owned ? `所持している秘宝：${owned}` : "";
  }

  el.rerollBtn.addEventListener("click", () => {
    if (autoBuyRunning) return;
    if (doReroll()) renderShop();
  });

  // ---------------- Auto-buy (unlocked by the 自動購入開放 tree node) ----------------
  // repeats "buy everything affordable on offer (cheapest first) → reroll" at a quick but visible
  // pace until the gold runs out. It only rerolls when the gold left after paying for the reroll
  // could still buy the cheapest potion available, so it never burns the last gold on a reroll
  // that can't lead to a purchase. Rising reroll (×1.5) and 強欲 (×1.2) prices end the loop.
  const AUTO_BUY_STEP_MS = 25;
  let autoBuyRunning = false;
  let autoBuyStopRequested = false;
  function autoBuyUnlocked() { return NODES.some((n) => n.kind === "autoBuy" && save.unlockedNodes[n.id]); }

  async function runAutoBuy() {
    if (autoBuyRunning || !game || !game.shopOffers || !autoBuyUnlocked()) return;
    const thisGame = game;
    const stillHere = () => game === thisGame && game.shopOffers && document.getElementById("screen-floorClear").classList.contains("active");
    autoBuyRunning = true;
    autoBuyStopRequested = false;
    const goldBefore = game.gold;
    const bought = {};
    let rerolls = 0;
    renderShop();
    while (!autoBuyStopRequested && stillHere()) {
      // a 秘宝 comes first: it's rare and lasts until the next reincarnation, a potion only for this run
      const item = (game.itemOffers || []).find((o) => !o.bought && game.gold >= o.cost);
      if (item) {
        buyItemOffer(item);
        bought[item.def.name] = (bought[item.def.name] || 0) + 1;
        renderShop();
        await new Promise((r) => setTimeout(r, spd(AUTO_BUY_STEP_MS)));
        continue;
      }
      const offer = game.shopOffers.filter((o) => !o.bought && game.gold >= o.cost).sort((a, b) => a.cost - b.cost)[0];
      if (offer) {
        buyOffer(offer);
        bought[offer.opt.name] = (bought[offer.opt.name] || 0) + 1;
      } else {
        const pool = availableShopPool();
        const cheapest = pool.length ? Math.min(...pool.map(shopOfferCost)) : Infinity;
        const cost = rerollCost();
        if (game.gold - cost < cheapest || !doReroll()) break;
        rerolls += 1;
      }
      renderShop();
      await new Promise((r) => setTimeout(r, spd(AUTO_BUY_STEP_MS)));
    }
    autoBuyRunning = false;
    if (game !== thisGame || !game.shopOffers) return; // left the shop mid-way (next floor / retreat)
    const items = Object.entries(bought).map(([name, n]) => `${name}×${n}`).join("、") || "なし";
    el.autoBuySummary.textContent = `自動購入：${items}／リロール${rerolls}回／使用 ${fmt(goldBefore - game.gold)}G`;
    renderShop();
  }

  el.autoBuyBtn.addEventListener("click", () => {
    if (autoBuyRunning) autoBuyStopRequested = true;
    else runAutoBuy();
  });
  el.autoBuyToggle.addEventListener("change", () => {
    save.autoBuyEnabled = el.autoBuyToggle.checked;
    persistSave();
    if (save.autoBuyEnabled) runAutoBuy();
  });

  function goNextFloor() {
    if (!game || !game.shopOffers) return;
    autoBuyStopRequested = true;
    game.shopOffers = null;
    game.itemOffers = null;
    startFloor(game.floor + 1);
  }
  el.toNextFloorBtn.addEventListener("click", goNextFloor);

  el.retreatBtn.addEventListener("click", () => {
    onRetreat();
  });

