// Local dev server: the static game plus api/ running against the in-memory fake Upstash (nothing leaves the PC).
//   node tools/devserver.js [port]      (default 8746)  ->  open http://localhost:8746/?net=1
// The game only talks to the server on localhost when ?net=1 is in the URL, so plain local play stays offline.
// ADMIN_TOKEN defaults to "dev-admin-token" here for admin.html.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { startFakeUpstash } = require("./lib/fake-upstash");

const ROOT = path.resolve(__dirname, "..");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon",
};

async function startDevServer(port, opts) {
  const o = opts || {};
  const fake = o.upstash || (await startFakeUpstash());
  process.env.KV_REST_API_URL = fake.url;
  process.env.KV_REST_API_TOKEN = fake.token;
  if (!process.env.ADMIN_TOKEN) process.env.ADMIN_TOKEN = "dev-admin-token";
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const m = url.pathname.match(/^\/api\/([a-z-]+)$/);
    if (m) {
      const file = path.join(ROOT, "api", m[1] + ".js");
      if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("{}"); }
      try { return await require(file)(req, res); } catch (e) { res.statusCode = 500; return res.end(String(e)); }
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || /[\\/](tools|\.git|node_modules)[\\/]/.test(file.slice(ROOT.length))) { res.statusCode = 403; return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.statusCode = 404; return res.end("not found"); }
      res.setHeader("content-type", TYPES[path.extname(file)] || "application/octet-stream");
      res.setHeader("cache-control", "no-store");
      res.end(buf);
    });
  });
  await new Promise((r) => server.listen(port, r));
  return { server, fake, port: server.address().port, close: async () => { await new Promise((r) => server.close(r)); if (!o.upstash) await fake.close(); } };
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8746;
  startDevServer(port).then((s) => console.log(`dev server: http://localhost:${s.port}/?net=1  (admin token: ${process.env.ADMIN_TOKEN})`));
}
module.exports = { startDevServer };
