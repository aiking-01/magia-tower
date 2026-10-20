// shared request/response helpers for the api/ functions. Written against plain Node http (res.statusCode /
// setHeader / end) so the same handlers run on Vercel and in tools/devserver.js.
const crypto = require("crypto");
const { pipeline, configured, RedisError } = require("./redis");

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(obj === undefined ? "" : JSON.stringify(obj));
}

const BODY_LIMIT = 300 * 1024;
// Vercel parses JSON bodies into req.body (sendBeacon may arrive as a string); the dev server hands a raw stream
async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  let text;
  if (typeof req.body === "string") text = req.body;
  else if (Buffer.isBuffer(req.body)) text = req.body.toString("utf8");
  else {
    // an oversized body is read to the end and then refused (cutting the connection would leave the client with a
    // network error instead of a clean 400)
    text = await new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (c) => { size += c.length; if (size <= BODY_LIMIT) chunks.push(c); });
      req.on("end", () => (size > BODY_LIMIT ? reject(new Error("too large")) : resolve(Buffer.concat(chunks).toString("utf8"))));
      req.on("error", reject);
    });
  }
  if (text.length > BODY_LIMIT) throw new Error("too large");
  return text ? JSON.parse(text) : {};
}

// rate limits key on a salted hash of the IP that lives one day; the IP itself is never stored
function clientKey(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = fwd || req.headers["x-real-ip"] || (req.socket && req.socket.remoteAddress) || "unknown";
  const salt = process.env.RATE_SALT || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "magia";
  return crypto.createHash("sha256").update(salt + "|" + ip + "|" + dayStamp()).digest("hex").slice(0, 24);
}
function dayStamp(d) { return (d || new Date()).toISOString().slice(0, 10).replace(/-/g, ""); }
function monthStamp(d) { return (d || new Date()).toISOString().slice(0, 7).replace("-", ""); }

// adds `n` to a counter that expires after `windowSec`; true while the total stays within `limit`. Callers put the
// window (day / 20-second slot) into the key itself, so refreshing the expiry on every call changes nothing
async function withinLimit(key, limit, windowSec, n) {
  const [count] = await pipeline([["INCRBY", "rl:" + key, n || 1], ["EXPIRE", "rl:" + key, windowSec]]);
  return !(count instanceof Error) && Number(count) <= limit;
}

// wraps a handler: method check, "not configured" -> 503 (the game treats it as "準備中"), Redis failures -> 503,
// bad JSON -> 400. Anything thrown with .status is sent as that status.
function handler(methods, fn) {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method)) return send(res, 405, { error: "method" });
      if (!configured()) return send(res, 503, { error: "not configured" });
      return await fn(req, res);
    } catch (e) {
      if (e instanceof RedisError) return send(res, 503, { error: "storage" });
      if (e && e.status) return send(res, e.status, { error: e.message });
      if (e instanceof SyntaxError || (e && e.message === "too large")) return send(res, 400, { error: "bad request" });
      console.error(e);
      return send(res, 500, { error: "server" });
    }
  };
}
function fail(status, message) { const e = new Error(message); e.status = status; return e; }

module.exports = { send, readBody, clientKey, dayStamp, monthStamp, withinLimit, handler, fail };
