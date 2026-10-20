// POST /api/cloud { op, … }: クラウドセーブ（引き継ぎコード＋パスワード）
//   register                      -> { code, password, generation }
//   save     code password generation data meta -> { ok, generation, updatedAt } | 409 (another device restored it)
//   info     code password        -> { latest, previous, generation }   (meta only, no save data)
//   restore  code password slot   -> { data, generation, updatedAt }    (bumps the generation: this device takes over)
//   takeover code password        -> { generation }                     (a superseded device pushes its own save)
//   delete   code password        -> { ok }
// Keys: ac:<code> (hash: salt, hash, gen, created, fails, lockUntil), sv:<code> and sv:<code>:prev (JSON string).
// Everything expires a year after the last save, so abandoned codes free their space.
const crypto = require("crypto");
const { redis, pipeline, hashToObject } = require("./_lib/redis");
const { send, readBody, clientKey, dayStamp, withinLimit, handler, fail } = require("./_lib/http");

const SAVE_MAX = 256 * 1024;
const KEEP_SEC = 365 * 24 * 3600;
const LOCK_FAILS = 10;
const LOCK_MS = 60 * 60 * 1000;
// Crockford base32 without I L O U: nothing that reads as another character
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomString(n) {
  const bytes = crypto.randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i++) out += ALPHABET[bytes[i] % 32];
  return out;
}
function normalizeCode(v) {
  const raw = String(v || "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^MT/, "");
  return /^[0-9A-Z]{8}$/.test(raw) ? `MT-${raw.slice(0, 4)}-${raw.slice(4)}` : "";
}
function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key.toString("hex"))));
  });
}

// checks code + password with a per-code lockout (10 misses -> 1 hour) and a per-IP daily cap on misses
async function authenticate(req, body) {
  const code = normalizeCode(body.code);
  if (!code || typeof body.password !== "string") throw fail(400, "bad request");
  const ip = clientKey(req);
  const acc = hashToObject(await redis("HGETALL", "ac:" + code));
  if (!acc.salt) {
    if (!(await withinLimit(`authmiss:${ip}:${dayStamp()}`, 50, 86400))) throw fail(429, "too many attempts");
    throw fail(404, "not found");
  }
  if (Number(acc.lockUntil || 0) > Date.now()) throw fail(429, "locked");
  const hash = await hashPassword(body.password.trim().toUpperCase(), acc.salt);
  const ok = hash.length === String(acc.hash).length && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(String(acc.hash)));
  if (!ok) {
    const fails = Number(acc.fails || 0) + 1;
    const cmds = [["HSET", "ac:" + code, "fails", fails >= LOCK_FAILS ? 0 : fails]];
    if (fails >= LOCK_FAILS) cmds.push(["HSET", "ac:" + code, "lockUntil", Date.now() + LOCK_MS]);
    await pipeline(cmds);
    if (!(await withinLimit(`authmiss:${ip}:${dayStamp()}`, 50, 86400))) throw fail(429, "too many attempts");
    throw fail(401, "wrong password");
  }
  if (Number(acc.fails || 0) > 0) await redis("HSET", "ac:" + code, "fails", 0);
  return { code, acc, generation: Number(acc.gen || 1) };
}
function slotInfo(raw) {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    return { updatedAt: s.updatedAt, meta: s.meta || {}, size: (s.data || "").length };
  } catch (e) { return null; }
}
function cleanMeta(m) {
  const o = m && typeof m === "object" ? m : {};
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return { level: num(o.level), best: num(o.best), reinc: num(o.reinc), version: String(o.version || "").slice(0, 20) };
}

module.exports = handler(["POST"], async (req, res) => {
  const body = await readBody(req);
  const op = body.op;
  if (op === "register") {
    if (!(await withinLimit(`register:${clientKey(req)}:${dayStamp()}`, 10, 86400))) throw fail(429, "too many");
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `MT-${randomString(4)}-${randomString(4)}`;
      const password = randomString(10);
      const salt = crypto.randomBytes(16).toString("hex");
      const created = await redis("HSETNX", "ac:" + code, "salt", salt);
      if (Number(created) !== 1) continue; // that code is taken: draw another
      const hash = await hashPassword(password, salt);
      await pipeline([
        ["HSET", "ac:" + code, "hash", hash, "gen", 1, "created", Date.now(), "fails", 0],
        ["EXPIRE", "ac:" + code, KEEP_SEC],
      ]);
      return send(res, 200, { code, password, generation: 1 });
    }
    throw fail(503, "busy");
  }

  const { code, generation } = await authenticate(req, body);
  if (op === "save") {
    if (Number(body.generation) !== generation) return send(res, 409, { error: "superseded", generation });
    const data = body.data;
    if (typeof data !== "string" || !data) throw fail(400, "bad request");
    if (data.length > SAVE_MAX) throw fail(413, "too large");
    JSON.parse(data); // a save is JSON text; refuse anything else
    if (!(await withinLimit(`save:${code}:${Math.floor(Date.now() / 20000)}`, 3, 40))) throw fail(429, "too often");
    const updatedAt = Date.now();
    const record = JSON.stringify({ data, meta: cleanMeta(body.meta), updatedAt, gen: generation });
    const exists = await redis("EXISTS", "sv:" + code);
    const cmds = [];
    if (Number(exists) === 1) cmds.push(["RENAME", "sv:" + code, "sv:" + code + ":prev"], ["EXPIRE", "sv:" + code + ":prev", KEEP_SEC]);
    cmds.push(["SET", "sv:" + code, record, "EX", KEEP_SEC], ["EXPIRE", "ac:" + code, KEEP_SEC]);
    await pipeline(cmds);
    return send(res, 200, { ok: true, generation, updatedAt });
  }
  if (op === "info") {
    const [latest, previous] = await pipeline([["GET", "sv:" + code], ["GET", "sv:" + code + ":prev"]]);
    return send(res, 200, { latest: slotInfo(latest), previous: slotInfo(previous), generation });
  }
  if (op === "restore") {
    const key = "sv:" + code + (body.slot === "previous" ? ":prev" : "");
    const raw = await redis("GET", key);
    if (!raw) throw fail(404, "no save");
    const rec = JSON.parse(raw);
    const next = await redis("HINCRBY", "ac:" + code, "gen", 1);
    return send(res, 200, { data: rec.data, updatedAt: rec.updatedAt, generation: Number(next) });
  }
  if (op === "takeover") {
    const next = await redis("HINCRBY", "ac:" + code, "gen", 1);
    return send(res, 200, { generation: Number(next) });
  }
  if (op === "delete") {
    await redis("DEL", "ac:" + code, "sv:" + code, "sv:" + code + ":prev");
    return send(res, 200, { ok: true });
  }
  throw fail(400, "unknown op");
});
