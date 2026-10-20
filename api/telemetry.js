// POST /api/telemetry
//   { op: "send", anonId, sessionId, version, events: [{ t, type, d }] }  -> 204   (only with the player's consent)
//   { op: "delete", anonId }                                              -> { ok, removed }
// A batch is stored as one list entry in ev:<yyyymm> (one Redis command per request), capped per month; months
// older than three are dropped by the admin stats call. Only known event types, small payloads, no IP stored.
const { redis, pipeline } = require("./_lib/redis");
const { send, readBody, clientKey, dayStamp, monthStamp, withinLimit, handler, fail } = require("./_lib/http");

const TYPES = new Set(["session", "run_end", "milestone", "first_clear", "reincarnate", "trial", "item", "auto"]);
const BATCH_MAX = 50;
const EVENT_MAX = 1024; // bytes of JSON per event
const MONTH_CAP = 20000; // list entries (batches) kept per month
const EVENTS_PER_ID_PER_DAY = 2000;
const REQUESTS_PER_IP_PER_DAY = 400;

const isHex = (v, n) => typeof v === "string" && new RegExp(`^[0-9a-f]{${n}}$`).test(v);

function cleanEvents(list) {
  if (!Array.isArray(list) || !list.length || list.length > BATCH_MAX) throw fail(400, "bad events");
  return list.map((e) => {
    if (!e || typeof e !== "object" || !TYPES.has(e.type)) throw fail(400, "bad event");
    const d = e.d && typeof e.d === "object" && !Array.isArray(e.d) ? e.d : {};
    const out = { t: Number.isFinite(Number(e.t)) ? Number(e.t) : 0, type: e.type, d };
    if (JSON.stringify(out).length > EVENT_MAX) throw fail(400, "event too large");
    return out;
  });
}

module.exports = handler(["POST"], async (req, res) => {
  const body = await readBody(req);
  if (!isHex(body.anonId, 32)) throw fail(400, "bad id");
  if (body.op === "delete") {
    // walk the months that can still hold this id and remove its batches
    let removed = 0;
    const now = new Date();
    for (let m = 0; m < 4; m++) {
      const key = "ev:" + monthStamp(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1)));
      const len = Number(await redis("LLEN", key)) || 0;
      const mine = [];
      for (let start = 0; start < len; start += 1000) {
        const chunk = (await redis("LRANGE", key, start, start + 999)) || [];
        chunk.forEach((raw) => { try { if (JSON.parse(raw).a === body.anonId) mine.push(raw); } catch (e) { /* skip */ } });
      }
      if (mine.length) {
        const results = await pipeline(mine.map((raw) => ["LREM", key, 0, raw]));
        removed += results.reduce((n, r) => n + (Number(r) || 0), 0);
      }
    }
    return send(res, 200, { ok: true, removed });
  }
  if (body.op !== "send") throw fail(400, "unknown op");
  const events = cleanEvents(body.events);
  if (!(await withinLimit(`telip:${clientKey(req)}`, REQUESTS_PER_IP_PER_DAY, 86400))) throw fail(429, "too many");
  if (!(await withinLimit(`tel:${body.anonId}:${dayStamp()}`, EVENTS_PER_ID_PER_DAY, 86400, events.length))) throw fail(429, "too many");
  const entry = JSON.stringify({
    a: body.anonId,
    s: isHex(body.sessionId, 16) ? body.sessionId : "",
    v: String(body.version || "").slice(0, 20),
    t: Date.now(),
    e: events,
  });
  const key = "ev:" + monthStamp();
  const cmds = [["RPUSH", key, entry]];
  if (Math.random() < 0.05) cmds.push(["LTRIM", key, -MONTH_CAP, -1]); // keep the newest MONTH_CAP batches
  await pipeline(cmds);
  res.statusCode = 204;
  res.end();
});
