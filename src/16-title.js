// src/16-title.js — part of game.js (title staff and menu descriptions). Edit here, then run: node tools/build.js
  // ---------------- Title: the staff ----------------
  // light motes rising from the orb (size/drift/speed varied per mote), and a burst when it's clicked
  const staffEl = document.getElementById("homeStaff");
  const staffSparks = document.getElementById("staffSparks");
  const rand = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 24; i++) {
    const s = document.createElement("i");
    const t = rand(2.6, 4.8);
    s.style.setProperty("--s", rand(3, 7).toFixed(1) + "px");
    s.style.setProperty("--x", rand(-9, 9).toFixed(1) + "vh");
    s.style.setProperty("--y", rand(-26, -9).toFixed(1) + "vh");
    s.style.setProperty("--t", t.toFixed(2) + "s");
    s.style.setProperty("--d", (-rand(0, t)).toFixed(2) + "s");
    staffSparks.appendChild(s);
  }
  let chargeTimer = null;
  staffEl.addEventListener("click", () => {
    // the circles, the stars, the far tower and the runes all flare up with the staff for a moment
    const stage = staffEl.closest(".home-stage");
    stage.classList.add("charged");
    clearTimeout(chargeTimer);
    chargeTimer = setTimeout(() => stage.classList.remove("charged"), 1600);
    const floatEl = staffEl.querySelector(".staff-float");
    for (let i = 0; i < 2; i++) {
      const surge = document.createElement("div");
      surge.className = "mc-ripple surge";
      surge.style.animationDelay = (i * 0.2) + "s";
      floatEl.appendChild(surge);
      setTimeout(() => surge.remove(), 1400);
    }
    if (typeof onStaffTouched === "function") onStaffTouched();
    staffEl.classList.remove("flash");
    void staffEl.offsetWidth;
    staffEl.classList.add("flash");
    for (let i = 0; i < 26; i++) {
      const s = document.createElement("i");
      const angle = (i / 26) * Math.PI * 2 + rand(-0.15, 0.15);
      const dist = rand(9, 22);
      s.className = "burst";
      s.style.setProperty("--s", rand(4, 9).toFixed(1) + "px");
      s.style.setProperty("--x", (Math.cos(angle) * dist).toFixed(1) + "vh");
      s.style.setProperty("--y", (Math.sin(angle) * dist).toFixed(1) + "vh");
      staffSparks.appendChild(s);
      setTimeout(() => s.remove(), 950);
    }
  });

  function onStaffTouched() {
    bumpStat("staffTouches");
    checkAchievements();
    persistSave();
  }

  // ---------------- Title: what each menu button does ----------------
  // landscape with a mouse: hovering a button stretches the menu box to the right and writes the
  // description into the new space. Touch: a long press shows it as a bubble (and doesn't press the button).
  const MENU_DESC = {
    openFloorSelectBtn: () => "チェックポイントを選んで塔を登る。倒した敵の階数の合計がソウルになり、敗北してもソウルとレベルは残る。",
    openTreeBtn: () => (activeRemnantCount() > 0
      ? "基本強化ツリー・拡張強化・デッキ強化をまとめて開く。ソウルで永続的な強化を習得できる。"
      : "ソウルを使って基本強化ツリーのノードを習得する。攻撃力・会心・獲得金額などが永続的に上がる。"),
    openDeckUpgradeBtn: () => (activeRemnantCount() > 0
      ? "残滓のカード強化と、全ての残滓に共通の残滓スキルツリー。転生ポイントを使い、転生しても失われない。"
      : "カードの強化・削除と、デッキに入れる枚数の編成（デッキは最低9枚）。"),
    openCardShopBtn: () => "ソウルで強力なカードを買ってデッキに加える。同じカードは買うたびに値上がりする。",
    openAchievementsBtn: () => "達成した実績の一覧。効果は全て足し算で、転生しても失われない。",
    openPanelPreviewBtn: () => "転生ポイントで永続的な強化を買う（転生しなくても買える）。次の転生でもらえる転生ポイントも確認できる。",
    openPanelBtn: () => `レベルに応じた転生ポイント（いまなら +${fmt(transcendGainForLevel(save.level))}）を得て、ソウル・基本強化・デッキ・秘宝を手放して最初からやり直す。`,
  };
  const menuBox = el.openFloorSelectBtn.parentElement;
  const hoverMenuMQ = window.matchMedia("(hover: hover) and (pointer: fine) and (orientation: landscape) and (min-width: 861px)");
  function menuLabel(btn) { return [...btn.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim(); }
  // hover (landscape + mouse) writes the description into the box's stretched-out right side; on touch a
  // long press shows it as a bubble and swallows the click that would otherwise follow
  function attachMenuDesc(btn, titleFn, textFn) {
    btn.addEventListener("mouseenter", () => {
      if (!hoverMenuMQ.matches) return;
      el.menuDescTitle.textContent = titleFn();
      el.menuDescText.textContent = textFn();
      menuBox.classList.add("show-desc");
      menuBox.parentElement.classList.add("desc-open");
    });
    let pressTimer = null;
    let longPressed = false;
    btn.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      longPressed = false;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => { longPressed = true; showMenuTip(titleFn(), textFn(), btn); }, 450);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => btn.addEventListener(ev, () => clearTimeout(pressTimer)));
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      if (!longPressed) return;
      longPressed = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
  }
  Object.keys(MENU_DESC).forEach((id) => attachMenuDesc(el[id], () => menuLabel(el[id]), MENU_DESC[id]));
  menuBox.addEventListener("mouseleave", () => {
    menuBox.classList.remove("show-desc");
    menuBox.parentElement.classList.remove("desc-open");
  });
  let menuTipTimer = null;
  function showMenuTip(titleText, text, btn) {
    document.querySelectorAll(".menu-tip").forEach((t) => t.remove());
    const tip = document.createElement("div");
    tip.className = "menu-tip";
    const title = document.createElement("div");
    title.className = "menu-tip-title";
    title.textContent = titleText;
    const body = document.createElement("div");
    body.textContent = text;
    tip.appendChild(title);
    tip.appendChild(body);
    document.body.appendChild(tip);
    const r = btn.getBoundingClientRect();
    const top = r.top - tip.offsetHeight - 8;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - tip.offsetWidth - 8, r.left + r.width / 2 - tip.offsetWidth / 2)) + "px";
    tip.style.top = (top > 8 ? top : r.bottom + 8) + "px";
    clearTimeout(menuTipTimer);
    menuTipTimer = setTimeout(() => tip.remove(), 3500);
    document.addEventListener("pointerdown", () => tip.remove(), { once: true, capture: true });
  }


