// runs trial-effort.js for many (trial, rules, seed) combinations in parallel and appends one JSON line per run
//   node tools/sim/sweep.js <config.json> <out.jsonl> [parallel=10] [maxCards=40000]
// config.json: [{ "label": "hp ×1e4", "trial": "hp1", "rules": { "hpMult": 10000 }, "seeds": [1, 2, 3] }, …]
// (rules may be omitted to use the game's own numbers)
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const [configPath, outPath] = process.argv.slice(2);
const parallel = Number(process.argv[4] || 10);
const maxCards = Number(process.argv[5] || 40000);
const jobs = [];
JSON.parse(fs.readFileSync(configPath, "utf8")).forEach((c) => (c.seeds || [1]).forEach((seed) => jobs.push(Object.assign({}, c, { seed }))));
let next = 0;
let running = 0;
function launch() {
  while (running < parallel && next < jobs.length) {
    const job = jobs[next++];
    running += 1;
    const env = Object.assign({}, process.env);
    if (job.rules) env.TRIAL_RULES = JSON.stringify({ [job.trial.split("+")[0]]: job.rules });
    const child = spawn(process.execPath, [path.join(__dirname, "trial-effort.js"), job.trial, String(job.seed), String(maxCards)], { env });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.on("close", () => {
      running -= 1;
      const line = out.trim().split("\n").pop();
      let row;
      try { row = Object.assign({ label: job.label }, JSON.parse(line)); } catch (e) { row = { label: job.label, trial: job.trial, seed: job.seed, error: out.slice(-300) }; }
      fs.appendFileSync(outPath, JSON.stringify(row) + "\n");
      console.log(`${jobs.length - next - running} left · ${row.label} s${job.seed}: ${row.cleared ? "" : "未"}${row.cards}`);
      if (next >= jobs.length && running === 0) process.exit(0);
      launch();
    });
  }
}
launch();
