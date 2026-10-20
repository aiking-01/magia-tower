// An in-memory stand-in for Upstash Redis's REST API (POST / with one command, POST /pipeline with several),
// covering just the commands api/ uses. Lets the tests and tools/devserver.js run the real api/ code unchanged.
const http = require("http");

function createStore() {
  const data = new Map(); // key -> { type: "str"|"hash"|"list", v, exp }
  let commands = 0;
  const live = (k) => {
    const e = data.get(k);
    if (e && e.exp && e.exp <= Date.now()) { data.delete(k); return undefined; }
    return e;
  };
  const get = (k, type) => {
    const e = live(k);
    if (e && type && e.type !== type) throw new Error("WRONGTYPE");
    return e;
  };
  const normIndex = (i, len) => { i = Number(i); return i < 0 ? Math.max(0, len + i) : i; };
  function run(cmd) {
    commands += 1;
    const [name, ...a] = cmd;
    const op = String(name).toUpperCase();
    switch (op) {
      case "PING": return "PONG";
      case "GET": { const e = get(a[0], "str"); return e ? e.v : null; }
      case "SET": {
        const opts = a.slice(2).map((x) => String(x).toUpperCase());
        if (opts.includes("NX") && live(a[0])) return null;
        const exIdx = opts.indexOf("EX");
        data.set(a[0], { type: "str", v: String(a[1]), exp: exIdx >= 0 ? Date.now() + Number(a[2 + exIdx + 1]) * 1000 : 0 });
        return "OK";
      }
      case "DEL": return a.reduce((n, k) => n + (live(k) && data.delete(k) ? 1 : 0), 0);
      case "EXISTS": return a.reduce((n, k) => n + (live(k) ? 1 : 0), 0);
      case "EXPIRE": { const e = live(a[0]); if (!e) return 0; e.exp = Date.now() + Number(a[1]) * 1000; return 1; }
      case "TTL": { const e = live(a[0]); if (!e) return -2; return e.exp ? Math.ceil((e.exp - Date.now()) / 1000) : -1; }
      case "INCR": case "INCRBY": {
        const e = get(a[0], "str");
        const v = (e ? Number(e.v) : 0) + (op === "INCR" ? 1 : Number(a[1]));
        data.set(a[0], { type: "str", v: String(v), exp: e ? e.exp : 0 });
        return v;
      }
      case "RENAME": {
        const e = live(a[0]);
        if (!e) throw new Error("ERR no such key");
        data.delete(a[0]);
        data.set(a[1], e);
        return "OK";
      }
      case "HSET": case "HSETNX": {
        let e = get(a[0], "hash");
        if (!e) { e = { type: "hash", v: {}, exp: 0 }; data.set(a[0], e); }
        if (op === "HSETNX") { if (a[1] in e.v) return 0; e.v[a[1]] = String(a[2]); return 1; }
        let added = 0;
        for (let i = 1; i + 1 < a.length; i += 2) { if (!(a[i] in e.v)) added += 1; e.v[a[i]] = String(a[i + 1]); }
        return added;
      }
      case "HGET": { const e = get(a[0], "hash"); return e && a[1] in e.v ? e.v[a[1]] : null; }
      case "HGETALL": { const e = get(a[0], "hash"); return e ? Object.entries(e.v).flat() : []; }
      case "HINCRBY": {
        let e = get(a[0], "hash");
        if (!e) { e = { type: "hash", v: {}, exp: 0 }; data.set(a[0], e); }
        const v = Number(e.v[a[1]] || 0) + Number(a[2]);
        e.v[a[1]] = String(v);
        return v;
      }
      case "RPUSH": {
        let e = get(a[0], "list");
        if (!e) { e = { type: "list", v: [], exp: 0 }; data.set(a[0], e); }
        a.slice(1).forEach((x) => e.v.push(String(x)));
        return e.v.length;
      }
      case "LLEN": { const e = get(a[0], "list"); return e ? e.v.length : 0; }
      case "LRANGE": {
        const e = get(a[0], "list");
        if (!e) return [];
        const len = e.v.length;
        const s = normIndex(a[1], len);
        const t = Math.min(len - 1, normIndex(a[2], len));
        return s > t ? [] : e.v.slice(s, t + 1);
      }
      case "LTRIM": {
        const e = get(a[0], "list");
        if (!e) return "OK";
        const len = e.v.length;
        const s = normIndex(a[1], len);
        const t = Math.min(len - 1, normIndex(a[2], len));
        e.v = s > t ? [] : e.v.slice(s, t + 1);
        return "OK";
      }
      case "LREM": {
        const e = get(a[0], "list");
        if (!e) return 0;
        const before = e.v.length;
        e.v = e.v.filter((x) => x !== String(a[2]));
        return before - e.v.length;
      }
      default: throw new Error("ERR unknown command " + op);
    }
  }
  return {
    run,
    data,
    get commands() { return commands; },
    exec(cmd) { try { return { result: run(cmd) }; } catch (e) { return { error: e.message }; } },
  };
}

// starts the fake on a free port; resolves to { url, token, store, close() }
function startFakeUpstash(port) {
  const store = createStore();
  const token = "fake-token";
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.headers.authorization !== "Bearer " + token) { res.statusCode = 401; return res.end(JSON.stringify({ error: "Unauthorized" })); }
      let parsed;
      try { parsed = JSON.parse(body); } catch (e) { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad json" })); }
      if (req.url.startsWith("/pipeline")) return res.end(JSON.stringify(parsed.map((c) => store.exec(c))));
      const r = store.exec(parsed);
      if (r.error) res.statusCode = 400;
      return res.end(JSON.stringify(r));
    });
  });
  return new Promise((resolve) => {
    server.listen(port || 0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      resolve({ url, token, store, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

module.exports = { startFakeUpstash, createStore };
