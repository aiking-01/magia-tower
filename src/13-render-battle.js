// src/13-render-battle.js — part of game.js (battle screen rendering). Edit here, then run: node tools/build.js
  // ---------------- Render: battle ----------------
  // tapping a 特性 badge explains it (the title tooltip doesn't exist on touch screens)
  el.enemyTraits.addEventListener("click", (e) => {
    const b = e.target.closest ? e.target.closest("[data-trait]") : null;
    const t = b && traitDef(b.dataset.trait);
    if (t) showToast(`特性「${t.name}」：${t.desc}`);
  });
  function renderBattle() {
    const enemy = enemyForFloor(game.floor);
    el.floorLabel.textContent = (game.floor > FINAL_FLOOR ? `階層 ${game.floor}（エンドレス）` : `階層 ${game.floor} / ${FINAL_FLOOR}`) + `　Lv.${save.level}`
      + (trialSealed() ? `　苦難：${activeTrialDefs().length > 1 ? activeTrialDefs().length + "つ同時" : activeTrialDefs()[0].name}` : "");
    el.enemyName.textContent = enemy.name;
    el.enemyName.classList.toggle("boss", enemy.isBoss);
    el.enemyBar.classList.toggle("boss", enemy.isBoss);
    el.enemyVisual.classList.toggle("boss", enemy.isBoss);
    // regular floors show the dungeon backdrop; boss floors keep a plain black one for a more dramatic look
    el.enemyVisual.classList.toggle("has-backdrop", !enemy.isBoss);
    el.enemyVisual.classList.toggle("boss-bg", enemy.isBoss);
    if (el.enemyVisual.dataset.art !== enemy.art) {
      el.enemyVisual.dataset.art = enemy.art;
      el.enemyVisual.innerHTML = `<img src="${enemy.art}" alt="${enemy.name}">`;
    }
    // 特性 / 守護者: a recolor of the art (the first 特性's, or the guardian's own) and a steady aura in its color
    const traits = (game.traits || []).map(traitDef).filter(Boolean);
    const look = enemy.isGuardian ? { filter: enemy.filter, color: traits[0] ? traits[0].color : "#ff8adf" } : traits[0];
    el.enemyVisual.classList.toggle("has-trait", !!look);
    el.enemyVisual.classList.toggle("guardian", !!enemy.isGuardian);
    el.enemyVisual.style.setProperty("--trait-filter", look ? look.filter : "none");
    el.enemyVisual.style.setProperty("--trait-color", look ? look.color : "transparent");
    const traitKey = (enemy.isGuardian ? "G" : "") + traits.map((t) => t.id).join(",");
    if (el.enemyTraits.dataset.key !== traitKey) {
      el.enemyTraits.dataset.key = traitKey;
      el.enemyTraits.innerHTML = (enemy.isGuardian ? `<span class="trait-badge guardian-badge">守護者</span>` : "")
        + traits.map((t) => `<button class="trait-badge" style="--trait-color:${t.color}" data-trait="${t.id}" title="${t.desc}">${t.name}</button>`).join("");
    }
    el.enemyHpNow.textContent = fmt(game.enemyHp);
    el.enemyHpMax.textContent = fmt(game.enemyHpMax);
    el.enemyBar.style.width = enemyHpPct() + "%";
    el.enemyHpUnit.textContent = game.enemyHpMax.gte(1e4) ? `（最大HP ${jpUnitText(game.enemyHpMax)}）` : "";
    el.statN.textContent = game.n;
    el.statAtk.textContent = fmt(currentAtk());
    // the full multiplier the next attack/special will get, so base multiplier / exponent progress is
    // visible even with no buff stored; highlighted only while a buff (or a gamble's miss) is pending
    el.statBuff.textContent = "×" + fmtMult(damageMultiplier());
    el.statBuff.classList.toggle("buff-active", game.buffBonus !== 0);
    el.deckCount.textContent = game.deck.length;
    el.deckPileCount.textContent = game.deck.length;
    el.handCount.textContent = game.hand.length + "枚";
    el.battleGold.textContent = fmt(game.gold);
    renderAutoControls();
    renderBreakdown();

    // FLIP technique: record where every current card (and the deck pile) sits before the
    // rebuild, so cards can visibly slide from their old spot to their new one afterward
    // instead of just jumping there.
    const prevRects = new Map();
    el.hand.querySelectorAll("[data-uid]").forEach((node) => {
      prevRects.set(node.dataset.uid, node.getBoundingClientRect());
    });
    const prevDeckRect = el.deckPile.getBoundingClientRect();

    el.hand.innerHTML = "";
    const toFlip = [];
    const newUids = [];
    game.hand.forEach((card, handIndex) => {
      const spent = card.type === "percent" && game.percentUsed;
      const cardClass = "card " + card.type + (card.playing ? " playing" : "") + (spent ? " spent" : "");
      let typeLabel = TYPE_LABELS[card.type] || "バフ";
      let valueLabel;
      // previews show the no-crit hit after this enemy's 特性 (鉄壁/硬化), and say so when 幻影 will swallow it
      const phantomNext = hasTrait("phantom") && !game.phantomUsed;
      if (phantomNext && (card.type === "attack" || card.type === "special")) valueLabel = "幻影で外れる";
      else if (card.type === "attack") valueLabel = fmt(applyTraitsToHit(roundDamage(unbuffedDamageMultiplier().mul(attackBaseDamage(card)).mul(situationalItemMult())), false)) + " dmg";
      else if (card.type === "draw") valueLabel = "+" + effectiveValue(card) + "枚";
      else if (card.type === "percent") valueLabel = spent ? "この階は使用済み" : hasTrait("mirror") ? "鏡面で無効" : Math.round(effectiveValue(card) * 100) + "%";
      else if (card.type === "special") valueLabel = fmt(applyTraitsToHit(roundDamage(unbuffedDamageMultiplier().mul(specialCardRaw(card)).mul(situationalItemMult())), false)) + " dmg";
      else if (card.type === "poison") valueLabel = "猛毒付与";
      else if (card.type === "chain") {
        const count = game.hand.filter((c) => c.uid !== card.uid && c.type !== "chain" && Array.isArray(c.tags) && c.tags.includes(card.targetTag)).length;
        valueLabel = count + "枚連鎖";
      } else if (card.randomValues) valueLabel = card.randomValues.map((v) => "×" + fmtMult(buffApplied(v))).join(" / ");
      else valueLabel = "×" + fmtMult(buffApplied(effectiveValue(card)));
      // always render both slots (even empty) so a card's name/value line lands in the same
      // spot regardless of whether this particular card happens to have a rank or crit note
      const rankBadge = `<div class="card-rank">${card.rank ? "Lv." + card.rank : ""}</div>`;
      const critNote = `<div class="card-crit-note">${(card.critRateBonus || card.critDmgBonus) ? `会心+${card.critRateBonus || 0}%/ダメ+${card.critDmgBonus || 0}%` : ""}</div>`;
      const keyBadge = handIndex < 9 ? `<div class="card-key">${handIndex + 1}</div>` : "";
      const contentHtml = `${keyBadge}<div class="card-type">${typeLabel}</div><div class="card-name">${escapeHtml(card.name)}</div>${rankBadge}<div class="card-value">${valueLabel}</div>${critNote}`;

      if (card.justDrawn) {
        // freshly drawn this render: enters face-down (see the slide-in + delayed flip below)
        const outer = document.createElement("div");
        outer.className = "card-flip-outer";
        outer.dataset.uid = card.uid;
        const inner = document.createElement("div");
        inner.className = "card-flip-inner";
        const back = document.createElement("div");
        back.className = "card-flip-face card-back";
        const front = document.createElement("div");
        front.className = "card-flip-face card-front " + cardClass;
        front.innerHTML = contentHtml;
        inner.appendChild(back);
        inner.appendChild(front);
        outer.appendChild(inner);
        // the handler goes on the outer, which never rotates: the faces spin during the reveal and
        // a rotated-away face is not hit-testable, so a handler on .card-front is dead for the
        // ~1.1s the animation runs (see .card-flip-face { pointer-events: none } in style.css)
        outer.addEventListener("click", () => playCard(card.uid));
        el.hand.appendChild(outer);
        toFlip.push(inner);
        newUids.push(String(card.uid));
        card.justDrawn = false; // only play the draw-in animation once
      } else {
        const div = document.createElement("div");
        div.className = cardClass;
        div.dataset.uid = card.uid;
        div.innerHTML = contentHtml;
        div.addEventListener("click", () => playCard(card.uid));
        el.hand.appendChild(div);
      }
    });
    el.hand.appendChild(el.deckPile); // always the last grid item: same cell size, sits to the right

    // slide every card (existing ones sliding left to fill the gap, new ones flying in from the
    // deck pile) from its recorded old position to where it just landed.
    el.hand.querySelectorAll("[data-uid]").forEach((node) => {
      const uid = node.dataset.uid;
      const isNew = newUids.includes(uid);
      const fromRect = prevRects.get(uid) || (isNew ? prevDeckRect : null);
      if (!fromRect) return; // no earlier position on record (e.g. the initial deal) -> nothing to slide from
      const newRect = node.getBoundingClientRect();
      const dx = fromRect.left - newRect.left;
      const dy = fromRect.top - newRect.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      node.style.transition = "none";
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      void node.offsetWidth; // flush the start position so the transition below has something to animate from
      node.style.transition = `transform ${spd(FLIP_SLIDE_MS)}ms ease`;
      node.style.transform = "";
      setTimeout(() => { node.style.transition = ""; }, spd(FLIP_SLIDE_MS));
    });

    if (toFlip.length) {
      // stay face-down for a beat after arriving, then flip to reveal
      setTimeout(() => {
        toFlip.forEach((inner) => inner.classList.add("flipped"));
      }, spd(CARD_FLIP_DELAY_MS));
    }

    syncEnemyVisualHeight();
  }

  // the battle screen stacks into one column below 860px -- except on a short landscape window
  // (a phone turned sideways), where the width is there and the height is what is scarce, so
  // style.css puts the two columns back. These mirror that pair of media queries.
  const narrowBattleMQ = window.matchMedia("(max-width: 860px)");
  const landscapeBattleMQ = window.matchMedia("(max-height: 520px) and (min-width: 640px) and (orientation: landscape)");
  function isStackedBattleLayout() {
    return narrowBattleMQ.matches && !landscapeBattleMQ.matches;
  }

  // makes the enemy art zone's bottom edge land exactly on the log panel's bottom edge: measures
  // the stats+log column's real rendered height and the enemy panel's own non-art content height,
  // then sets an explicit px height on .enemy-visual to make up the difference. Plain CSS
  // stretch/flex-grow can't do this without either leaving a gap after the log panel or letting
  // the log panel's own height depend on its (scrollable, unbounded) content again.
  function syncEnemyVisualHeight() {
    if (isStackedBattleLayout()) {
      el.enemyVisual.style.height = ""; // stacked single-column layout: nothing to match
      return;
    }
    const panel = el.enemyVisual.parentElement;
    const otherContentHeight = panel.scrollHeight - el.enemyVisual.offsetHeight;
    const targetTotal = el.battleSide.getBoundingClientRect().height;
    el.enemyVisual.style.height = Math.max(160, targetTotal - otherContentHeight) + "px";
  }
  window.addEventListener("resize", () => {
    if (document.getElementById("screen-battle").classList.contains("active")) syncEnemyVisualHeight();
  });

