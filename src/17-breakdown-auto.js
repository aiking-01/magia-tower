// src/17-breakdown-auto.js — part of game.js (倍率の内訳 and auto-play). Edit here, then run: node tools/build.js
  // ---------------- 倍率の内訳 (tap 倍率 in battle) ----------------
  // every number comes from the same functions the damage itself uses, so what's listed is what's dealt
  function damageBreakdown() {
    const x = (v) => "×" + fmtMult(v);
    const plus = (v) => "+" + fmtMult(v);
    const sections = [];
    const flatRun = game.runAtkBonus || 0;
    const atkRows = [["基本", fmtMult(BASE_ATK)], ["基本強化", plus(treeBonus("atk"))], ["継承の力", plus(panelBonus("atk"))]];
    if (flatRun) atkRows.push(["このランの秘薬", plus(flatRun)]);
    atkRows.push(
      ["実績", plus(achievementBonus("atkPct")) + "%"],
      ["苦難の報酬", plus(trialRewardSum("atkPct")) + "%"],
      ["闘志の秘薬", plus(game.runAtkPctBonus || 0) + "%"],
      ["魂の鍛錬", x(treeExtProduct("atkMult"))],
    );
    if (trialRule("atkMult", 1) !== 1) atkRows.push(["苦難の制限", x(trialRule("atkMult", 1))]);
    sections.push({ title: "基礎攻撃力", total: fmt(currentAtk()), rows: atkRows, note: "カードの威力に足される" });

    const base = currentBaseMult() + game.buffBonus;
    sections.push({ title: "バフ", total: x(Math.max(MIN_BUFF_MULTIPLIER, base)), rows: [["基本", fmtMult(currentBaseMult())], ["貯まっているバフ", plus(game.buffBonus)]] });
    sections.push({
      title: "レベル倍率", total: x(levelDamageMult()),
      rows: trialRule("noLevel", false) ? [["苦難で無効", "×1"]] : [[`Lv.${save.level}`, `${Math.round(levelDamageMultPer() * 1000) / 1000} の ${save.level - 1} 乗`]],
    });
    const expRows = [["基本", "1"], ["基本強化", plus(treeBonus("exponent"))], ["継承の累乗", plus(panelBonus("exponent"))],
      ["魂の極致", plus(treeExtBonus("exponent"))], ["神威の書き換え", plus(panelSpecialOn("panelDmgFormula") ? 0.2 : 0)],
      ["苦難の報酬", plus(trialRewardSum("exponent"))], ["秘宝", plus(itemSum("exponent"))]];
    sections.push({ title: "累乗", total: fmtMult(currentExponent()), rows: expRows, note: "（バフ × レベル倍率）に掛かる" });
    sections.push({
      title: "最終倍率", total: x(finalDamageMult()),
      rows: [["闘気の枝", x(toukiMult())], ["魂の昇華", x(treeExtProduct("dmgMult"))], ["苦難の報酬", x(trialRewardProduct("dmgMult") / trialComboMult())],
        ["同時挑戦ボーナス", x(trialComboMult())], ["秘宝", x(itemProduct("dmgMult"))], ["超越の刻印", x(Math.pow(PANEL_MARK.step, markLevel()))]],
    });
    const critOff = trialRule("noCrit", false);
    sections.push({
      title: "会心", total: critOff ? "出ない" : `${fmtMult(critRate())}%で ${x(critMultiplier())}`,
      rows: [["会心率", fmtMult(critRate()) + "%"], ["会心ダメージ", plus(critDamageBonus()) + "%（基本150%に足す）"],
        ["魂の研磨", x(treeExtProduct("critMult"))], ["苦難の報酬", x(trialRewardProduct("critMult"))], ["秘宝", x(itemProduct("critMult"))],
        ["会心の暴走", panelSpecialOn("panelCritMultDouble") ? "×2" : "×1"]],
    });
    const enemy = enemyForFloor(game.floor);
    const sit = [];
    if (enemy.isBoss) sit.push(["ボス（巨人殺しの槌）", x(itemProduct("bossMult"))]);
    if (!game.firstHitDone) sit.push(["この階の最初の一撃（先駆けの角笛）", x(itemProduct("firstMult"))]);
    if (game.traits && game.traits.length) sit.push(["特性を持つ敵（破魔の護符）", x(itemProduct("traitMult"))]);
    (game.traits || []).map(traitDef).filter(Boolean).forEach((t) => sit.push([`特性「${t.name}」`, t.desc]));
    sections.push({ title: "その場の倍率", total: x(situationalItemMult()), rows: sit.length ? sit : [["なし", "×1"]] });
    return {
      formula: "ダメージ ＝（威力＋基礎攻撃力）×（バフ × レベル倍率）^累乗 × 最終倍率 × 会心 × その場の倍率",
      next: x(damageMultiplier().mul(situationalItemMult())),
      sections,
    };
  }
  function renderBreakdown() {
    if (!el.breakdownPanel.classList.contains("active") || !game) return;
    const b = damageBreakdown();
    el.breakdownBody.innerHTML = `<div class="bd-formula">${b.formula}</div><div class="bd-next">次の攻撃・特殊カードの倍率（威力＋基礎攻撃力に掛かる、会心を除く）：<b>${b.next}</b></div>`
      + b.sections.map((sec) => `<div class="bd-sec"><div class="bd-head"><span>${sec.title}</span><b>${sec.total}</b></div>`
        + sec.rows.map(([k, v]) => `<div class="bd-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`).join("")
        + (sec.note ? `<div class="bd-note">${sec.note}</div>` : "") + `</div>`).join("");
  }
  function toggleBreakdown(force) {
    const open = force != null ? force : !el.breakdownPanel.classList.contains("active");
    el.breakdownPanel.classList.toggle("active", open);
    if (open) renderBreakdown();
  }
  el.statBuff.parentElement.classList.add("bd-trigger");
  el.statBuff.parentElement.title = "押すと倍率の内訳";
  el.statBuff.parentElement.addEventListener("click", () => toggleBreakdown());
  el.breakdownClose.addEventListener("click", () => toggleBreakdown(false));
  el.breakdownPanel.addEventListener("click", (e) => { if (e.target === el.breakdownPanel) toggleBreakdown(false); });

  // ---------------- Auto-play (AUTO / 周回 / 速度) ----------------
  // AUTO picks and plays cards by itself, buys any 秘宝 it can afford (potions stay with 自動購入) and moves on
  // to the next floor once the merchant is done. 周回 (after the first final-boss kill) also retries from the
  // same checkpoint after a defeat and walks into endless mode after the boss. 速度 divides every battle
  // timing (card use, kill pause, remnant flurry, card flips, damage numbers): ×2 opens with the first final-boss
  // kill, ×4 with 500F cleared -- speed is a reward of progress, so AUTO alone doesn't shrink the early game.
  // It pauses while the tab is hidden: hidden time is already paid by the idle income.
  // AUTO at ×1 plays about one card per 0.6s (0.16s card animation + this gap), roughly a person's pace: at 0.3s it
  // ran ~5× faster than playing by hand and cut the time to the first clear to a fraction
  const AUTO_PLAY_GAP_MS = 440;
  const AUTO_NEXT_FLOOR_MS = 650; // how long the merchant screen stays up before AUTO moves on
  const AUTO_RETRY_MS = 1400; // 周回: the defeat/victory screen stays this long before going again
  const SPEED_4_FLOOR = 500;
  function autoSpeeds() {
    const list = [1];
    if (save.transcendUnlocked) list.push(2);
    if (stat("maxCleared") >= SPEED_4_FLOOR) list.push(4);
    return list;
  }
  function gameSpeed() {
    const sp = save.autoPlay && save.autoPlay.speed;
    return autoSpeeds().includes(sp) ? sp : 1;
  }
  function spd(ms) { return ms / gameSpeed(); }
  function autoLoopUnlocked() { return !!save.transcendUnlocked; }
  function autoLoopOn() { return save.autoPlay.on && save.autoPlay.loop && autoLoopUnlocked(); }
  function applyGameSpeed() { document.documentElement.style.setProperty("--spd", String(gameSpeed())); }

  // what a damage card deals right now on average (crit chance folded in), and its guaranteed (no-crit) part
  function autoCardDamage(card) {
    const mult = damageMultiplier().mul(situationalItemMult());
    let raw, rate, cm;
    if (card.type === "attack") {
      raw = attackBaseDamage(card);
      rate = Math.min(100, critRate() + (card.critRateBonus || 0) * trialRule("critRateMult", 1));
      cm = critMultiplier(card.critDmgBonus);
    } else {
      raw = specialCardRaw(card);
      rate = critRate();
      cm = critMultiplier();
    }
    if (trialRule("noCrit", false)) rate = 0;
    if (card.forceCrit) rate = 100;
    const base = mult.mul(raw);
    // 特性: 幻影 swallows the floor's first hit, 鉄壁 cuts non-crits, 硬化 caps every hit
    if (hasTrait("phantom") && !game.phantomUsed) return { sure: new Decimal(0), avg: new Decimal(0), raw: base };
    const p = rate / 100;
    const nonCrit = applyTraitsToHit(roundDamage(base), false);
    const crit = applyTraitsToHit(roundDamage(base.mul(cm)), true);
    return { sure: rate >= 100 ? crit : nonCrit, avg: nonCrit.mul(1 - p).add(crit.mul(p)), raw: base };
  }
  function autoBuffValue(card) {
    const vals = card.randomValues ? card.randomValues : [effectiveValue(card)];
    return vals.reduce((a, v) => a + buffApplied(v), 0) / vals.length;
  }
  // 1) 幻影: throw the weakest damage card at it first (before any buff is stored for nothing)
  // 2) a damage card that surely kills now  3) 処刑の火 (never wastes a stored buff)  4) poison while there are moves
  // left for it to tick  5) buffs while a damage card is in hand and a move remains for it -- unless 硬化 caps the hit
  // anyway  6) otherwise the damage card with the best average. Under 鏡面, 処刑の火/猛毒 only when nothing else is left
  function chooseAutoCard() {
    const hand = game.hand.filter((c) => !c.playing && !(c.type === "percent" && game.percentUsed));
    if (!hand.length) return null;
    const dmgCards = hand.filter((c) => c.type === "attack" || c.type === "special")
      .map((c) => Object.assign({ card: c }, autoCardDamage(c)))
      .sort((a, b) => (b.avg.gt(a.avg) ? 1 : b.avg.lt(a.avg) ? -1 : 0));
    if (hasTrait("phantom") && !game.phantomUsed && dmgCards.length) {
      return dmgCards.slice().sort((a, b) => (a.raw.lt(b.raw) ? -1 : a.raw.gt(b.raw) ? 1 : 0))[0].card;
    }
    const killer = dmgCards.filter((d) => d.sure.gte(game.enemyHp)).sort((a, b) => (a.sure.lt(b.sure) ? -1 : 1))[0];
    if (killer) return killer.card;
    const mirror = hasTrait("mirror");
    const pct = !mirror && hand.find((c) => c.type === "percent");
    if (pct) return pct;
    const poison = !mirror && hand.find((c) => c.type === "poison");
    if (poison && !game.enemyPoisoned && game.n >= 3) return poison;
    const capped = hasTrait("harden") && dmgCards.length && dmgCards[0].sure.gte(game.enemyHpMax.mul(TRAIT_HIT_CAP).ceil());
    const buffs = hand.filter((c) => c.type === "buff" && autoBuffValue(c) > 1).sort((a, b) => autoBuffValue(b) - autoBuffValue(a));
    if (buffs.length && dmgCards.length && game.n >= 2 && !capped) return buffs[0];
    if (dmgCards.length) return dmgCards[0].card;
    const chain = hand.find((c) => c.type === "chain");
    return chain || hand.find((c) => c.type !== "buff" && c.type !== "poison" && c.type !== "percent") || hand.find((c) => c.type !== "buff") || hand[0];
  }

  let autoTimer = null;
  let autoWait = { screen: "", until: 0 };
  function scheduleAuto(ms) {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(autoStep, Math.max(16, ms));
  }
  function activeScreenName() {
    const active = document.querySelector(".screen.active");
    return active ? active.id.replace("screen-", "") : "";
  }
  // true once the current screen has been up for `ms` (the clock restarts whenever the screen changes)
  function autoWaited(screen, ms) {
    const now = performance.now();
    if (autoWait.screen !== screen) autoWait = { screen, until: now + ms };
    return now >= autoWait.until;
  }
  function autoStep() {
    autoTimer = null;
    if (!save.autoPlay.on) return;
    if (document.visibilityState === "hidden" || el.confirmOverlay.classList.contains("active")) { scheduleAuto(400); return; }
    const screen = activeScreenName();
    if (screen === "battle" && game && !game.gameOver) {
      autoWait = { screen: "battle", until: 0 };
      if (game.followUpBusy || performance.now() < game.inputReadyAt || game.hand.some((c) => c.playing)) { scheduleAuto(30); return; }
      const card = chooseAutoCard();
      if (card) { card.byAuto = true; playCard(card.uid); }
      scheduleAuto(spd(CARD_PLAY_ANIM_MS + AUTO_PLAY_GAP_MS));
      return;
    }
    if (screen === "floorClear" && game && game.shopOffers) {
      (game.itemOffers || []).forEach((o) => { if (!o.bought && game.gold >= o.cost && buyItemOffer(o)) renderShop(); });
      if (autoBuyRunning) { autoWait = { screen: "", until: 0 }; renderAutoNotes(); scheduleAuto(60); return; }
      renderAutoNotes();
      if (autoWaited("floorClear", spd(AUTO_NEXT_FLOOR_MS))) goNextFloor();
      scheduleAuto(40);
      return;
    }
    if (screen === "defeat" && autoLoopOn()) {
      if (autoWaited("defeat", spd(AUTO_RETRY_MS))) retryRun();
      scheduleAuto(60);
      return;
    }
    if (screen === "finalVictory" && autoLoopOn() && game) {
      if (autoWaited("finalVictory", spd(AUTO_RETRY_MS))) el.enterEndlessBtn.click();
      scheduleAuto(60);
      return;
    }
    autoWait = { screen: "", until: 0 };
    scheduleAuto(300); // title, tree, … : AUTO stays armed and picks up again in the next battle
  }
  function renderAutoControls() {
    applyGameSpeed(); // a saved ×4 starts counting the moment 500F is cleared
    el.autoPlayBtn.classList.toggle("on", !!save.autoPlay.on);
    el.autoLoopBtn.style.display = autoLoopUnlocked() ? "" : "none";
    el.autoLoopBtn.classList.toggle("on", autoLoopOn());
    el.speedBtn.firstChild.textContent = "×" + gameSpeed();
    el.speedBtn.classList.toggle("on", gameSpeed() > 1);
    const next = autoSpeeds().includes(4) ? "" : autoSpeeds().includes(2) ? "（×4は500階クリアで解放）" : "（×2はラスボス初撃破、×4は500階クリアで解放）";
    el.speedBtn.title = "戦闘の演出の速さ [S]" + next;
    renderAutoNotes();
  }
  function renderAutoNotes() {
    const on = save.autoPlay.on;
    const stop = `<button class="btn ghost" data-auto-stop>止める</button>`;
    el.floorClearAutoNote.style.display = on ? "" : "none";
    el.floorClearAutoNote.innerHTML = on ? `AUTO：${autoBuyRunning ? "自動購入が終わったら" : "まもなく"}次の階へ進む${stop}` : "";
    const loop = autoLoopOn();
    el.defeatAutoNote.style.display = loop ? "" : "none";
    el.defeatAutoNote.innerHTML = loop ? `周回：まもなく同じ階から再挑戦する${stop}` : "";
    el.victoryAutoNote.style.display = loop ? "" : "none";
    el.victoryAutoNote.innerHTML = loop ? `周回：まもなくエンドレスへ進む${stop}` : "";
  }
  function setAutoPlay(on) {
    save.autoPlay.on = on;
    track("auto", { on, loop: save.autoPlay.loop, speed: gameSpeed() });
    persistSave();
    renderAutoControls();
    if (on) scheduleAuto(spd(AUTO_PLAY_GAP_MS));
    else { clearTimeout(autoTimer); autoTimer = null; }
    showToast(on ? "AUTO：カードを自動で使い、商人の後は自動で次の階へ進む" : "AUTOを止めた");
  }
  function toggleAutoLoop() {
    if (!autoLoopUnlocked()) return;
    save.autoPlay.loop = !save.autoPlay.loop;
    if (save.autoPlay.loop) save.autoPlay.on = true;
    persistSave();
    renderAutoControls();
    if (save.autoPlay.on) scheduleAuto(60);
    showToast(save.autoPlay.loop ? "周回：負けても同じ階から自動で再挑戦し、ラスボスの後はエンドレスへ進む" : "周回を止めた（AUTOは続く）");
  }
  function cycleSpeed() {
    const list = autoSpeeds();
    if (list.length === 1) { showToast("速度×2はラスボスを初めて倒すと、×4は500階をクリアすると使える"); return; }
    save.autoPlay.speed = list[(list.indexOf(gameSpeed()) + 1) % list.length];
    persistSave();
    applyGameSpeed();
    renderAutoControls();
  }
  el.autoPlayBtn.addEventListener("click", () => setAutoPlay(!save.autoPlay.on));
  el.autoLoopBtn.addEventListener("click", toggleAutoLoop);
  el.speedBtn.addEventListener("click", cycleSpeed);
  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("[data-auto-stop]")) setAutoPlay(false);
  });

