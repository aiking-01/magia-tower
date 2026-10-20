// npm test: runs every tools/test/*.test.js in turn. Each file exports `async (t) => {}`; t.ok(cond, msg) records a
// failure without stopping, t.log() prints a note. Exit code 1 if anything failed, so the pre-push hook and CI stop.
const fs = require("fs");
const path = require("path");

const only = process.argv.slice(2);
const dir = path.join(__dirname, "test");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.js")).filter((f) => !only.length || only.some((o) => f.includes(o))).sort();

(async () => {
  let failed = 0;
  for (const f of files) {
    const fails = [];
    const t = {
      ok(cond, msg) { if (!cond) fails.push(msg); },
      log(...a) { console.log("    " + a.join(" ")); },
    };
    const started = Date.now();
    try {
      await require(path.join(dir, f))(t);
    } catch (e) {
      fails.push("threw: " + (e && e.stack ? e.stack : e));
    }
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (fails.length) {
      failed += 1;
      console.log(`✗ ${f} (${secs}s)`);
      fails.forEach((m) => console.log("    - " + m));
    } else console.log(`✓ ${f} (${secs}s)`);
  }
  console.log(failed ? `\n${failed} / ${files.length} test files failed` : `\nall ${files.length} test files passed`);
  process.exit(failed ? 1 : 0);
})();
