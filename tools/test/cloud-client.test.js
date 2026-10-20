// the game's side of the server: consent dialog, play data queued and sent, cloud transfer between two "devices",
// local export/import, and the save safety (escaping, coercion, broken-save backup)
const { create, mulberry32 } = require("../lib/harness");
const { startDevServer } = require("../devserver");

const ORIGIN = "https://magia-tower-f.vercel.app"; // not localhost: the game talks to the server only off localhost

module.exports = async (t) => {
  const dev = await startDevServer(0);
  const devBase = `http://127.0.0.1:${dev.port}/`;
  // the page's AbortSignal comes from jsdom, which Node's fetch rejects: drop it (the dev server answers at once)
  const routedFetch = (url, init) => {
    const i = Object.assign({}, init);
    delete i.signal;
    return fetch(new URL(String(url).replace(/^https?:\/\/[^/]+\//, ""), devBase), i);
  };
  try {
    // ---- consent + play data ----
    let h = create(JSON.stringify({ unlockedNodes: { root: true }, autoPlay: { on: true, loop: false, speed: 1 } }), { origin: ORIGIN, fetch: routedFetch, random: mulberry32(9) });
    let g = h.g;
    const consent = h.w.document.getElementById("consentOverlay");
    t.ok(consent.classList.contains("active"), "the consent dialog should open on first launch");
    h.w.document.getElementById("consentYesBtn").click();
    t.ok(!consent.classList.contains("active"), "consent dialog should close");
    g.newRun(1);
    await h.flush(3 * 60 * 1000); // AUTO plays until defeat; run_end flushes 3s later
    await h.flush(6 * 60 * 1000); // the 5-minute flush too
    await new Promise((r) => setTimeout(r, 300));
    await h.flush(1000);
    const months = [...dev.fake.store.data.keys()].filter((k) => k.startsWith("ev:"));
    const stored = months.flatMap((k) => dev.fake.store.data.get(k).v.map((x) => JSON.parse(x)));
    const types = stored.flatMap((b) => b.e.map((e) => e.type));
    t.ok(types.includes("session") && types.includes("run_end"), "session + run_end should reach the server: " + types.join(","));
    const runEnd = stored.flatMap((b) => b.e).find((e) => e.type === "run_end");
    t.ok(runEnd && runEnd.d.cause === "defeat" && runEnd.d.cards > 0 && runEnd.d.autoShare === 1, "run_end payload: " + JSON.stringify(runEnd));
    t.ok(h.errors.length === 0, "errors: " + h.errors.slice(0, 3).join(" | "));

    // declining: nothing is queued or sent
    h = create(null, { origin: ORIGIN, fetch: routedFetch });
    h.w.document.getElementById("consentNoBtn").click();
    const before = dev.fake.store.commands;
    h.g.newRun(1);
    await h.flush(60 * 1000);
    t.ok(JSON.parse(h.w.localStorage.getItem("magiaTower.telemetry.v1")).queue.length === 0, "declined: nothing queued");
    t.ok(dev.fake.store.commands === before, "declined: nothing sent");

    // localhost never talks to the server, and never asks
    h = create(null, { fetch: routedFetch });
    t.ok(!h.w.document.getElementById("consentOverlay").classList.contains("active"), "no consent dialog on localhost");

    // ---- cloud: device A sets up the transfer, device B restores, A is superseded ----
    const deviceA = create(JSON.stringify({ level: 77, points: 1234, unlockedNodes: { root: true }, stats: { maxCleared: 50 } }), { origin: ORIGIN, fetch: routedFetch, storage: { "magiaTower.telemetry.v1": JSON.stringify({ consent: false }) } });
    const da = deviceA.w.document;
    da.getElementById("openDataBtn").click();
    await deviceA.flush(500); await new Promise((r) => setTimeout(r, 100)); await deviceA.flush(500);
    const regBtn = da.querySelector("[data-cloud=register]");
    t.ok(!!regBtn, "data screen should offer 引き継ぎを設定する");
    regBtn.click();
    for (let i = 0; i < 20 && !deviceA.w.localStorage.getItem("magiaTower.cloud.v1"); i++) { await new Promise((r) => setTimeout(r, 50)); await deviceA.flush(100); }
    await new Promise((r) => setTimeout(r, 200)); await deviceA.flush(200);
    const creds = JSON.parse(deviceA.w.localStorage.getItem("magiaTower.cloud.v1") || "{}");
    t.ok(/^MT-/.test(creds.code) && creds.lastUploadAt > 0, "register + first upload: " + JSON.stringify(creds));
    da.getElementById("dataCloseBtn").click();
    t.ok(da.getElementById("dataOverlay").classList.contains("active"), "the data screen must stay open until the code is noted");
    const ack = da.querySelector("[data-cloud=ack]");
    ack.checked = true;
    ack.dispatchEvent(new deviceA.w.Event("click", { bubbles: true }));
    await deviceA.flush(10);
    da.getElementById("dataCloseBtn").click();
    t.ok(!da.getElementById("dataOverlay").classList.contains("active"), "after noting it, the data screen closes");
    t.ok(!JSON.stringify(JSON.parse(deviceA.w.localStorage.getItem("magiaTower.save.v2"))).includes(creds.password), "the password must not be inside the save");

    const deviceB = create(JSON.stringify({ level: 2 }), { origin: ORIGIN, fetch: routedFetch, storage: { "magiaTower.telemetry.v1": JSON.stringify({ consent: false }) } });
    const db = deviceB.w.document;
    db.getElementById("openDataBtn").click();
    await deviceB.flush(500); await new Promise((r) => setTimeout(r, 100)); await deviceB.flush(500);
    db.getElementById("cloudCodeInput").value = creds.code.toLowerCase();
    db.getElementById("cloudPassInput").value = creds.password;
    db.getElementById("cloudRestoreBtn").click();
    for (let i = 0; i < 20 && !db.getElementById("confirmOverlay").classList.contains("active"); i++) { await new Promise((r) => setTimeout(r, 50)); await deviceB.flush(50); }
    t.ok(db.getElementById("confirmOverlay").classList.contains("active"), "restore should ask before overwriting");
    db.getElementById("confirmOkBtn").click();
    for (let i = 0; i < 20 && JSON.parse(deviceB.w.localStorage.getItem("magiaTower.save.v2") || "{}").level !== 77; i++) { await new Promise((r) => setTimeout(r, 50)); await deviceB.flush(50); }
    const restored = JSON.parse(deviceB.w.localStorage.getItem("magiaTower.save.v2"));
    t.ok(restored.level === 77 && restored.points === 1234, "device B should hold A's save: Lv" + restored.level);
    const credsB = JSON.parse(deviceB.w.localStorage.getItem("magiaTower.cloud.v1") || "{}");
    t.ok(credsB.generation === 2 && credsB.ack === true, "device B takes over with generation 2: " + JSON.stringify(credsB));
    // A tries to upload: superseded
    deviceA.g.save.points = 99999;
    deviceA.g.persistSave();
    const ok = await deviceA.w.eval("void 0") || await deviceA.g.cloud; // keep the linter quiet
    da.getElementById("openDataBtn").click();
    await deviceA.flush(300); await new Promise((r) => setTimeout(r, 100)); await deviceA.flush(300);
    da.querySelector("[data-cloud=upload]").click();
    for (let i = 0; i < 20 && !JSON.parse(deviceA.w.localStorage.getItem("magiaTower.cloud.v1")).superseded; i++) { await new Promise((r) => setTimeout(r, 50)); await deviceA.flush(50); }
    t.ok(JSON.parse(deviceA.w.localStorage.getItem("magiaTower.cloud.v1")).superseded === true, "device A must stop after B restored");
    t.ok(!!da.querySelector("[data-cloud=takeover]"), "device A should offer to take over");
    void ok;

    // ---- local export / import ----
    const exporter = create(JSON.stringify({ level: 33, points: 5, unlockedNodes: { root: true } }));
    const text = exporter.g.encodeSaveText(JSON.parse(exporter.w.localStorage.getItem("magiaTower.save.v2")));
    t.ok(text.startsWith("MT2:"), "export format");
    t.ok(exporter.g.decodeSaveText(text).level === 33, "round trip");
    let threw = false;
    try { exporter.g.decodeSaveText("MT2:!!!!"); } catch (e) { threw = true; }
    t.ok(threw, "garbage must be refused");

    // ---- save safety: escaped card names, coerced numbers, clamped tiers, broken save kept ----
    const evil = JSON.stringify({
      level: "12", points: "7", unlockedNodes: { root: 1 },
      deckDefs: [{ type: "attack", name: "<img src=x onerror=alert(1)>", value: "15", count: "9", rank: "<b>x</b>" }],
      panelLevels: { panelAtk: 1e9 }, items: { dragonHeart: 999 },
    });
    const hv = create(evil);
    t.ok(hv.g.save.level === 12 && hv.g.save.points === 7, "numbers coerced");
    t.ok(hv.g.save.deckDefs[0].rank === 0 && hv.g.save.deckDefs[0].count === 9, "card numbers coerced: " + JSON.stringify(hv.g.save.deckDefs[0]));
    t.ok(hv.g.save.panelLevels.panelAtk === 20, "panel tier clamped: " + hv.g.save.panelLevels.panelAtk);
    t.ok(hv.g.save.items.dragonHeart <= 5, "秘宝 count clamped: " + hv.g.save.items.dragonHeart);
    hv.g.newRun(1);
    await hv.flush(400);
    t.ok(!hv.w.document.querySelector("#hand img"), "a card name must never become HTML");
    t.ok(hv.w.document.getElementById("hand").textContent.includes("<img src=x"), "the name is shown as text");
    hv.w.eval('document.getElementById("openDeckUpgradeBtn").click()');
    t.ok(!hv.w.document.querySelector("#deckZoneList img"), "deck screen must escape the name too");

    const broken = create("{not json");
    t.ok(broken.w.localStorage.getItem("magiaTower.save.v2.broken") === "{not json", "a save that fails to load must be kept aside");
  } finally {
    await dev.close();
  }
};
