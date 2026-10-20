// GET /api/health -> { ok, db }: lets the game show 準備中 instead of failing when the database isn't connected.
// Costs no Redis command (only checks that it's configured).
const { configured } = require("./_lib/redis");
const { send } = require("./_lib/http");

module.exports = async (req, res) => send(res, 200, { ok: true, db: configured() });
