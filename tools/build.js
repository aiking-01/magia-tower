// game.js is built from src/*.js: the files are joined in name order, each without its first line (the
// "// src/… — part of game.js" marker). The game stays one IIFE, exactly as before the split.
//   node tools/build.js           write game.js
//   node tools/build.js --check   exit 1 if game.js is not what src/ builds (the tests and the pre-push hook run this)
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const OUT = path.join(ROOT, "game.js");
const MARKER = /^\/\/ src\/[^\n]*\n/;

function build() {
  return fs.readdirSync(SRC).filter((f) => f.endsWith(".js")).sort().map((f) => {
    const text = fs.readFileSync(path.join(SRC, f), "utf8").replace(/\r\n/g, "\n");
    if (!MARKER.test(text)) throw new Error(`src/${f}: the first line must be the "// src/… — part of game.js" marker`);
    return text.replace(MARKER, "");
  }).join("");
}

if (require.main === module) {
  const built = build();
  if (process.argv.includes("--check")) {
    const current = fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n");
    if (current !== built) {
      console.error("game.js is out of date: edit src/ and run `node tools/build.js` (never edit game.js directly)");
      process.exit(1);
    }
    console.log("game.js matches src/");
  } else {
    fs.writeFileSync(OUT, built);
    console.log(`game.js built from src/ (${built.split("\n").length - 1} lines)`);
  }
}
module.exports = { build };
