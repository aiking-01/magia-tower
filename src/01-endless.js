// src/01-endless.js — part of game.js (endless 特性 and 深層の守護者). Edit here, then run: node tools/build.js
  // ---------------- Endless: 特性 and 深層の守護者 ----------------
  // Past 100F an enemy may carry a 特性 (25% / 40% from 200F / 60% from 300F; from 500F a second one 30% of the
  // time) that asks for a different way of playing; beating one pays ×1.5 souls (×2 with two). Every 100F from 200
  // a 深層の守護者 takes the mid-boss's place: two fixed 特性, HP ×3, ×3 souls and a 秘宝 at the next merchant.
  // Looks are the existing art recolored by a CSS filter (art/filter are data, so new art can be dropped in).
  // 硬化 never pairs with 瘴気 or 幻影: with too few moves left over, such a floor could be impossible.
  const TRAIT_DEFS = [
    { id: "armor", name: "鉄壁", desc: "会心でない一撃のダメージ ×0.25（処刑の火・猛毒には効かない）", filter: "grayscale(0.7) contrast(1.35) brightness(1.15)", color: "#cfd8e8" },
    { id: "regen", name: "再生", desc: "手を打つたびに最大HPの8%回復する", filter: "hue-rotate(85deg) saturate(1.5)", color: "#7dffa0" },
    { id: "curse", name: "呪縛", desc: "バフの上乗せが半分になる", filter: "hue-rotate(250deg) saturate(1.7)", color: "#c58bff" },
    { id: "miasma", name: "瘴気", desc: "手数 −1", filter: "sepia(0.6) hue-rotate(40deg) saturate(1.6) brightness(0.85)", color: "#c4d36a" },
    { id: "mirror", name: "鏡面", desc: "処刑の火・猛毒が効かない", filter: "saturate(0.25) brightness(1.4)", color: "#eaf7ff" },
    { id: "frenzy", name: "狂化", desc: "HP ×2（倒すと獲得金額 ×2）", filter: "hue-rotate(-35deg) saturate(2.4)", color: "#ff6b6b" },
    { id: "phantom", name: "幻影", desc: "この階で最初に使う攻撃・特殊カードは外れる", filter: "opacity(0.62) blur(0.6px) hue-rotate(190deg)", color: "#9fb4ff" },
    { id: "harden", name: "硬化", desc: "1回のダメージは最大HPの30%まで", filter: "sepia(0.75) saturate(1.3) contrast(1.25)", color: "#e0b84a" },
  ];
  const TRAIT_EXCLUSIVE = [["harden", "miasma"], ["harden", "phantom"]];
  const TRAIT_HIT_CAP = 0.3; // 硬化
  const TRAIT_REGEN = 0.08; // 再生
  const TRAIT_ARMOR = 0.25; // 鉄壁
  const GUARDIAN_HP_MULT = 3;
  const GUARDIAN_SOUL_MULT = 3;
  function traitsCompatible(a, b) { return a !== b && !TRAIT_EXCLUSIVE.some(([x, y]) => (x === a && y === b) || (x === b && y === a)); }
  const TRAIT_PAIRS = [];
  TRAIT_DEFS.forEach((a, i) => TRAIT_DEFS.slice(i + 1).forEach((b) => { if (traitsCompatible(a.id, b.id)) TRAIT_PAIRS.push([a.id, b.id]); }));
  function isGuardianFloor(floor) { return floor > FINAL_FLOOR && floor % 100 === 0; }
  function guardianForFloor(floor) {
    const depth = floor / 100;
    return {
      isBoss: true, isMidBoss: false, isGuardian: true, name: `第${depth}層の守護者`, art: FINAL_BOSS.art,
      filter: `hue-rotate(${(depth * 47) % 360}deg) saturate(1.6) contrast(1.1)`,
      traits: TRAIT_PAIRS[((depth - 2) * 7) % TRAIT_PAIRS.length].slice(),
    };
  }
  function rollTraits(floor) {
    if (floor <= FINAL_FLOOR) return [];
    if (isGuardianFloor(floor)) return guardianForFloor(floor).traits;
    const chance = floor < 200 ? 0.25 : floor < 300 ? 0.4 : 0.6;
    if (Math.random() >= chance) return [];
    const first = TRAIT_DEFS[Math.floor(Math.random() * TRAIT_DEFS.length)].id;
    if (floor < 500 || Math.random() >= 0.3) return [first];
    const rest = TRAIT_DEFS.filter((t) => traitsCompatible(first, t.id));
    return [first, rest[Math.floor(Math.random() * rest.length)].id];
  }
  function hasTrait(id) { return !!(game && game.traits && game.traits.includes(id)); }
  function traitDef(id) { return TRAIT_DEFS.find((t) => t.id === id); }
  // what 鉄壁/硬化 do to one hit (cards and remnants; % damage is handled by 鏡面 instead)
  function applyTraitsToHit(dmg, isCrit) {
    let d = dmg;
    if (!isCrit && hasTrait("armor")) d = roundDamage(d.mul(TRAIT_ARMOR));
    if (hasTrait("harden")) d = Decimal.min(d, game.enemyHpMax.mul(TRAIT_HIT_CAP).ceil());
    return d;
  }

  function enemyForFloor(floor) {
    if (isGuardianFloor(floor)) return guardianForFloor(floor);
    if (floor === FINAL_FLOOR) return Object.assign({ isBoss: true, isMidBoss: false }, FINAL_BOSS);
    if (floor % 10 === 0) return Object.assign({ isBoss: true, isMidBoss: true }, MID_BOSS);
    return Object.assign({ isBoss: false, isMidBoss: false }, ENEMY_ROSTER[(floor - 1) % 10]);
  }
  const TAG_LABELS = { flame: "炎" };
  const TYPE_LABELS = { attack: "攻撃", draw: "ドロー", percent: "割合", special: "特殊", chain: "連鎖", buff: "バフ", poison: "毒" };

  const BASE_DECK_DEFS = [
    { type: "attack", name: "斬撃", value: 15, count: 5 },
    { type: "attack", name: "強撃", value: 20, count: 3 },
    { type: "attack", name: "会心撃", value: 18, count: 2, critRateBonus: 5, critDmgBonus: 20 },
    // draw cards are disabled for now (kept here, commented out, in case they come back later):
    // { type: "draw", name: "透視", value: 2, count: 3 },
  ];

