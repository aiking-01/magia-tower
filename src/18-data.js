// src/18-data.js — part of game.js (データ管理: backup, cloud, play data). Edit here, then run: node tools/build.js
  // ---------------- データ管理: local backup, cloud transfer (引き継ぎ), play data ----------------
  // The game always runs on the save in localStorage; every network call here is best-effort and silently gives up.
  // The server (api/ next to the game on Vercel, Upstash Redis behind it) is never used from localhost or ?debug=1,
  // so test and debug play can't end up in the real data -- ?net=1 turns it on locally against the dev server.
  const GAME_VERSION = "2026.10-v5";
  const API_BASE = "api";
  const NETWORK_ENABLED = !DEBUG_MODE && (!LOCAL_ORIGIN || new URLSearchParams(location.search).get("net") === "1");
  const API_TIMEOUT_MS = 10000;
  const KEEPALIVE_LIMIT = 60000; // keepalive fetch / sendBeacon bodies over ~64KB are dropped by the browser
  function readJson(key) {
    try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v && typeof v === "object" ? v : null; } catch (e) { return null; }
  }
  function writeJson(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function randomHex(bytes) {
    const a = new Uint8Array(bytes);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function apiRequest(path, body, opts) {
    const o = opts || {};
    let timer = null;
    try {
      const ctrl = typeof AbortController === "function" ? new AbortController() : null;
      if (ctrl) timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
      const res = await fetch(API_BASE + path, {
        method: body ? "POST" : "GET",
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        keepalive: !!o.keepalive,
        signal: ctrl ? ctrl.signal : undefined,
      });
      let data = null;
      try { data = await res.json(); } catch (e) { /* empty or not JSON */ }
      return { status: res.status, data: data || {} };
    } catch (e) {
      return { status: 0, data: { error: "offline" } };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  // "ok" / "nodb" (deployed without the database) / "offline" / "disabled" (localhost, debug)
  let serverState = NETWORK_ENABLED ? "unknown" : "disabled";
  async function checkServer() {
    if (!NETWORK_ENABLED) return serverState;
    const r = await apiRequest("/health");
    serverState = r.status === 200 ? (r.data.db ? "ok" : "nodb") : "offline";
    return serverState;
  }

  // ---- 端末内の控え: "MT2:" + base64(UTF-8 JSON). Plain JSON is accepted too ----
  const SAVE_TEXT_MAX = 1024 * 1024;
  function encodeSaveText(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return "MT2:" + btoa(bin);
  }
  function decodeSaveText(text) {
    const t = String(text || "").trim();
    if (!t || t.length > SAVE_TEXT_MAX) throw new Error("size");
    let json;
    if (t.startsWith("MT2:")) {
      const bin = atob(t.slice(4).replace(/\s+/g, ""));
      json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } else json = t;
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== "object" || Array.isArray(obj) || !("level" in obj || "points" in obj || "unlockedNodes" in obj)) throw new Error("shape");
    return obj;
  }
  function saveSummary(obj) {
    const s = obj || {};
    const st = s.stats || {};
    return `Lv.${toInt(s.level, 1, 1e8, 1)}・最高クリア ${toInt(st.maxCleared, 0, 1e9, 0)}階・転生 ${toInt(st.reincarnations, 0, 1e9, 0)}回`;
  }
  // overwrites this device's save and reloads, the same way the reset does (wipingSave keeps pagehide from
  // writing the old save back). lastSeen is set to now: another device's clock must not pay idle income or
  // trip 時を遡る者
  function replaceSaveAndReload(obj, cloudCreds) {
    const next = Object.assign({}, obj, { lastSeen: Date.now() });
    wipingSave = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (cloudCreds) writeJson(CLOUD_KEY, cloudCreds);
    location.reload();
  }
  async function importSaveText(text) {
    let obj;
    try { obj = decodeSaveText(text); } catch (e) { showToast("読み込めない形式です（書き出した文字列かファイルを使ってください）"); return; }
    const cloudNote = cloud.creds && cloud.creds.code ? "\n※引き継ぎを設定しているので、この内容が次の自動保存でクラウドにも保存されます。" : "";
    if (!(await showConfirm(`この端末のセーブを、読み込んだセーブ（${saveSummary(obj)}）で上書きします。今のセーブは元に戻せません。よろしいですか?${cloudNote}`))) return;
    replaceSaveAndReload(obj);
  }
  function exportStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
  function downloadText(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type || "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function currentSaveText() { persistSave(); return encodeSaveText(JSON.parse(localStorage.getItem(STORAGE_KEY) || JSON.stringify(save))); }

  // ---- クラウドセーブ（引き継ぎコード＋パスワード）. Kept apart from the save, so a shared backup never leaks them ----
  const CLOUD_KEY = "magiaTower.cloud.v1";
  const CLOUD_UPLOAD_MS = 10 * 60 * 1000;
  const cloud = { creds: readJson(CLOUD_KEY), busy: false, showPassword: false };
  function cloudCredsWrite() { writeJson(CLOUD_KEY, cloud.creds); }
  function normalizeCode(v) {
    const raw = String(v || "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^MT/, "");
    return raw.length === 8 ? `MT-${raw.slice(0, 4)}-${raw.slice(4)}` : "";
  }
  // lastSeen changes every minute; leave it out so an unchanged save isn't sent again
  function saveFingerprint(text) {
    const t = text.replace(/"lastSeen":\d+/, "");
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0;
    return t.length + ":" + h;
  }
  function cloudErrorText(r) {
    if (r.status === 0) return "サーバーに接続できない";
    if (r.status === 401) return "コードかパスワードが違う";
    if (r.status === 404) return "そのコードのデータが無い";
    if (r.status === 409) return "別の端末に引き継がれた";
    if (r.status === 413) return "セーブが大きすぎる";
    if (r.status === 429) return "試行が多すぎる（しばらく待ってから）";
    if (r.status === 503) return "サーバーが準備中か、無料枠を使い切った";
    return (r.data && r.data.error) || "エラー " + r.status;
  }
  async function cloudUpload(opts) {
    const o = opts || {};
    const c = cloud.creds;
    if (!NETWORK_ENABLED || !c || !c.code || c.superseded || cloud.busy) return false;
    persistSave(); // send exactly what localStorage holds
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return false;
    const fp = saveFingerprint(data);
    if (!o.force && fp === c.lastHash) return true;
    if (o.keepalive && data.length > KEEPALIVE_LIMIT) return false;
    const body = { op: "save", code: c.code, password: c.password, generation: c.generation, data,
      meta: { level: save.level, best: stat("maxCleared"), reinc: stat("reincarnations"), version: GAME_VERSION } };
    if (o.keepalive) { apiRequest("/cloud", body, { keepalive: true }); return true; }
    cloud.busy = true;
    try {
      const r = await apiRequest("/cloud", body);
      if (r.status === 200) Object.assign(c, { lastUploadAt: Date.now(), lastHash: fp, lastError: "", generation: r.data.generation || c.generation });
      else if (r.status === 409) Object.assign(c, { superseded: true, lastError: cloudErrorText(r) });
      else c.lastError = cloudErrorText(r);
      cloudCredsWrite();
      return r.status === 200;
    } finally {
      cloud.busy = false;
      renderDataScreen();
    }
  }
  async function cloudRegister() {
    if (cloud.busy) return;
    cloud.busy = true;
    const r = await apiRequest("/cloud", { op: "register" });
    cloud.busy = false;
    if (r.status !== 200 || !r.data.code) { showToast("引き継ぎを設定できなかった：" + cloudErrorText(r)); renderDataScreen(); return; }
    cloud.creds = { code: r.data.code, password: r.data.password, generation: r.data.generation || 1, ack: false };
    cloud.showPassword = true;
    cloudCredsWrite();
    await cloudUpload({ force: true });
    renderDataScreen();
  }
  async function cloudRestore(code, password, previous) {
    const c = normalizeCode(code);
    const pw = String(password || "").trim().toUpperCase();
    if (!c || pw.length < 6) { showToast("引き継ぎコード（MT-XXXX-XXXX）とパスワードを入れてください"); return; }
    const info = await apiRequest("/cloud", { op: "info", code: c, password: pw });
    if (info.status !== 200) { showToast("復元できない：" + cloudErrorText(info)); return; }
    const slot = previous ? info.data.previous : info.data.latest;
    if (!slot) { showToast(previous ? "1つ前の保存が無い" : "保存されたデータが無い"); return; }
    const when = new Date(slot.updatedAt).toLocaleString("ja-JP");
    const meta = slot.meta || {};
    if (!(await showConfirm(`この端末のセーブを、クラウドのセーブ（${when} 保存・Lv.${meta.level || "?"}・最高クリア ${meta.best || 0}階）で上書きします。今のセーブは元に戻せません。\n復元すると、このコードの保存は今後この端末から行われ、ほかの端末からの保存は止まります。よろしいですか?`))) return;
    const r = await apiRequest("/cloud", { op: "restore", code: c, password: pw, slot: previous ? "previous" : "latest" });
    if (r.status !== 200) { showToast("復元できない：" + cloudErrorText(r)); return; }
    let obj;
    try { obj = decodeSaveText(r.data.data); } catch (e) { showToast("クラウドのデータが壊れている"); return; }
    replaceSaveAndReload(obj, { code: c, password: pw, generation: r.data.generation, ack: true, lastHash: "" });
  }
  async function cloudTakeover() {
    const c = cloud.creds;
    if (!c) return;
    if (!(await showConfirm("この端末の今のセーブで、クラウドのセーブを上書きします。ほかの端末で進めた分はクラウドから消え、ほかの端末からの保存は止まります。よろしいですか?"))) return;
    const r = await apiRequest("/cloud", { op: "takeover", code: c.code, password: c.password });
    if (r.status !== 200) { showToast("できなかった：" + cloudErrorText(r)); return; }
    Object.assign(c, { generation: r.data.generation, superseded: false, lastError: "", lastHash: "" });
    cloudCredsWrite();
    await cloudUpload({ force: true });
  }
  async function cloudDelete() {
    const c = cloud.creds;
    if (!c) return;
    if (!(await showConfirm(`クラウドに保存したセーブ（${c.code}）を削除し、この端末の引き継ぎ設定も消します。この端末のセーブはそのまま残ります。よろしいですか?`))) return;
    const r = await apiRequest("/cloud", { op: "delete", code: c.code, password: c.password });
    if (r.status !== 200 && r.status !== 404) { showToast("削除できなかった：" + cloudErrorText(r)); return; }
    cloud.creds = null;
    try { localStorage.removeItem(CLOUD_KEY); } catch (e) { /* ignore */ }
    showToast("クラウドのセーブを削除した");
    renderDataScreen();
  }

  // ---- プレイ情報: asked once, queued on the device, sent in batches (never from localhost / debug) ----
  const TELEMETRY_KEY = "magiaTower.telemetry.v1";
  const TELEMETRY_FLUSH_MS = 5 * 60 * 1000;
  const TELEMETRY_QUEUE_MAX = 500;
  const TELEMETRY_BATCH_MAX = 50;
  const telemetryStored = readJson(TELEMETRY_KEY) || {};
  const telemetry = {
    consent: typeof telemetryStored.consent === "boolean" ? telemetryStored.consent : null,
    anonId: typeof telemetryStored.anonId === "string" ? telemetryStored.anonId : "",
    queue: Array.isArray(telemetryStored.queue) ? telemetryStored.queue.slice(-TELEMETRY_QUEUE_MAX) : [],
    sending: false,
  };
  const telemetrySessionId = randomHex(8);
  function telemetryWrite() { writeJson(TELEMETRY_KEY, { consent: telemetry.consent, anonId: telemetry.anonId, queue: telemetry.queue }); }
  function telemetryOn() { return NETWORK_ENABLED && telemetry.consent === true; }
  function playMinutes() { return Math.round(stat("playMs") / 60000); }
  function track(type, data) {
    if (!telemetryOn()) return;
    telemetry.queue.push({ t: Date.now(), type, d: data || {} });
    if (telemetry.queue.length > TELEMETRY_QUEUE_MAX) telemetry.queue.splice(0, telemetry.queue.length - TELEMETRY_QUEUE_MAX);
    telemetryWrite();
  }
  async function flushTelemetry(keepalive) {
    if (!telemetryOn() || !telemetry.queue.length || telemetry.sending) return;
    if (!telemetry.anonId) telemetry.anonId = randomHex(16);
    const batch = telemetry.queue.slice(0, TELEMETRY_BATCH_MAX);
    const body = { op: "send", anonId: telemetry.anonId, sessionId: telemetrySessionId, version: GAME_VERSION, events: batch };
    if (keepalive) {
      const text = JSON.stringify(body);
      if (text.length > KEEPALIVE_LIMIT || !navigator.sendBeacon) return;
      // handed to the browser: drop them now, there is no answer to wait for
      if (navigator.sendBeacon(API_BASE + "/telemetry", new Blob([text], { type: "application/json" }))) {
        telemetry.queue.splice(0, batch.length);
        telemetryWrite();
      }
      return;
    }
    telemetry.sending = true;
    try {
      const r = await apiRequest("/telemetry", body);
      // 400 = the server will never take this batch (malformed): drop it rather than retry forever
      if (r.status === 200 || r.status === 204 || r.status === 400) telemetry.queue.splice(0, batch.length);
    } finally {
      telemetry.sending = false;
      telemetryWrite();
    }
  }
  function setTelemetryConsent(on) {
    telemetry.consent = !!on;
    if (!on) telemetry.queue = [];
    telemetryWrite();
    if (on) trackSession();
  }
  async function deleteTelemetry() {
    if (!(await showConfirm("この端末から送ったプレイ情報を、サーバーから削除します。よろしいですか?"))) return;
    telemetry.queue = [];
    if (telemetry.anonId && NETWORK_ENABLED) {
      const r = await apiRequest("/telemetry", { op: "delete", anonId: telemetry.anonId });
      if (r.status !== 200) { showToast("削除できなかった：" + cloudErrorText(r)); telemetryWrite(); return; }
    }
    telemetry.anonId = ""; // a fresh id from now on, unconnected to what was deleted
    telemetryWrite();
    showToast("送ったプレイ情報を削除した");
  }
  function trackSession() {
    track("session", {
      device: window.innerWidth < 760 ? "sp" : "pc", playMin: playMinutes(), lv: save.level, best: stat("maxCleared"),
      reinc: stat("reincarnations"), auto: save.autoPlay.on, loop: save.autoPlay.loop, speed: gameSpeed(),
    });
  }
  function trackRunEnd(cause) {
    if (!game) return;
    const cards = game.cardsPlayed || 0;
    track("run_end", {
      start: game.startFloor, end: game.floor, cleared: game.floorsCleared || 0, cause,
      sec: Math.round((performance.now() - (game.runStartedAt || performance.now())) / 1000), cards,
      autoShare: cards ? Math.round(((game.autoCardsPlayed || 0) / cards) * 100) / 100 : 0,
      lv: save.level, trials: save.activeTrials.slice(), playMin: playMinutes(),
    });
    setTimeout(() => flushTelemetry(false), 3000);
  }

  // ---- データ管理 screen ----
  const dataEl = {
    overlay: document.getElementById("dataOverlay"),
    close: document.getElementById("dataCloseBtn"),
    cloudBody: document.getElementById("cloudBody"),
    restoreBox: document.getElementById("cloudRestoreBox"),
    codeInput: document.getElementById("cloudCodeInput"),
    passInput: document.getElementById("cloudPassInput"),
    prevInput: document.getElementById("cloudPrevInput"),
    restoreBtn: document.getElementById("cloudRestoreBtn"),
    exportFile: document.getElementById("exportFileBtn"),
    exportCopy: document.getElementById("exportCopyBtn"),
    importText: document.getElementById("importText"),
    importTextBtn: document.getElementById("importTextBtn"),
    importFile: document.getElementById("importFile"),
    telemetryToggle: document.getElementById("telemetryToggle"),
    telemetryNote: document.getElementById("telemetryNote"),
    telemetryDelete: document.getElementById("telemetryDeleteBtn"),
    consent: document.getElementById("consentOverlay"),
  };
  function dataScreenOpen() { return dataEl.overlay.classList.contains("active"); }
  function renderDataScreen() {
    if (!dataScreenOpen()) return;
    const c = cloud.creds;
    let html = "";
    const net = NETWORK_ENABLED;
    if (!net) html = `<div class="cloud-status">この環境（ローカル・デバッグ）ではサーバーを使わない。公開版で使える。</div>`;
    else if (serverState === "unknown") html = `<div class="cloud-status">サーバーを確認中…</div>`;
    else if (serverState === "offline") html = `<div class="cloud-status warn">サーバーに接続できない。通信を確認して、もう一度開いてください。</div>`;
    else if (serverState === "nodb") html = `<div class="cloud-status">クラウド機能は準備中（サーバーにデータベースがまだ接続されていない）。</div>`;
    else if (!c) {
      html = `<div class="cloud-status">引き継ぎを設定すると、このセーブがクラウドに自動で保存され（10分ごと・転生したとき・閉じるとき）、
        別の端末やデータが消えたときに、引き継ぎコードとパスワードで復元できる。</div>
        <div class="data-row"><button class="btn primary" data-cloud="register"${cloud.busy ? " disabled" : ""}>引き継ぎを設定する</button></div>`;
    } else {
      const pw = cloud.showPassword ? escapeHtml(c.password) : "••••••••••";
      const last = c.lastUploadAt ? new Date(c.lastUploadAt).toLocaleString("ja-JP") : "まだ";
      html = `<div class="cloud-cred"><span class="k">引き継ぎコード</span><span class="v">${escapeHtml(c.code)}</span>
          <span class="k">パスワード</span><span class="v">${pw}</span></div>
        <div class="data-row"><button class="btn ghost" data-cloud="togglePw">${cloud.showPassword ? "パスワードを隠す" : "パスワードを表示"}</button></div>`
        + (c.ack ? "" : `<label class="data-inline cloud-ack warn"><input type="checkbox" data-cloud="ack"> コードとパスワードを控えた（控えないと、データが消えたときに戻せない）</label>`)
        + `<div class="cloud-status">最後にクラウドへ保存：${escapeHtml(last)}${c.lastError ? `<br><span class="warn">前回の保存：${escapeHtml(c.lastError)}</span>` : ""}</div>`
        + (c.superseded
          ? `<div class="cloud-status warn">このコードは別の端末で復元されたため、この端末からの自動保存は止まっている。</div>
             <div class="data-row"><button class="btn secondary" data-cloud="takeover">この端末の内容でクラウドを上書きする</button></div>`
          : `<div class="data-row"><button class="btn secondary" data-cloud="upload"${cloud.busy ? " disabled" : ""}>今すぐ保存</button></div>`)
        + `<div class="data-row"><button class="btn ghost" data-cloud="restoreOwn">クラウドから復元</button><button class="btn ghost" data-cloud="delete">クラウドのデータを削除</button></div>`;
    }
    dataEl.cloudBody.innerHTML = html;
    dataEl.restoreBox.style.display = net && serverState === "ok" ? "" : "none";
    dataEl.telemetryToggle.checked = telemetry.consent === true;
    dataEl.telemetryToggle.disabled = !net;
    dataEl.telemetryDelete.disabled = !net || !telemetry.anonId;
    dataEl.telemetryNote.textContent = !net ? "この環境（ローカル・デバッグ）では送らない。"
      : telemetry.consent === true ? `送信待ち ${telemetry.queue.length}件（5分ごと・ランの終わり・閉じるときにまとめて送る）`
      : "送っていない。";
  }
  async function openDataScreen() {
    dataEl.overlay.classList.add("active");
    renderDataScreen();
    if (NETWORK_ENABLED) { await checkServer(); renderDataScreen(); }
  }
  function closeDataScreen() {
    if (cloud.creds && !cloud.creds.ack) { showToast("引き継ぎコードとパスワードを控えて、「控えた」にチェックしてください"); return; }
    dataEl.overlay.classList.remove("active");
  }
  el.openDataBtn.addEventListener("click", openDataScreen);
  dataEl.close.addEventListener("click", closeDataScreen);
  dataEl.overlay.addEventListener("click", (e) => { if (e.target === dataEl.overlay) closeDataScreen(); });
  dataEl.cloudBody.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target.closest("[data-cloud]") : null;
    if (!t) return;
    const op = t.dataset.cloud;
    if (op === "register") cloudRegister();
    else if (op === "togglePw") { cloud.showPassword = !cloud.showPassword; renderDataScreen(); }
    else if (op === "ack") { cloud.creds.ack = t.checked; cloudCredsWrite(); setTimeout(renderDataScreen, 0); }
    else if (op === "upload") cloudUpload({ force: true }).then((ok) => showToast(ok ? "クラウドに保存した" : "保存できなかった"));
    else if (op === "takeover") cloudTakeover();
    else if (op === "restoreOwn") cloudRestore(cloud.creds.code, cloud.creds.password, false);
    else if (op === "delete") cloudDelete();
  });
  dataEl.restoreBtn.addEventListener("click", () => cloudRestore(dataEl.codeInput.value, dataEl.passInput.value, dataEl.prevInput.checked));
  dataEl.exportFile.addEventListener("click", () => { downloadText(`magia-tower-save-${exportStamp()}.txt`, currentSaveText()); showToast("セーブをファイルに保存した"); });
  dataEl.exportCopy.addEventListener("click", () => {
    const text = currentSaveText();
    const fallback = () => { dataEl.importText.value = text; dataEl.importText.select(); showToast("下の欄に書き出した。選択された文字列をコピーしてください"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => showToast("セーブの文字列をコピーした"), fallback);
    else fallback();
  });
  dataEl.importTextBtn.addEventListener("click", () => importSaveText(dataEl.importText.value));
  dataEl.importFile.addEventListener("change", () => {
    const f = dataEl.importFile.files && dataEl.importFile.files[0];
    dataEl.importFile.value = "";
    if (!f) return;
    if (f.size > SAVE_TEXT_MAX) { showToast("ファイルが大きすぎる"); return; }
    f.text().then(importSaveText, () => showToast("ファイルを読めなかった"));
  });
  dataEl.telemetryToggle.addEventListener("change", () => { setTelemetryConsent(dataEl.telemetryToggle.checked); renderDataScreen(); });
  dataEl.telemetryDelete.addEventListener("click", () => deleteTelemetry().then(renderDataScreen));
  document.getElementById("consentYesBtn").addEventListener("click", () => { dataEl.consent.classList.remove("active"); setTelemetryConsent(true); renderDataScreen(); });
  document.getElementById("consentNoBtn").addEventListener("click", () => { dataEl.consent.classList.remove("active"); setTelemetryConsent(false); renderDataScreen(); });

