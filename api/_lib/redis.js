// Upstash Redis over its REST API with Node's built-in fetch: no npm packages, so the site needs no build step.
// Vercel's Upstash integration sets KV_REST_API_URL / KV_REST_API_TOKEN (UPSTASH_REDIS_REST_* also accepted).
// Files under api/_lib are helpers, not endpoints (Vercel skips names starting with "_").
function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}
function configured() { return !!config(); }

class RedisError extends Error {}

async function post(path, body) {
  const c = config();
  if (!c) throw new RedisError("not configured");
  let res;
  try {
    res = await fetch(c.url + path, {
      method: "POST",
      headers: { authorization: "Bearer " + c.token, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new RedisError("unreachable");
  }
  if (!res.ok) throw new RedisError("http " + res.status); // quota used up, bad token, …
  return res.json();
}

// one command: redis("GET", key) -> result
async function redis(...cmd) {
  const r = await post("", cmd.map(String));
  if (r && r.error) throw new RedisError(r.error);
  return r ? r.result : null;
}
// several commands in one round trip (each still counts as a command on the free tier).
// Returns the results in order; a failed command comes back as an Error object instead of throwing
async function pipeline(cmds) {
  if (!cmds.length) return [];
  const r = await post("/pipeline", cmds.map((c) => c.map(String)));
  return (Array.isArray(r) ? r : []).map((x) => (x && x.error ? new RedisError(x.error) : x ? x.result : null));
}
// HGETALL's flat [k1, v1, k2, v2…] -> object
function hashToObject(arr) {
  const out = {};
  if (Array.isArray(arr)) for (let i = 0; i + 1 < arr.length; i += 2) out[arr[i]] = arr[i + 1];
  return out;
}

module.exports = { redis, pipeline, configured, hashToObject, RedisError };
