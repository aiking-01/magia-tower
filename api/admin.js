// GET /api/admin?op=stats               -> aggregated play data of the last 3 months (cached 5 minutes)
// GET /api/admin?op=export&month=YYYYMM&offset=0&limit=1000 -> raw batches of one month
// Needs "Authorization: Bearer <ADMIN_TOKEN>" (an environment variable set on Vercel). Misses are capped per IP.
const crypto = require("crypto");
const { redis, pipeline } = require("./_lib/redis");
const { send, clientKey, dayStamp, monthStamp, withinLimit, handler, fail } = require("./_lib/http");

const MONTHS_KEPT = 3;
const CACHE_SEC = 300;

function authorized(req) {
  const want = process.env.ADMIN_TOKEN || "";
  const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (want.length < 12 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
function monthKeys(back) {
  const now = new Date();
  return Array.from({ length: back }, (_, m) => "ev:" + monthStamp(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1))));
}
async function readMonth(key) {
  const len = Number(await redis("LLEN", key)) || 0;
  const out = [];
  for (let start = 0; start < len; start += 1000) {
    const chunk = (await redis("LRANGE", key, start, start + 999)) || [];
    chunk.forEach((raw) => { try { out.push(JSON.parse(raw)); } catch (e) { /* skip */ } });
  }
  return out;
}
function quantiles(list) {
  const a = list.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return { n: 0 };
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + 0.5))];
  return { n: a.length, p25: q(0.25), median: q(0.5), p75: q(0.75), max: a[a.length - 1] };
}
function bump(map, key, n) { map[key] = (map[key] || 0) + (n || 1); }

// everything the 集計 page shows; pure function of the stored batches so it is easy to test
function aggregate(batches) {
  const players = new Set();
  const sessions = new Set();
  const versions = {};
  const byType = {};
  const devices = {};
  const firstClear = [];
  const firstClearRuns = [];
  const milestones = {};
  const defeats = {};
  const runSecs = [];
  const runCards = [];
  const autoShares = [];
  const trials = {};
  const reinc = { lv: [], playMin: [] };
  const items = {};
  const causes = {};
  batches.forEach((b) => {
    players.add(b.a);
    if (b.s) sessions.add(b.s);
    (b.e || []).forEach((ev) => {
      const d = ev.d || {};
      bump(byType, ev.type);
      if (ev.type === "session") { if (b.v) versions[b.v] = (versions[b.v] || new Set()).add(b.a); bump(devices, d.device || "?"); }
      else if (ev.type === "first_clear") { firstClear.push(Number(d.playMin)); firstClearRuns.push(Number(d.runs)); }
      else if (ev.type === "milestone") (milestones[d.floor] = milestones[d.floor] || []).push(Number(d.playMin));
      else if (ev.type === "run_end") {
        bump(causes, d.cause || "?");
        runSecs.push(Number(d.sec));
        runCards.push(Number(d.cards));
        autoShares.push(Number(d.autoShare));
        if (d.cause === "defeat" || d.cause === "stuck") {
          const f = Number(d.end) || 0;
          bump(defeats, f <= 100 ? String(f) : `${Math.floor((f - 1) / 100) * 100 + 1}〜${Math.floor((f - 1) / 100) * 100 + 100}`);
        }
      } else if (ev.type === "trial") {
        (Array.isArray(d.ids) ? d.ids : []).forEach((id) => { trials[id] = trials[id] || { start: 0, clear: 0, abandon: 0 }; bump(trials[id], d.op); });
      } else if (ev.type === "reincarnate") { reinc.lv.push(Number(d.lv)); reinc.playMin.push(Number(d.playMin)); }
      else if (ev.type === "item") bump(items, String(d.id));
    });
  });
  const autoRuns = autoShares.filter((v) => v >= 0.5).length;
  return {
    players: players.size,
    sessions: sessions.size,
    events: byType,
    versions: Object.fromEntries(Object.entries(versions).map(([k, set]) => [k, set.size])),
    devices,
    firstClearMinutes: quantiles(firstClear),
    firstClearRuns: quantiles(firstClearRuns),
    milestoneMinutes: Object.fromEntries(Object.keys(milestones).sort((a, b) => a - b).map((f) => [f, quantiles(milestones[f])])),
    defeatsByFloor: Object.entries(defeats).sort((a, b) => b[1] - a[1]).slice(0, 30),
    runEndCauses: causes,
    runSeconds: quantiles(runSecs),
    runCards: quantiles(runCards),
    autoRunShare: autoShares.length ? Math.round((autoRuns / autoShares.length) * 100) / 100 : 0,
    trials,
    reincarnation: { level: quantiles(reinc.lv), playMinutes: quantiles(reinc.playMin) },
    items,
  };
}

module.exports = handler(["GET"], async (req, res) => {
  const missKey = `adminmiss:${clientKey(req)}:${dayStamp()}`;
  if ((Number(await redis("GET", "rl:" + missKey)) || 0) >= 20) throw fail(429, "too many attempts");
  if (!authorized(req)) {
    await withinLimit(missKey, 20, 86400);
    throw fail(401, "unauthorized");
  }
  const url = new URL(req.url, "http://x");
  const op = url.searchParams.get("op") || "stats";
  if (op === "export") {
    const month = url.searchParams.get("month") || monthStamp();
    if (!/^\d{6}$/.test(month)) throw fail(400, "bad month");
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit")) || 1000));
    const [total, rows] = await pipeline([["LLEN", "ev:" + month], ["LRANGE", "ev:" + month, offset, offset + limit - 1]]);
    return send(res, 200, { month, offset, total: Number(total) || 0, rows: (rows || []).map((r) => { try { return JSON.parse(r); } catch (e) { return null; } }).filter(Boolean) });
  }
  if (op !== "stats") throw fail(400, "unknown op");
  const cached = await redis("GET", "stats:cache");
  if (cached && url.searchParams.get("fresh") !== "1") return send(res, 200, JSON.parse(cached));
  // drop months past the retention window (cheap: one DEL over the keys that could exist)
  const keep = monthKeys(MONTHS_KEPT);
  const old = monthKeys(15).slice(MONTHS_KEPT);
  await redis("DEL", ...old);
  let batches = [];
  for (const key of keep) batches = batches.concat(await readMonth(key));
  const stats = Object.assign({ generatedAt: Date.now(), months: keep.map((k) => k.slice(3)), batches: batches.length }, aggregate(batches));
  await redis("SET", "stats:cache", JSON.stringify(stats), "EX", CACHE_SEC);
  return send(res, 200, stats);
});
module.exports.aggregate = aggregate;
