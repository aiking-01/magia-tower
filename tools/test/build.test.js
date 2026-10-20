// game.js must be exactly what src/ builds (edit src/, then `node tools/build.js`)
const fs = require("fs");
const path = require("path");
const { build } = require("../build");

module.exports = async (t) => {
  const current = fs.readFileSync(path.resolve(__dirname, "..", "..", "game.js"), "utf8").replace(/\r\n/g, "\n");
  t.ok(current === build(), "game.js is out of date: edit src/ and run `node tools/build.js`");
};
