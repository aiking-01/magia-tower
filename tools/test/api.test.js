// api/ against the fake Upstash: cloud saves (register/save/info/restore/takeover/delete, lockout, generations),
// telemetry (validation, delete), admin (auth, stats, export), and the "not configured" path
const { startDevServer } = require("../devserver");

module.exports = async (t) => {
  const dev = await startDevServer(0);
  const base = `http://127.0.0.1:${dev.port}/api`;
  const post = async (p, body) => {
    const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    let data = {};
    try { data = await r.json(); } catch (e) { /* 204 */ }
    return { status: r.status, data };
  };
  try {
    let r = await fetch(base + "/health");
    t.ok((await r.json()).db === true, "health should report the database");

    // ---- cloud ----
    const reg = await post("/cloud", { op: "register" });
    t.ok(reg.status === 200 && /^MT-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(reg.data.code) && reg.data.password.length === 10, "register: " + JSON.stringify(reg));
    const { code, password } = reg.data;
    const save1 = JSON.stringify({ level: 5, points: 10 });
    r = await post("/cloud", { op: "save", code, password, generation: 1, data: save1, meta: { level: 5, best: 9 } });
    t.ok(r.status === 200, "first save: " + r.status);
    r = await post("/cloud", { op: "save", code, password, generation: 1, data: JSON.stringify({ level: 6 }), meta: { level: 6 } });
    t.ok(r.status === 200, "second save: " + r.status);
    r = await post("/cloud", { op: "info", code, password });
    t.ok(r.status === 200 && r.data.latest.meta.level === 6 && r.data.previous.meta.level === 5, "info should keep latest + previous: " + JSON.stringify(r.data));
    r = await post("/cloud", { op: "save", code, password, generation: 1, data: "not json" });
    t.ok(r.status === 400, "non-JSON save must be refused: " + r.status);
    r = await post("/cloud", { op: "save", code, password, generation: 1, data: JSON.stringify({ x: "y".repeat(300 * 1024) }) });
    t.ok(r.status === 400 || r.status === 413, "oversized save must be refused: " + r.status);
    r = await post("/cloud", { op: "info", code: code.toLowerCase().replace(/-/g, " "), password: password.toLowerCase() });
    t.ok(r.status === 200, "code/password should be case- and separator-insensitive: " + r.status);
    // wrong password -> 401, ten of them lock the code
    for (let i = 0; i < 9; i++) await post("/cloud", { op: "info", code, password: "WRONGWRONG" });
    r = await post("/cloud", { op: "info", code, password: "WRONGWRONG" });
    t.ok(r.status === 401, "10th miss should still be 401: " + r.status);
    r = await post("/cloud", { op: "info", code, password });
    t.ok(r.status === 429, "after 10 misses the code must be locked: " + r.status);
    // unlock by hand (time travel) and continue
    dev.fake.store.run(["HSET", "ac:" + code, "lockUntil", 0]);
    r = await post("/cloud", { op: "restore", code, password, slot: "previous" });
    t.ok(r.status === 200 && JSON.parse(r.data.data).level === 5 && r.data.generation === 2, "restore previous: " + JSON.stringify(r.data).slice(0, 120));
    r = await post("/cloud", { op: "save", code, password, generation: 1, data: save1 });
    t.ok(r.status === 409 && r.data.generation === 2, "a superseded device must get 409: " + r.status);
    r = await post("/cloud", { op: "takeover", code, password });
    t.ok(r.status === 200 && r.data.generation === 3, "takeover bumps the generation: " + JSON.stringify(r.data));
    r = await post("/cloud", { op: "delete", code, password });
    t.ok(r.status === 200, "delete: " + r.status);
    r = await post("/cloud", { op: "info", code, password });
    t.ok(r.status === 404, "after delete the code is gone: " + r.status);
    r = await post("/cloud", { op: "nope", code: "x" });
    t.ok(r.status === 400, "unknown op / bad code: " + r.status);

    // ---- telemetry ----
    const anonId = "a".repeat(32);
    const ev = (type, d) => ({ t: Date.now(), type, d });
    r = await post("/telemetry", { op: "send", anonId, sessionId: "b".repeat(16), version: "test", events: [ev("session", { device: "pc" }), ev("run_end", { cause: "defeat", end: 42, sec: 60, cards: 30, autoShare: 1 }), ev("first_clear", { playMin: 70, runs: 12 }), ev("milestone", { floor: 10, playMin: 3 })] });
    t.ok(r.status === 204, "telemetry send: " + r.status);
    r = await post("/telemetry", { op: "send", anonId, events: [ev("hack", {})] });
    t.ok(r.status === 400, "unknown event type must be refused: " + r.status);
    r = await post("/telemetry", { op: "send", anonId, events: Array.from({ length: 51 }, () => ev("auto", {})) });
    t.ok(r.status === 400, "batches over 50 must be refused: " + r.status);
    r = await post("/telemetry", { op: "send", anonId: "nothex", events: [ev("auto", {})] });
    t.ok(r.status === 400, "bad anonId must be refused: " + r.status);
    r = await post("/telemetry", { op: "send", anonId, events: [ev("auto", { pad: "x".repeat(2000) })] });
    t.ok(r.status === 400, "an oversized event must be refused: " + r.status);

    // ---- admin ----
    r = await fetch(base + "/admin?op=stats");
    t.ok(r.status === 401, "admin without token: " + r.status);
    r = await fetch(base + "/admin?op=stats&fresh=1", { headers: { authorization: "Bearer " + process.env.ADMIN_TOKEN } });
    const stats = await r.json();
    t.ok(r.status === 200 && stats.players === 1 && stats.firstClearMinutes.median === 70 && stats.defeatsByFloor[0][0] === "42", "admin stats: " + JSON.stringify(stats).slice(0, 200));
    r = await fetch(base + "/admin?op=export", { headers: { authorization: "Bearer " + process.env.ADMIN_TOKEN } });
    const exp = await r.json();
    t.ok(r.status === 200 && exp.total === 1 && exp.rows[0].a === anonId, "admin export: " + JSON.stringify(exp).slice(0, 120));

    r = await post("/telemetry", { op: "delete", anonId });
    t.ok(r.status === 200 && r.data.removed === 1, "telemetry delete: " + JSON.stringify(r.data));

    // ---- not configured: health says db:false, everything else 503 ----
    const keep = [process.env.KV_REST_API_URL, process.env.KV_REST_API_TOKEN];
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    r = await fetch(base + "/health");
    t.ok((await r.json()).db === false, "health without a database");
    r = await post("/cloud", { op: "register" });
    t.ok(r.status === 503, "cloud without a database must be 503: " + r.status);
    [process.env.KV_REST_API_URL, process.env.KV_REST_API_TOKEN] = keep;
    t.log(`fake Redis commands used: ${dev.fake.store.commands}`);
  } finally {
    await dev.close();
  }
};
