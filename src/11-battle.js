// src/11-battle.js — part of game.js (battle logic, floor results, reincarnation). Edit here, then run: node tools/build.js
  // ---------------- Battle logic ----------------
  // shared between resolveCardEffect's "special" branch and the hand-display preview label, so
  // what a card promises in your hand is exactly what it deals when played
  function specialCardRaw(card) {
    // 渾身の一撃: atk × remaining moves -- strongest when played early. Moves no longer grow past
    // BASE_N, so the old "damage = moves left" (at most 5) had become useless.
    const atk = new Decimal(currentAtk());
    if (card.calc === "n") return atk.mul(game.n);
    if (card.calc === "critStreak") return atk.mul(Math.max(1, game.critStreak)); // scales with consecutive crits landed so far
    if (card.calc === "pow1_5") return atk.pow(1.5); // superlinear late-game scaling
    return atk.mul(atk); // "atk2" (legacy default)
  }

  function attackBaseDamage(card) {
    return effectiveValue(card) + currentAtk();
  }

  // additive stacking can push (baseMult + Σ buff bonus) to zero or below (e.g. two ×0.5 gamble
  // misses in a row); floor it so the next attack still deals a sliver instead of 0 / negative damage
  const MIN_BUFF_MULTIPLIER = 0.1;

  // 秘宝 that only count at certain moments: boss floors (巨人殺しの槌) and the first attack/special card
  // played on a floor (先駆けの角笛). 処刑の火 and poison never get them (a % of max HP must stay a %)
  function situationalItemMult() {
    let m = 1;
    if (enemyForFloor(game.floor).isBoss) m *= itemProduct("bossMult");
    if (!game.firstHitDone) m *= itemProduct("firstMult");
    if (game.traits && game.traits.length) m *= itemProduct("traitMult");
    return m;
  }

  // player card hits (not poison/remnants) become lastHit, which the remnants' follow-ups scale from
  function hitEnemy(dmg, isPlayerCard) {
    game.enemyHp = Decimal.max(0, game.enemyHp.sub(dmg));
    recordHit(dmg);
    if (isPlayerCard !== false) game.lastHit = dmg;
  }
  function noteCrit(isCrit) {
    game.critStreak = isCrit ? game.critStreak + 1 : 0;
    game.runCritStreak = isCrit ? game.runCritStreak + 1 : 0;
    maxStat("maxCritStreak", game.runCritStreak);
  }

  // Resolves a single card's effect (damage/draw/buff/chain). Does not touch hand/deck/n bookkeeping,
  // so it can be reused both for a directly-played card and for cards triggered by a chain card.
  function resolveCardEffect(card) {
    if (card.type === "attack") {
      const mult = damageMultiplier();
      const isCrit = card.forceCrit || rollCrit(card.critRateBonus);
      const critMult = isCrit ? critMultiplier(card.critDmgBonus) : 1;
      const phantom = hasTrait("phantom") && !game.phantomUsed;
      const dmg = phantom ? new Decimal(0) : applyTraitsToHit(roundDamage(mult.mul(attackBaseDamage(card)).mul(critMult).mul(situationalItemMult())), isCrit);
      game.phantomUsed = true;
      game.firstHitDone = true;
      if (phantom) addLog("幻影をすり抜けた…（この階の最初の一撃は外れる）", "info");
      hitEnemy(dmg);
      noteCrit(isCrit);
      const multNote = !mult.eq(1) ? `（倍率×${fmtMult(mult)}）` : "";
      if (isCrit) addLog(`${card.name} で会心の一撃！ ${fmt(dmg)} ダメージ！${multNote}`, "dmg crit");
      else addLog(`${card.name} で ${fmt(dmg)} ダメージ！${multNote}`, "dmg");
      floatDamage(dmg, isCrit);
      game.buffBonus = 0;
    } else if (card.type === "percent") {
      // percent damage ignores buffs AND crits, and leaves any stored buff in place for the next
      // attack: a buffed or critting "% of max HP" hit (30% × crit ≈ 440%) one-shot any floor however
      // far enemy HP has scaled, which skips the whole point of an incremental HP curve. It neither
      // extends nor breaks a crit streak.
      const pct = effectiveValue(card);
      game.percentUsed = true;
      if (hasTrait("mirror")) { addLog(`${card.name}：鏡面に弾かれた（この敵には効かない）`, "info"); return; }
      const dmg = roundDamage(game.enemyHpMax.mul(pct));
      hitEnemy(dmg, false); // not a lastHit: remnants following up a % of max HP one-shot every floor
      addLog(`${card.name}：敵の最大HPの${Math.round(pct * 100)}%、${fmt(dmg)} ダメージ！`, "percent");
      floatDamage(dmg, false);
    } else if (card.type === "draw") {
      const count = effectiveValue(card);
      addLog(`${card.name}：カードを${count}枚引いた`, "info");
      for (let i = 0; i < count; i++) drawOne();
    } else if (card.type === "buff") {
      // most buff cards apply a fixed multiplier, but a card can instead carry a randomValues
      // list (e.g. a 50/50 gamble) to pick from each time it's played; panelBonus("buffAdd")
      // (継承の闘気) adds a permanent flat bonus on top of whatever this specific card rolls
      const cardMult = card.randomValues ? card.randomValues[Math.floor(Math.random() * card.randomValues.length)] : effectiveValue(card);
      const appliedMult = buffApplied(cardMult);
      // buffs stack additively on their bonus part (see damageMultiplier()), so ×2 then ×3 adds +3
      // (not ×6), and a gamble's ×0.5 miss really subtracts -- floored so repeated misses can't dig
      // a hole that later buffs first have to climb out of
      game.buffBonus = Math.max(MIN_BUFF_MULTIPLIER - currentBaseMult(), game.buffBonus + (appliedMult - 1));
      addLog(`${card.name}：次の攻撃カードの倍率が×${fmtMult(damageMultiplier())}に！`, "buff");
    } else if (card.type === "poison") {
      // a status flag, not a stacking counter: playing this again while already poisoned does nothing extra
      if (hasTrait("mirror")) {
        addLog(`${card.name}：鏡面に弾かれた（この敵には効かない）`, "info");
      } else if (game.enemyPoisoned) {
        addLog(`${card.name}：敵は既に毒状態だ（効果は重複しない）`, "info");
      } else {
        game.enemyPoisoned = true;
        addLog(`${card.name}：敵を猛毒状態にした！`, "buff");
      }
    } else if (card.type === "special") {
      const mult = damageMultiplier();
      const isCrit = rollCrit();
      const critMult = isCrit ? critMultiplier() : 1;
      const raw = specialCardRaw(card);
      const phantom = hasTrait("phantom") && !game.phantomUsed;
      const dmg = phantom ? new Decimal(0) : applyTraitsToHit(roundDamage(mult.mul(raw).mul(critMult).mul(situationalItemMult())), isCrit);
      game.phantomUsed = true;
      game.firstHitDone = true;
      if (phantom) addLog("幻影をすり抜けた…（この階の最初の一撃は外れる）", "info");
      hitEnemy(dmg);
      noteCrit(isCrit);
      const multNote = !mult.eq(1) ? `（倍率×${fmtMult(mult)}）` : "";
      if (isCrit) addLog(`${card.name} で会心の一撃！ ${fmt(dmg)} ダメージ！${multNote}`, "dmg crit");
      else addLog(`${card.name} で ${fmt(dmg)} ダメージ！${multNote}`, "dmg");
      floatDamage(dmg, isCrit);
      game.buffBonus = 0;
    } else if (card.type === "chain") {
      // trigger every hand card sharing the target tag (excluding other chain cards, to prevent chain-of-chain loops)
      const matches = game.hand.filter((c) => c.type !== "chain" && Array.isArray(c.tags) && c.tags.includes(card.targetTag));
      const tagLabel = TAG_LABELS[card.targetTag] || card.targetTag;
      addLog(`${card.name}：『${tagLabel}』タグのカードを${matches.length}枚連鎖使用！`, "buff");
      matches.forEach((m) => {
        const idx = game.hand.findIndex((h) => h.uid === m.uid);
        if (idx === -1) return; // already consumed by an earlier chain this same trigger
        game.hand.splice(idx, 1);
        resolveCardEffect(m);
        returnCardAfterPlay(m);
        // each chained card is still "consumed 1 -> draw 1", same as a normal play; flag the
        // replacement so it enters the hand face-down and flips, same as a direct play
        const drawn = drawOne();
        if (drawn) drawn.justDrawn = true;
      });
    }
  }

  // draw cards are spent, not cycled: once played they vanish from the deck for the rest of
  // this floor (the deck rebuilds from scratch, draw cards included, at the start of the next).
  // every other card returns to the bottom of the deck as usual.
  function returnCardAfterPlay(card) {
    if (card.type !== "draw") game.deck.push(card);
  }

  // tempo first (same as the festival build); each must match its animation in style.css
  const CARD_PLAY_ANIM_MS = 160; // .card.playing / cardPlayFx
  const FLIP_SLIDE_MS = 180; // hand reflow: cards sliding left + the new card flying in from the deck pile
  const CARD_FLIP_DELAY_MS = 180; // how long a newly drawn card stays face-down before it flips to reveal itself
  const KILL_PAUSE_MS = 420; // the killing blow's number and the defeat effect play out before the screen changes
  const INPUT_GUARD_MS = 300; // a fresh floor ignores clicks/keys this long, so a held key can't fire into it
  const POISON_DAMAGE_PCT = 0.05; // 5% of max HP per player move while poisoned; doesn't stack

  // ticks once per player move (not per chain-triggered sub-card) while the enemy is poisoned
  function applyPoisonTick() {
    if (!game.enemyPoisoned || game.enemyHp.lte(0)) return;
    const dmg = roundDamage(game.enemyHpMax.mul(POISON_DAMAGE_PCT));
    game.enemyHp = Decimal.max(0, game.enemyHp.sub(dmg));
    addLog(`毒の傷が疼く…${fmt(dmg)} ダメージ`, "dmg");
    floatDamage(dmg, false);
  }

  // playing a card is a two-stage sequence: first a quick "used" effect plays on the card in
  // place (see .card.playing), and only once that finishes does the card actually resolve,
  // get replaced, and the replacement enter the hand face-down (see renderBattle's flip-in).
  function playCard(uid) {
    if (!game || game.gameOver || game.followUpBusy || performance.now() < game.inputReadyAt) return;
    const card = game.hand.find((c) => c.uid === uid);
    if (!card || card.playing) return;
    if (card.type === "percent" && game.percentUsed) return;
    const thisGame = game;
    card.playing = true;
    renderBattle();

    setTimeout(() => {
      card.playing = false;
      if (game !== thisGame || game.gameOver) return; // the floor ended/changed while this was animating
      const idx = game.hand.findIndex((c) => c.uid === uid);
      if (idx === -1) return;
      game.hand.splice(idx, 1);
      game.cardsPlayed += 1;
      if (card.byAuto) game.autoCardsPlayed += 1;
      bumpStat("cardsPlayed");

      resolveCardEffect(card);
      applyPoisonTick();

      returnCardAfterPlay(card);
      const drawn = drawOne(); // consumed 1 card -> always draw exactly 1 replacement
      if (drawn) drawn.justDrawn = true;
      game.n -= 1;

      renderBattle();
      // remnants follow up after every attack/special card (not 処刑の火); the win/lose check waits until their
      // flurry is over (a remnant may land the kill), and no card can be played meanwhile
      if ((card.type === "attack" || card.type === "special") && game.remnants.length && game.enemyHp.gt(0)) {
        game.followUpBusy = true;
        // finally, not then: an exception mid-flurry used to leave followUpBusy set and the battle frozen
        runRemnantFollowUps(thisGame, game.lastHit || 0)
          .catch((e) => console.error("[remnant follow-up]", e))
          .finally(() => {
            if (game !== thisGame) return;
            game.followUpBusy = false;
            checkAchievements();
            if (!game.gameOver) checkResult();
          });
      } else {
        checkAchievements();
        checkResult();
      }
    }, spd(CARD_PLAY_ANIM_MS));
  }

  function enemyHpPct() { return Math.max(0, game.enemyHp.div(game.enemyHpMax).toNumber() * 100); }
  function updateEnemyHpDisplay() {
    el.enemyHpNow.textContent = fmt(game.enemyHp);
    el.enemyBar.style.width = enemyHpPct() + "%";
    el.enemyHpUnit.textContent = game.enemyHpMax.gte(1e4) ? `（最大HP ${jpUnitText(game.enemyHpMax)}）` : "";
  }

  // a hand with nothing usable (only 処刑の火 already spent this floor) used to freeze the floor with moves left
  function hasPlayableCard() { return game.hand.some((c) => !(c.type === "percent" && game.percentUsed)); }
  function checkResult() {
    if (game.enemyHp.lte(0)) { onFloorWin(); return; }
    if (game.n <= 0) { onFloorLoss("defeat"); return; }
    if (hasTrait("regen") && game.enemyHp.lt(game.enemyHpMax)) {
      const heal = Decimal.min(game.enemyHpMax.sub(game.enemyHp), game.enemyHpMax.mul(TRAIT_REGEN).ceil());
      game.enemyHp = game.enemyHp.add(heal);
      addLog(`再生：敵のHPが ${fmt(heal)} 回復した`, "info");
      updateEnemyHpDisplay();
    }
    if (!hasPlayableCard()) { addLog("打つ手がない…", "dmg"); onFloorLoss("stuck"); }
  }

  // points earned = sum of the floor numbers of every monster actually defeated this run
  // (not a count-based formula), so challenging a higher checkpoint is worth what it should be:
  // e.g. starting at floor91 and clearing 3 floors yields 91+92+93 pts, not the same tiny amount
  // a floor1-3 clear would give.
  function awardRunEndPoints() {
    const gained = grantSouls(game.floorPointsSum);
    save.bestFloor = Math.max(save.bestFloor, game.floor);
    persistSave();
    return gained;
  }

  function onFloorWin() {
    game.gameOver = true;
    const thisGame = game;
    el.enemyVisual.classList.add("defeated");
    addLog(`敵を撃破した！`, "info");
    const enemyNow = enemyForFloor(game.floor);
    const traitCount = (game.traits || []).length;
    // 特性 ×1.5 souls (×2 with two), 守護者 ×3 -- floorPointsSum is paid out as souls when the run ends
    game.floorPointsSum += game.floor * (enemyNow.isGuardian ? GUARDIAN_SOUL_MULT : 1 + 0.5 * traitCount);
    if (traitCount) bumpStat("traitKills");
    if (enemyNow.isGuardian) { bumpStat("guardianKills"); game.guaranteedItem = true; }
    game.floorsCleared += 1;
    if (game.floor > stat("maxCleared") && (game.floor <= FINAL_FLOOR ? game.floor % 10 === 0 : game.floor % 100 === 0)) {
      track("milestone", { floor: game.floor, playMin: playMinutes(), lv: save.level, reinc: stat("reincarnations") });
    }
    if (game.floor === FINAL_FLOOR && !stat("bossKills")) track("first_clear", { playMin: playMinutes(), runs: stat("runs"), lv: save.level });
    save.bestClearedFloor = Math.max(save.bestClearedFloor, game.floor);
    bumpStat("kills");
    if (game.n === 0) bumpStat("lastMoveWins");
    if (game.floor === FINAL_FLOOR && game.floorStartN - game.n === 1) bumpStat("bossOneShot");
    maxStat("maxCleared", game.floor);
    if (game.floor === FINAL_FLOOR) bumpStat("bossKills");
    // transcend points no longer come from endless floors: they're paid out on reincarnation from
    // the level reached (see reincarnateNow), and every kill feeds that level
    const levelBefore = save.level;
    // exp follows the enemy's HP -- but not a 苦難's HP multiplier: 堅牢★★★'s ×1万 used to hand out ×1万 exp too,
    // so the climb paid for itself (Lv131 instead of Lv77 at the boss) and the 苦難 barely cost anything
    const levelsGained = gainExp(game.enemyHpMax.div(trialHpMultForFloor(game.floor)).mul(EXP_PER_ENEMY_HP));
    if (levelsGained) addLog(`レベルアップ！ Lv.${save.level}`, "levelup");
    checkAchievements();

    el.trialClearNote.textContent = "";
    if (game.floor === FINAL_FLOOR && save.activeTrials.length) completeTrial();

    if (game.floor === FINAL_FLOOR && !game.endlessMode) {
      // first time reaching the final boss this run: offer the endless-mode choice.
      // reaching this at all permanently unlocks the reincarnation panel for future titles.
      const gained = awardRunEndPoints();
      // already banked: without this, entering endless mode and later losing/retreating would
      // pay floors 1-100 out a second time through the same running sum
      game.floorPointsSum = 0;
      save.transcendUnlocked = true;
      persistSave();
      el.victoryPoints.textContent = fmt(gained);
      setTimeout(() => { if (game === thisGame) showScreen("finalVictory"); }, spd(KILL_PAUSE_MS));
    } else {
      save.bestFloor = Math.max(save.bestFloor, game.floor);
      persistSave();
      const goldGain = Math.ceil((10 + game.floor * 3) * goldMultiplier() * (hasTrait("frenzy") ? 2 : 1) - 1e-9);
      game.gold += goldGain;
      setTimeout(() => { if (game === thisGame) openFloorClear(goldGain, levelBefore, levelsGained); }, spd(KILL_PAUSE_MS));
    }
  }

  // the seal lifts the moment the boss falls, so the rest of the run (endless included) is at full power
  function releaseHeldPoints() {
    save.points += save.trialHeldPoints || 0;
    save.trialHeldPoints = 0;
  }
  function completeTrial() {
    const defs = activeTrialDefs();
    if (defs.length) track("trial", { op: "clear", ids: defs.map((t) => t.id), playMin: playMinutes() });
    save.activeTrials = [];
    releaseHeldPoints();
    if (!defs.length) return;
    const fresh = defs.filter((t) => !save.trialsCleared[t.id]);
    defs.forEach((t) => { save.trialsCleared[t.id] = true; });
    const lines = [`苦難（${defs.map((t) => t.name).join("・")}）を乗り越えた！`];
    if (fresh.length) lines.push("永続報酬：" + fresh.map((t) => t.rewardText).join("／"));
    else lines.push("（報酬は獲得済み）");
    if (defs.length >= 2 && defs.length > (save.trialComboBest || 0)) {
      const from = (save.trialComboBest || 1) + 1;
      save.trialComboBest = defs.length;
      lines.push(`同時挑戦ボーナス：全ダメージ ×${fmtMult(Math.pow(TRIAL_COMBO_STEP, defs.length - from + 1))}`);
    }
    checkAchievements();
    const text = lines.join(" ");
    addLog(text, "levelup");
    showToast(text);
    el.trialClearNote.textContent = text;
  }

  function onFloorLoss(cause) {
    game.gameOver = true;
    trackRunEnd(cause || "defeat");
    addLog(`手数が尽きた。塔から追い出される…`, "dmg");
    const gained = awardRunEndPoints(); // the floor they died on was never added to floorPointsSum
    el.defeatFloor.textContent = game.floor;
    el.defeatPoints.textContent = fmt(gained);
    prepareRetry(gained);
    const thisGame = game;
    setTimeout(() => { if (game === thisGame) showScreen("defeat"); }, spd(KILL_PAUSE_MS));
  }

  function onRetreat() {
    game.gameOver = true;
    trackRunEnd("retreat");
    const gained = awardRunEndPoints(); // the current floor's monster was already added when it was cleared
    el.retreatFloor.textContent = game.floor;
    el.retreatPoints.textContent = fmt(gained);
    prepareRetry(gained);
    showScreen("retreat");
  }

  // 「すぐにもう一度挑む」: the same checkpoint again, or one checkpoint lower if that run cleared
  // nothing at all (no souls, no exp: retrying the same spot would just repeat the loss)
  let retryFloor = 1;
  function prepareRetry(gained) {
    const start = game.startFloor || 1;
    const options = FLOOR_CHECKPOINTS.filter((f) => f !== FINAL_FLOOR).concat(endlessCheckpointsAll());
    const lower = options.filter((f) => f < start);
    retryFloor = gained > 0 || !lower.length ? start : lower[lower.length - 1];
    const label = `すぐにもう一度挑む（${retryFloor}階から）`;
    el.defeatRetryBtn.textContent = label;
    el.retreatRetryBtn.textContent = label;
    const affordable = NODES.filter((n) => nodeState(n) === "available").length;
    const hint = affordable ? `いま習得できる基本強化が${affordable}個ある！` : "";
    el.defeatHint.textContent = hint;
    el.retreatHint.textContent = hint;
  }
  function retryRun() { game = null; newRun(retryFloor); }
  function runEndToTree() { game = null; openScreen("tree"); }
  el.defeatRetryBtn.addEventListener("click", retryRun);
  el.retreatRetryBtn.addEventListener("click", retryRun);
  el.defeatTreeBtn.addEventListener("click", runEndToTree);
  el.retreatTreeBtn.addEventListener("click", runEndToTree);

  // reincarnation pays out transcend points from the level reached, then resets the run-to-run
  // progress (souls, basic tree, deck, level) and drops the player into the panel. The panel,
  // transcend points, achievements and everything remnant-related survive.
  function reincarnateNow() {
    const gainedTp = transcendGainForLevel(save.level);
    track("reincarnate", { lv: save.level, tp: gainedTp, reinc: stat("reincarnations") + 1, best: stat("maxCleared"), playMin: playMinutes() });
    save.transcendPoints += gainedTp;
    save.activeTrials = []; // unfinished 苦難 end with the loop
    save.trialHeldPoints = 0;
    save.trialPending = true; // leaving the panel offers the 苦難 screen (if any are unlocked)
    save.level = 1;
    save.exp = new Decimal(0);
    bumpStat("reincarnations");
    checkAchievements();
    save.points = panelBonus("startPoints");
    save.unlockedNodes = {};
    save.treeExt = {};
    save.items = {};
    save.itemAwaken = {};
    save.deckDefs = cloneDeckDefs(BASE_DECK_DEFS);
    save.cardShopPurchases = {}; // the bought copies were just wiped from the deck, so their price climb goes too
    save.bestFloor = 0;
    save.bestClearedFloor = 0;
    persistSave();
    game = null;
    openPanel(false);
    cloudUpload({ force: true });
  }

  el.defeatToHomeBtn.addEventListener("click", () => { game = null; showScreen("home"); renderHome(); });
  el.victoryToHomeBtn.addEventListener("click", () => { game = null; showScreen("home"); renderHome(); });
  el.retreatToHomeBtn.addEventListener("click", () => { game = null; showScreen("home"); renderHome(); });
  el.enterEndlessBtn.addEventListener("click", () => {
    game.endlessMode = true;
    startFloor(FINAL_FLOOR + 1);
  });

