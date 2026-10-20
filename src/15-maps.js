// src/15-maps.js — part of game.js (pan/zoom and the basic tree screen). Edit here, then run: node tools/build.js
  // ---------------- Drag-to-pan (shared by the basic tree and the reincarnation panel) ----------------
  function setupDragPan(wrap) {
    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    const DRAG_THRESHOLD = 5;

    function pointerDown(x, y) {
      dragging = true;
      moved = false;
      startX = x;
      startY = y;
      startLeft = wrap.scrollLeft;
      startTop = wrap.scrollTop;
      wrap.classList.add("dragging");
    }
    function pointerMove(x, y, evt) {
      if (!dragging) return;
      const dx = x - startX;
      const dy = y - startY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) moved = true;
      if (moved) {
        if (evt && evt.cancelable) evt.preventDefault();
        wrap.scrollLeft = startLeft - dx;
        wrap.scrollTop = startTop - dy;
      }
    }
    function pointerUp() {
      dragging = false;
      wrap.classList.remove("dragging");
    }

    wrap.addEventListener("mousedown", (e) => { pointerDown(e.pageX, e.pageY); });
    window.addEventListener("mousemove", (e) => pointerMove(e.pageX, e.pageY, e));
    window.addEventListener("mouseup", pointerUp);

    wrap.addEventListener("touchstart", (e) => {
      // a second finger means this is a pinch (see setupPinchZoom), not a pan
      if (e.touches.length > 1) { dragging = false; moved = true; wrap.classList.remove("dragging"); return; }
      const t = e.touches[0];
      pointerDown(t.pageX, t.pageY);
    }, { passive: true });
    wrap.addEventListener("touchmove", (e) => {
      if (e.touches.length > 1) { dragging = false; return; }
      const t = e.touches[0];
      pointerMove(t.pageX, t.pageY, e);
    }, { passive: false });
    wrap.addEventListener("touchend", pointerUp);
    wrap.addEventListener("touchcancel", pointerUp);

    // if the gesture was a drag (not a tap/click), swallow the click so it doesn't
    // also trigger whatever node button happens to be under the cursor on release.
    wrap.addEventListener("click", (e) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }
  setupDragPan(el.treeScrollWrap);
  setupDragPan(el.panelScrollWrap);

  // ---------------- Pinch-to-zoom (touch equivalent of the wheel handlers below) ----------------
  // a phone has no wheel event, so without this the maps are stuck at whatever zoom they open at.
  // applyZoom(z) is the caller's "clamp, store and re-render at this zoom" step; this keeps the
  // point between the two fingers pinned in place, exactly like the wheel handlers keep the cursor.
  function setupPinchZoom(wrap, getZoom, applyZoom) {
    let pinching = false;
    let startDist = 0, startZoom = 1;
    const spread = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    wrap.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 2) return;
      pinching = true;
      startDist = spread(e.touches);
      startZoom = getZoom();
    }, { passive: true });

    wrap.addEventListener("touchmove", (e) => {
      if (!pinching || e.touches.length !== 2 || startDist === 0) return;
      if (e.cancelable) e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      // the content point currently between the fingers, in unscaled map coordinates
      const zoom = getZoom();
      const contentX = (wrap.scrollLeft + midX) / zoom;
      const contentY = (wrap.scrollTop + midY) / zoom;

      const next = applyZoom(startZoom * (spread(e.touches) / startDist));
      wrap.scrollLeft = contentX * next - midX;
      wrap.scrollTop = contentY * next - midY;
    }, { passive: false });

    const endPinch = (e) => { if (e.touches.length < 2) pinching = false; };
    wrap.addEventListener("touchend", endPinch);
    wrap.addEventListener("touchcancel", endPinch);
  }

  // the maps open zoomed in enough to read a node on a desktop monitor; at phone width that same
  // zoom shows barely two nodes, so narrow screens open further out and pinch in from there
  const narrowScreen = window.matchMedia("(max-width: 640px)");

  // ---------------- Zooming the skill tree (wheel on desktop, pinch on touch) ----------------
  const TREE_ZOOM_MIN = 0.22; // far enough out that the whole tree fits, centred on 起点
  const TREE_ZOOM_MAX = 2;
  const TREE_OPEN_ZOOM = 1.6; // opening the screen starts zoomed in on the origin, not showing a corner of the map
  const TREE_OPEN_ZOOM_NARROW = 0.8; // phone width: 1.6 leaves barely two nodes on screen
  let treeZoom = 1;

  function applyTreeZoom() {
    el.treeMap.style.width = TREE_CANVAS_WIDTH + "px";
    el.treeMap.style.height = TREE_CANVAS_HEIGHT + "px";
    el.treeMap.style.transform = `scale(${treeZoom})`;
    el.treeMapScaler.style.width = (TREE_CANVAS_WIDTH * treeZoom) + "px";
    el.treeMapScaler.style.height = (TREE_CANVAS_HEIGHT * treeZoom) + "px";
  }
  applyTreeZoom();

  // center the view on the root node at a strong zoom level; used whenever the tree screen opens
  function centerTreeOnRoot() {
    treeZoom = narrowScreen.matches ? TREE_OPEN_ZOOM_NARROW : TREE_OPEN_ZOOM;
    applyTreeZoom();
    const wrap = el.treeScrollWrap;
    wrap.scrollLeft = ROOT.x * treeZoom - wrap.clientWidth / 2;
    wrap.scrollTop = ROOT.y * treeZoom - wrap.clientHeight / 2;
  }

  // clamp, store and re-render at the requested zoom; returns the zoom actually applied so the
  // caller can re-anchor its scroll against it. Shared by the wheel and pinch handlers.
  // the zoom at which the whole canvas fits inside the scroll frame (minus its padding)
  function fitZoom(wrap, width, height) {
    const w = wrap.clientWidth - 32;
    const h = wrap.clientHeight - 8;
    if (w <= 0 || h <= 0) return 1;
    return Math.min(w / width, h / height) * 0.98;
  }
  function setTreeZoom(z) {
    const min = Math.min(TREE_ZOOM_MIN, fitZoom(el.treeScrollWrap, TREE_CANVAS_WIDTH, TREE_CANVAS_HEIGHT));
    treeZoom = Math.min(TREE_ZOOM_MAX, Math.max(min, z));
    applyTreeZoom();
    return treeZoom;
  }

  el.treeScrollWrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const wrap = el.treeScrollWrap;
    const rect = wrap.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    // the content point currently under the cursor, in unscaled tree coordinates
    const contentX = (wrap.scrollLeft + cursorX) / treeZoom;
    const contentY = (wrap.scrollTop + cursorY) / treeZoom;

    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setTreeZoom(treeZoom * factor);

    // re-anchor scroll so the same content point stays under the cursor
    wrap.scrollLeft = contentX * treeZoom - cursorX;
    wrap.scrollTop = contentY * treeZoom - cursorY;
  }, { passive: false });

  setupPinchZoom(el.treeScrollWrap, () => treeZoom, setTreeZoom);

  // ---------------- Zooming the reincarnation panel (wheel on desktop, pinch on touch) ----------------
  const PANEL_ZOOM_MIN = 0.2;
  const PANEL_ZOOM_MAX = 1.5;
  const PANEL_OPEN_ZOOM = 1.3; // opens zoomed in on the core, the same way the basic tree opens on 起点
  const PANEL_OPEN_ZOOM_NARROW = 0.7; // phone width: a little further out so the core's neighbors show too
  let panelZoom = 1;

  function applyPanelZoom() {
    el.panelMap.style.width = PANEL_CANVAS_WIDTH + "px";
    el.panelMap.style.height = PANEL_CANVAS_HEIGHT + "px";
    el.panelMap.style.transform = `scale(${panelZoom})`;
    el.panelMapScaler.style.width = (PANEL_CANVAS_WIDTH * panelZoom) + "px";
    el.panelMapScaler.style.height = (PANEL_CANVAS_HEIGHT * panelZoom) + "px";
  }
  applyPanelZoom();

  // center the view on the core at a slightly zoomed-out level; used whenever the panel opens
  function centerPanelOnCore() {
    panelZoom = narrowScreen.matches ? PANEL_OPEN_ZOOM_NARROW : PANEL_OPEN_ZOOM;
    applyPanelZoom();
    const wrap = el.panelScrollWrap;
    wrap.scrollLeft = PANEL_POS.core.x * panelZoom - wrap.clientWidth / 2;
    wrap.scrollTop = PANEL_POS.core.y * panelZoom - wrap.clientHeight / 2;
  }

  function setPanelZoom(z) {
    const min = Math.min(PANEL_ZOOM_MIN, fitZoom(el.panelScrollWrap, PANEL_CANVAS_WIDTH, PANEL_CANVAS_HEIGHT));
    panelZoom = Math.min(PANEL_ZOOM_MAX, Math.max(min, z));
    applyPanelZoom();
    return panelZoom;
  }

  el.panelScrollWrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const wrap = el.panelScrollWrap;
    const rect = wrap.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const contentX = (wrap.scrollLeft + cursorX) / panelZoom;
    const contentY = (wrap.scrollTop + cursorY) / panelZoom;

    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setPanelZoom(panelZoom * factor);

    wrap.scrollLeft = contentX * panelZoom - cursorX;
    wrap.scrollTop = contentY * panelZoom - cursorY;
  }, { passive: false });

  setupPinchZoom(el.panelScrollWrap, () => panelZoom, setPanelZoom);

  // ---------------- Render: level-up tree ----------------
  function nodeState(node) {
    if (save.unlockedNodes[node.id]) return "unlocked";
    const prereqOk = node.requires === null || save.unlockedNodes[node.requires];
    if (!prereqOk) return "locked";
    return save.points >= node.cost ? "available" : "unaffordable";
  }

  // a magic circle drawn behind a node map, centered on (cx, cy): the given rings (alternately solid and
  // dotted), a slowly turning outer band of ticks and rune text, and a counter-turning hexagram + octagram.
  // Purely decorative; the nodes keep their positions.
  const MC_RUNES = "✦ MAGIA ✦ ARCANUM ✦ AETERNUM ✦ TURRIS ✦ STELLA ✦ LUMEN ✦ POTENTIA ✦ INFINITAS ";
  // `progress` (0…1, the share of nodes bought) completes the circle: each ring is drawn in as a glowing arc
  // one after another, the outer band's ticks light up in turn, the stars are traced out and the runes
  // brighten. At 1 the whole circle turns gold and shines.
  function drawMagicBackdrop(svg, cx, cy, rings, idSuffix, progress) {
    const svgNS = "http://www.w3.org/2000/svg";
    const f = Math.max(0, Math.min(1, progress || 0));
    const complete = f >= 1;
    const mk = (tag, attrs) => {
      const n = document.createElementNS(svgNS, tag);
      Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
      return n;
    };
    // a copy of a shape traced from its start up to `share` of its length
    const traced = (tag, attrs, share, cls) => mk(tag, Object.assign({}, attrs, {
      class: cls, pathLength: 1, "stroke-dasharray": "1 1", "stroke-dashoffset": (1 - Math.max(0, Math.min(1, share))).toFixed(4),
    }));
    const g = mk("g", { class: "mc-backdrop" + (complete ? " complete" : "") });
    const outer = rings[rings.length - 1] + 80;
    if (complete) {
      const gradId = "mcAura-" + idSuffix;
      const defs = mk("defs", {});
      const grad = mk("radialGradient", { id: gradId });
      grad.appendChild(mk("stop", { offset: "0%", "stop-color": "rgba(255, 226, 150, 0.32)" }));
      grad.appendChild(mk("stop", { offset: "55%", "stop-color": "rgba(170, 150, 255, 0.12)" }));
      grad.appendChild(mk("stop", { offset: "100%", "stop-color": "rgba(0, 0, 0, 0)" }));
      defs.appendChild(grad);
      g.appendChild(defs);
      g.appendChild(mk("circle", { cx, cy, r: outer + 60, class: "mc-aura", fill: `url(#${gradId})` }));
    }
    const lit = mk("g", { class: "mc-lit" });
    rings.forEach((r, i) => {
      g.appendChild(mk("circle", { cx, cy, r, class: i % 2 ? "dash" : "" }));
      const share = f * rings.length - i;
      if (share > 0) lit.appendChild(traced("circle", { cx, cy, r, transform: `rotate(-90 ${cx} ${cy})` }, share, "lit-ring"));
    });
    const rotor = mk("g", { class: "mc-rotor", style: `transform-origin: ${cx}px ${cy}px` });
    rotor.appendChild(mk("circle", { cx, cy, r: outer }));
    rotor.appendChild(mk("circle", { cx, cy, r: outer - 44, class: "thin" }));
    const tickLit = mk("g", { class: "mc-lit" });
    const tickCount = 90;
    const litTicks = Math.round(f * tickCount);
    for (let i = 0; i < tickCount; i++) {
      const a = i * 4 - 90;
      const rad = (a * Math.PI) / 180;
      const r1 = outer - (i % 5 === 0 ? 16 : 8);
      const attrs = { x1: cx + Math.cos(rad) * outer, y1: cy + Math.sin(rad) * outer, x2: cx + Math.cos(rad) * r1, y2: cy + Math.sin(rad) * r1 };
      (i < litTicks ? tickLit : rotor).appendChild(mk("line", Object.assign({ class: i < litTicks ? "tick lit" : "tick" }, attrs)));
    }
    rotor.appendChild(tickLit);
    if (complete) rotor.appendChild(traced("circle", { cx, cy, r: outer, transform: `rotate(-90 ${cx} ${cy})` }, 1, "lit-ring"));
    const runeR = outer - 30;
    const pathId = "mcRune-" + idSuffix;
    rotor.appendChild(mk("path", { id: pathId, d: `M ${cx - runeR},${cy} a ${runeR},${runeR} 0 1,1 ${runeR * 2},0 a ${runeR},${runeR} 0 1,1 ${-runeR * 2},0`, fill: "none" }));
    const text = mk("text", { class: "rune", style: `fill-opacity: ${(0.35 + 0.65 * f).toFixed(2)}` });
    const tp = mk("textPath", { href: "#" + pathId });
    tp.textContent = MC_RUNES.repeat(Math.max(1, Math.ceil((2 * Math.PI * runeR) / (MC_RUNES.length * 15))));
    text.appendChild(tp);
    rotor.appendChild(text);
    g.appendChild(lit);
    g.appendChild(rotor);
    const star = mk("g", { class: "mc-rotor rev", style: `transform-origin: ${cx}px ${cy}px` });
    const starR = rings[Math.min(1, rings.length - 1)];
    const pts = (n, step, r, rot) => Array.from({ length: n }, (_, i) => {
      const t = rot + (i * step * 2 * Math.PI) / n;
      return `${cx + Math.cos(t) * r},${cy + Math.sin(t) * r}`;
    }).join(" ");
    const shapes = [
      [{ points: pts(3, 1, starR, -Math.PI / 2) }, ""],
      [{ points: pts(3, 1, starR, Math.PI / 2) }, ""],
      [{ points: pts(8, 3, rings[rings.length - 1], 0) }, "thin"],
    ];
    shapes.forEach(([attrs, cls], i) => {
      star.appendChild(mk("polygon", Object.assign({ class: cls }, attrs)));
      const share = f * shapes.length - i;
      if (share > 0) star.appendChild(traced("polygon", attrs, share, "lit-star"));
    });
    g.appendChild(star);
    svg.insertBefore(g, svg.firstChild);
  }
  // the emblem drawn inside the tree's 起点 and the panel's 核
  const EMBLEM_SVG = `<svg class="emblem-circle" viewBox="0 0 200 200" aria-hidden="true">
    <circle cx="100" cy="100" r="96" /><circle cx="100" cy="100" r="86" class="thin" />
    <polygon points="100,14 175,143 25,143" /><polygon points="100,186 25,57 175,57" />
    <circle cx="100" cy="100" r="50" class="dash" /></svg>`;

  // set when 起点 is bought: the next render plays the tree unfolding outward from it
  let treeRevealPending = false;
  function renderTree() {
    el.treePointsLabel.textContent = fmt(save.points);
    el.treeMap.innerHTML = "";

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "tree-map-svg");
    svg.setAttribute("viewBox", `0 0 ${TREE_CANVAS_WIDTH} ${TREE_CANVAS_HEIGHT}`);

    // until 起点 is learned only it is shown: the rest of the tree unfolds out of it on purchase
    const opened = !!save.unlockedNodes.root;
    const reveal = treeRevealPending;
    treeRevealPending = false;
    const rootPos = TREE_POS.root;
    const revealDelay = (pos) => (Math.hypot(pos.x - rootPos.x, pos.y - rootPos.y) / 1500 + 0.35).toFixed(2) + "s";
    if (opened) {
      drawMagicBackdrop(svg, rootPos.x, rootPos.y, TREE_RINGS, "tree", treeProgress());
    }
    NODES.forEach((node) => {
      const fromId = node.requires || "root";
      if (fromId === node.id || !opened) return; // the root node itself has no incoming line to draw
      const from = TREE_POS[fromId];
      const to = TREE_POS[node.id];
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", from.x);
      line.setAttribute("y1", from.y);
      line.setAttribute("x2", to.x);
      line.setAttribute("y2", to.y);
      const cls = [save.unlockedNodes[node.id] ? "active" : "", reveal ? "reveal" : ""].filter(Boolean).join(" ");
      if (cls) line.setAttribute("class", cls);
      if (reveal) line.style.setProperty("--rd", revealDelay(from));
      svg.appendChild(line);
    });
    el.treeMap.appendChild(svg);

    NODES.forEach((node) => {
      const isRoot = node.id === "root";
      if (!opened && !isRoot) return;
      const pos = TREE_POS[node.id];
      const state = nodeState(node);
      const div = document.createElement("div");
      div.className = "tree-map-node " + state + (isRoot ? " root-node" : "") + (reveal && !isRoot ? " reveal" : "");
      if (reveal && !isRoot) div.style.setProperty("--rd", revealDelay(pos));
      div.style.left = pos.x + "px";
      div.style.top = pos.y + "px";
      const costLabel = state === "unlocked" ? "習得済み" : `${node.cost}pt`;
      div.innerHTML = (isRoot ? EMBLEM_SVG : "") + `<div class="tn-name">${node.label}</div><div class="tn-desc">${node.desc}</div><div class="tn-cost">${costLabel}</div>`;
      if (isRoot && !opened) {
        const hint = document.createElement("div");
        hint.className = "root-hint";
        hint.style.left = pos.x + "px";
        hint.style.top = (pos.y + 118) + "px";
        hint.textContent = state === "available" ? "起点に触れて、基本強化の封印を解こう" : "塔に挑んでソウルを集め、起点を習得しよう（1pt）";
        el.treeMap.appendChild(hint);
      }
      if (state === "available") {
        div.addEventListener("click", () => {
          if (nodeState(node) !== "available") return;
          const before = treeProgress();
          buyTreeNode(node);
          persistSave();
          renderTree();
          celebrateIfCompleted(before, treeProgress(), "基本強化");
        });
      }
      el.treeMap.appendChild(div);
    });
    if (reveal) spawnRootRings(rootPos);
  }
  function treeProgress() { return NODES.filter((n) => save.unlockedNodes[n.id]).length / NODES.length; }
  function buyTreeNode(node) {
    save.points -= node.cost;
    save.unlockedNodes[node.id] = true;
    if (node.id === "root") {
      treeRevealPending = true;
      playRootBurst();
    }
    // startCards nodes grant their cards to the permanent deck once, right here at
    // purchase time (not re-applied every run), so they're real deck members that can
    // later be ranked up / deleted from the title-screen deck upgrade screen too.
    if (node.kind === "startCards") {
      node.cards.forEach((c) => addCardToDeckDefs(save.deckDefs, c));
    } else if (node.kind === "grantPoints") {
      save.points += node.pointsGrant;
    } else if (node.kind === "autoBuy") {
      save.autoBuyEnabled = true;
    }
  }
  // 一括購入: keep buying the cheapest node that's affordable right now until nothing more is
  // (newly opened neighbours join in as their prerequisite gets bought)
  function bulkBuyTree() {
    const before = treeProgress();
    let count = 0;
    let spent = 0;
    for (;;) {
      const node = NODES.filter((n) => nodeState(n) === "available").sort((a, b) => a.cost - b.cost)[0];
      if (!node) break;
      spent += node.cost;
      buyTreeNode(node);
      count += 1;
    }
    if (!count) { showToast("いま習得できる基本強化はない"); return; }
    persistSave();
    renderTree();
    checkAchievements();
    showToast(`一括購入：${count}個の基本強化を習得した（ソウル -${fmt(spent)}）`);
    celebrateIfCompleted(before, treeProgress(), "基本強化");
  }
  // the moment the last node is bought, the circle flashes and says so
  function celebrateIfCompleted(before, after, label) {
    if (before >= 1 || after < 1) return;
    const flash = document.createElement("div");
    flash.className = "screen-flash flash-crit";
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 450);
    showToast(`${label}の魔法陣が完成した！`);
  }
  // 起点 awakening: a flash and light rings racing outward, while the tree draws itself in behind them
  function playRootBurst() {
    const flash = document.createElement("div");
    flash.className = "screen-flash flash-huge";
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 450);
  }
  // spawned after the redraw that reveals the tree (rendering clears the map, so they can't be added earlier)
  function spawnRootRings(pos) {
    for (let i = 0; i < 3; i++) {
      const ring = document.createElement("div");
      ring.className = "root-burst";
      ring.style.left = pos.x + "px";
      ring.style.top = pos.y + "px";
      ring.style.animationDelay = (i * 0.18) + "s";
      el.treeMap.appendChild(ring);
      setTimeout(() => ring.remove(), 1800);
    }
  }

