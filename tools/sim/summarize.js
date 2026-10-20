// summarizes sweep.js output: median cards per label, and the ratio to the "none" baseline
//   node tools/sim/summarize.js <out.jsonl> [baseline cards]   (baseline defaults to the median of label "none")
const fs = require("fs");

const rows = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const by = {};
rows.forEach((r) => { (by[r.label] = by[r.label] || []).push(r); });
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
const base = Number(process.argv[3]) || (by.none ? median(by.none.map((r) => r.cards)) : 0);
if (!base) throw new Error("no baseline: pass one, or include label \"none\"");
console.log(`baseline ${base} cards`);
Object.keys(by).sort().forEach((k) => {
  if (k === "none") return;
  const cards = by[k].map((r) => (r.cleared ? r.cards : Infinity));
  const m = median(cards);
  console.log(`${k.padEnd(28)} ×${(m / base).toFixed(1).padStart(5)}   ${by[k].map((r) => (r.cleared ? "" : "未") + r.cards).join(" ")}`);
});
