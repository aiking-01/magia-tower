// src/08-achievements.js — part of game.js (achievements). Edit here, then run: node tools/build.js
  // ---------------- Achievements (permanent, never reset -- not even by reincarnation) ----------------
  // bonuses of all achieved entries simply add up. Lifetime counters live in save.stats. Content is a
  // first pass meant to be tuned after playing.
  function stat(key) { return save.stats[key] || 0; }
  function bumpStat(key, n) { save.stats[key] = stat(key) + (n == null ? 1 : n); }
  function maxStat(key, value) { if (Number.isFinite(value) && value > stat(key)) save.stats[key] = value; }
  // the biggest single hit is a Decimal, kept apart from the plain-number counters
  function maxHit() { return save.stats.maxHit instanceof Decimal ? save.stats.maxHit : toDecimal(save.stats.maxHit); }
  function recordHit(dmg) { if (dmg.gt(maxHit())) save.stats.maxHit = dmg; }
  // 日本の命数法 (+ グーゴル and the old 1.8E+308 ceiling), used to write big HP values as 1,440万 etc.
  const JP_UNITS = [
    { e: 4, name: "万", read: "まん" }, { e: 8, name: "億", read: "おく" }, { e: 12, name: "兆", read: "ちょう" },
    { e: 16, name: "京", read: "けい" }, { e: 20, name: "垓", read: "がい" }, { e: 24, name: "秭", read: "じょ" },
    { e: 28, name: "穣", read: "じょう" }, { e: 32, name: "溝", read: "こう" }, { e: 36, name: "澗", read: "かん" },
    { e: 40, name: "正", read: "せい" }, { e: 44, name: "載", read: "さい" }, { e: 48, name: "極", read: "ごく" },
    { e: 52, name: "恒河沙", read: "ごうがしゃ" }, { e: 56, name: "阿僧祇", read: "あそうぎ" }, { e: 60, name: "那由他", read: "なゆた" },
    { e: 64, name: "不可思議", read: "ふかしぎ" }, { e: 68, name: "無量大数", read: "むりょうたいすう" },
    { e: 100, name: "グーゴル", read: "googol" }, { e: 308, name: "無限", read: "むげん" },
  ];
  function unitIndexFor(d) {
    let idx = -1;
    JP_UNITS.forEach((u, i) => { if (d.gte(Decimal.pow(10, u.e))) idx = i; });
    return idx;
  }
  // 3.4京 / 3,400京 / 1.2E+12無量大数: the number in its largest 位
  function jpUnitText(value) {
    const d = new Decimal(value);
    const idx = unitIndexFor(d);
    if (idx < 0) return fmt(d);
    const unit = JP_UNITS[idx];
    const q = d.div(Decimal.pow(10, unit.e));
    let qs;
    if (q.lt(10)) qs = (Math.floor(q.toNumber() * 10) / 10).toLocaleString("ja-JP", { maximumFractionDigits: 1 });
    else if (q.lt(1e4)) qs = Math.floor(q.toNumber()).toLocaleString("ja-JP");
    else qs = fmt(q);
    return qs + unit.name;
  }
  // every 10F mid-boss (死の賭博師) has its own entry; floor10/floor50 keep their old ids so saves that
  // already earned them stay earned
  const MID_BOSS_ACHIEVEMENTS = [
    ["floor10", "其の一", 5], ["boss20", "其の二", 5], ["boss30", "其の三", 10], ["boss40", "其の四", 10],
    ["floor50", "其の五", 15], ["boss60", "其の六", 15], ["boss70", "其の七", 20], ["boss80", "其の八", 20],
    ["boss90", "其の九", 25],
  ].map(([id, suffix, atkPct], i) => {
    const floor = (i + 1) * 10;
    return { id, name: `賭博師討伐・${suffix}`, desc: `${floor}階の中ボスを倒す`, test: () => stat("maxCleared") >= floor, bonus: { atkPct } };
  });
  const ACHIEVEMENTS = MID_BOSS_ACHIEVEMENTS.concat([
    { id: "floor100", name: "塔の頂", desc: "ラスボスを倒す", test: () => stat("bossKills") >= 1, bonus: { atkPct: 30, soulPct: 20 } },
    { id: "floor150", name: "果てなき塔", desc: "150階をクリアする", test: () => stat("maxCleared") >= 150, bonus: { expPct: 20 } },
    { id: "floor200", name: "深淵の住人", desc: "200階をクリアする", test: () => stat("maxCleared") >= 200, bonus: { atkPct: 40 } },
    { id: "hit1e4", name: "一撃一万", desc: "1回で1万ダメージを与える", test: () => maxHit().gte(1e4), bonus: { atkPct: 5 } },
    { id: "hit1e6", name: "一撃百万", desc: "1回で100万ダメージを与える", test: () => maxHit().gte(1e6), bonus: { atkPct: 10 } },
    { id: "hit1e9", name: "一撃十億", desc: "1回で10億ダメージを与える", test: () => maxHit().gte(1e9), bonus: { atkPct: 15 } },
    { id: "hit1e12", name: "一撃一兆", desc: "1回で1兆ダメージを与える", test: () => maxHit().gte(1e12), bonus: { atkPct: 25 } },
    { id: "lv10", name: "成長の兆し", desc: "レベル10に到達する", test: () => save.level >= 10, bonus: { expPct: 10 } },
    { id: "lv50", name: "熟練者", desc: "レベル50に到達する", test: () => save.level >= 50, bonus: { expPct: 15 } },
    { id: "lv100", name: "超越者", desc: "レベル100に到達する", test: () => save.level >= 100, bonus: { expPct: 25 } },
    { id: "crit5", name: "会心連打", desc: "1回の挑戦中に会心を5回連続で出す（階をまたいでもよい）", test: () => stat("maxCritStreak") >= 5, bonus: { critDmg: 25 } },
    { id: "crit10", name: "会心の嵐", desc: "1回の挑戦中に会心を10回連続で出す（階をまたいでもよい）", test: () => stat("maxCritStreak") >= 10, bonus: { critDmg: 50 } },
    { id: "kills100", name: "百の討伐", desc: "敵を合計100体倒す", test: () => stat("kills") >= 100, bonus: { soulPct: 10 } },
    { id: "kills1000", name: "千の討伐", desc: "敵を合計1000体倒す", test: () => stat("kills") >= 1000, bonus: { soulPct: 20 } },
    { id: "runs10", name: "挑戦者", desc: "塔に10回挑む", test: () => stat("runs") >= 10, bonus: { goldPct: 20 } },
    { id: "reinc1", name: "輪廻", desc: "転生する", test: () => stat("reincarnations") >= 1, bonus: { expPct: 20 } },
    { id: "reinc5", name: "輪廻の旅人", desc: "5回転生する", test: () => stat("reincarnations") >= 5, bonus: { soulPct: 20 } },
    { id: "remnant1", name: "残滓の主", desc: "残滓を召喚する", test: () => remnantCount() >= 1, bonus: { atkPct: 10 } },
    { id: "remnant6", name: "残滓の軍勢", desc: "残滓を6体召喚する", test: () => remnantCount() >= 6, bonus: { atkPct: 30 } },
    // ---- progress milestones ----
    { id: "floor300", name: "雲上の回廊", desc: "300階をクリアする", test: () => stat("maxCleared") >= 300, bonus: { atkPct: 50 } },
    { id: "floor500", name: "天穹の踏破者", desc: "500階をクリアする", test: () => stat("maxCleared") >= 500, bonus: { expPct: 50 } },
    { id: "floor1000", name: "千階の覇者", desc: "1000階をクリアする", test: () => stat("maxCleared") >= 1000, bonus: { atkPct: 100 } },
    { id: "floor3000", name: "星界の旅人", desc: "3000階をクリアする", test: () => stat("maxCleared") >= 3000, bonus: { soulPct: 100 } },
    { id: "floor10000", name: "万階の塔主", desc: "10000階をクリアする", test: () => stat("maxCleared") >= 10000, bonus: { atkPct: 300 } },
    { id: "hit1e20", name: "一撃一垓", desc: "1回で1垓（1E+20）ダメージを与える", test: () => maxHit().gte(1e20), bonus: { atkPct: 40 } },
    { id: "hit1e50", name: "天文学的一撃", desc: "1回で1E+50ダメージを与える", test: () => maxHit().gte(1e50), bonus: { atkPct: 60 } },
    { id: "hit1e68", name: "無量大数", desc: "1回で1無量大数（1E+68）ダメージを与える", test: () => maxHit().gte(1e68), bonus: { atkPct: 100 } },
    { id: "hit1e100", name: "グーゴルの一撃", desc: "1回で1グーゴル（1E+100）ダメージを与える", test: () => maxHit().gte(1e100), bonus: { atkPct: 150 } },
    { id: "hit1e308", name: "無限突破", desc: "1回で1E+308を超えるダメージを与える", test: () => maxHit().gte(Decimal.pow(10, 308)), bonus: { atkPct: 200 } },
    { id: "hit1e1000", name: "千桁の一撃", desc: "1回で1E+1000ダメージを与える", test: () => maxHit().gte(Decimal.pow(10, 1000)), bonus: { atkPct: 300 } },
    { id: "lv200", name: "達人", desc: "レベル200に到達する", test: () => save.level >= 200, bonus: { expPct: 30 } },
    { id: "lv500", name: "英雄", desc: "レベル500に到達する", test: () => save.level >= 500, bonus: { expPct: 50 } },
    { id: "lv1000", name: "伝説", desc: "レベル1000に到達する", test: () => save.level >= 1000, bonus: { atkPct: 100 } },
    { id: "lv3000", name: "神話", desc: "レベル3000に到達する", test: () => save.level >= 3000, bonus: { atkPct: 200 } },
    { id: "kills5000", name: "五千の討伐", desc: "敵を合計5000体倒す", test: () => stat("kills") >= 5000, bonus: { soulPct: 30 } },
    { id: "kills20000", name: "二万の討伐", desc: "敵を合計20000体倒す", test: () => stat("kills") >= 20000, bonus: { soulPct: 50 } },
    { id: "kills100000", name: "十万の討伐", desc: "敵を合計100000体倒す", test: () => stat("kills") >= 100000, bonus: { soulPct: 100 } },
    { id: "runs50", name: "常連", desc: "塔に50回挑む", test: () => stat("runs") >= 50, bonus: { goldPct: 50 } },
    { id: "runs200", name: "塔の住人", desc: "塔に200回挑む", test: () => stat("runs") >= 200, bonus: { goldPct: 100 } },
    { id: "reinc10", name: "輪廻の巡礼者", desc: "10回転生する", test: () => stat("reincarnations") >= 10, bonus: { soulPct: 30 } },
    { id: "reinc25", name: "輪廻の覇者", desc: "25回転生する", test: () => stat("reincarnations") >= 25, bonus: { atkPct: 100 } },
    { id: "reinc50", name: "永劫回帰", desc: "50回転生する", test: () => stat("reincarnations") >= 50, bonus: { atkPct: 200 } },
    { id: "remnant3", name: "残滓の小隊", desc: "残滓を3体召喚する", test: () => remnantCount() >= 3, bonus: { atkPct: 15 } },
    { id: "remnantTree30", name: "残滓の研鑽", desc: "残滓スキルツリーを合計30段習得する", test: () => Object.keys(save.remnantTree).length >= 30, bonus: { atkPct: 30 } },
    { id: "remnantTree120", name: "残滓の極み", desc: "残滓スキルツリーを全段習得する", test: () => Object.keys(save.remnantTree).length >= 120, bonus: { atkPct: 200 } },
    { id: "crit20", name: "会心の奔流", desc: "1回の挑戦中に会心を20回連続で出す", test: () => stat("maxCritStreak") >= 20, bonus: { critDmg: 100 } },
    { id: "crit50", name: "必中必殺", desc: "1回の挑戦中に会心を50回連続で出す", test: () => stat("maxCritStreak") >= 50, bonus: { critDmg: 200 } },
    { id: "ext10", name: "魂の修練", desc: "拡張強化のどれかをLv.10にする", test: () => Math.max(0, ...Object.values(save.treeExt)) >= 10, bonus: { soulPct: 20 } },
    { id: "ext30", name: "魂の極地", desc: "拡張強化のどれかをLv.30にする", test: () => Math.max(0, ...Object.values(save.treeExt)) >= 30, bonus: { atkPct: 50 } },
    { id: "deck30", name: "大所帯", desc: "カードを合計30枚所持する", test: () => save.deckDefs.reduce((n, d) => n + d.count, 0) >= 30, bonus: { goldPct: 30 } },
    { id: "souls1e6", name: "ソウルの泉", desc: "ソウルを100万貯める", test: () => save.points >= 1e6, bonus: { soulPct: 20 } },
    { id: "transcend1e7", name: "転生の蓄え", desc: "転生ポイントを1000万貯める", test: () => save.transcendPoints >= 1e7, bonus: { expPct: 30 } },
    { id: "trialStart", name: "苦難への一歩", desc: "苦難に挑む", test: () => stat("trialsStarted") >= 1, bonus: { soulPct: 10 } },
    { id: "trial1", name: "苦難を越えし者", desc: "苦難を1つ乗り越える", test: () => trialsClearedCount() >= 1, bonus: { atkPct: 20 } },
    { id: "trial3", name: "苦難の求道者", desc: "苦難を3つ乗り越える", test: () => trialsClearedCount() >= 3, bonus: { expPct: 30 } },
    { id: "trialAllStar1", name: "八方の試練", desc: "全ての方向の★の苦難を乗り越える", test: () => TRIAL_CATEGORIES.every((c) => save.trialsCleared[c.id + "1"]), bonus: { atkPct: 50 } },
    { id: "trialStar3", name: "深淵の踏破者", desc: "★★★の苦難を1つ乗り越える", test: () => TRIALS.some((t) => t.level === 3 && save.trialsCleared[t.id]), bonus: { soulPct: 50 } },
    { id: "trialAll", name: "万難を排す", desc: "全ての苦難を乗り越える", test: () => trialsClearedCount() >= TRIALS.length, bonus: { atkPct: 100 } },
    // hidden: 5907F is the first floor whose HP passes 1.8E+308 (the old Infinity wall)
    { id: "beyondInfinity", name: "無限の彼方", desc: "5907階をクリアする（敵のHPが1.8E+308を超える最初の階）", hidden: true, test: () => stat("maxCleared") >= 5907, bonus: { atkPct: 100 } },
    { id: "trialCombo2", name: "二重の苦難", desc: "苦難を2つ同時に乗り越える", test: () => (save.trialComboBest || 0) >= 2, bonus: { atkPct: 30 } },
    { id: "trialCombo4", name: "四重の苦難", desc: "苦難を4つ同時に乗り越える", test: () => (save.trialComboBest || 0) >= 4, bonus: { atkPct: 80 } },
    { id: "trialCombo8", name: "八重の苦難", desc: "苦難を8つ同時に乗り越える", test: () => (save.trialComboBest || 0) >= 8, bonus: { atkPct: 300 } },
    { id: "trial8", name: "苦難の巡礼者", desc: "苦難を8つ乗り越える", test: () => trialsClearedCount() >= 8, bonus: { expPct: 50 } },
    { id: "trial16", name: "苦難の覇者", desc: "苦難を16個乗り越える", test: () => trialsClearedCount() >= 16, bonus: { atkPct: 100 } },
    { id: "ach20", name: "実績コレクター", desc: "実績を20個達成する", test: () => Object.keys(save.achievements).length >= 20, bonus: { atkPct: 20 } },
    { id: "ach50", name: "実績マスター", desc: "実績を50個達成する", test: () => Object.keys(save.achievements).length >= 50, bonus: { atkPct: 100 } },
    { id: "lastMove", name: "背水の陣", desc: "最後の1手で敵を倒す", hidden: true, test: () => stat("lastMoveWins") >= 1, bonus: { critDmg: 30 } },
    { id: "bossOneShot", name: "一刀両断", desc: "ラスボスを1手で倒す", hidden: true, test: () => stat("bossOneShot") >= 1, bonus: { atkPct: 50 } },
    { id: "idle8h", name: "眠れる塔", desc: "8時間分の放置収入を一度に受け取る", hidden: true, test: () => stat("maxIdleMinutes") >= 480, bonus: { soulPct: 20 } },
    { id: "staffGlow", name: "杖の目覚め", desc: "タイトルの杖に触れて光らせる", hidden: true, test: () => stat("staffTouches") >= 1, bonus: { atkPct: 3 } },
    { id: "staffGlow50", name: "魔力の共鳴", desc: "タイトルの杖を50回光らせる", hidden: true, test: () => stat("staffTouches") >= 50, bonus: { soulPct: 5 } },
    { id: "mark10", name: "超越の刻印", desc: "超越の刻印をLv.10にする", test: () => markLevelRaw() >= 10, bonus: { atkPct: 100 } },
    // ---- 深層 ----
    { id: "guardian1", name: "守護者を討つ", desc: "深層の守護者（200階・300階…）を倒す", test: () => stat("guardianKills") >= 1, bonus: { atkPct: 60 } },
    { id: "guardian10", name: "深淵の征服者", desc: "深層の守護者を合計10体倒す", test: () => stat("guardianKills") >= 10, bonus: { atkPct: 150 } },
    { id: "trait100", name: "異能狩り", desc: "特性を持つ敵を合計100体倒す", test: () => stat("traitKills") >= 100, bonus: { soulPct: 40 } },
    // ---- 秘宝 ----
    { id: "item1", name: "秘宝の発見", desc: "商人から秘宝を買う", test: () => stat("itemsBought") >= 1, bonus: { goldPct: 30 } },
    { id: "item5", name: "秘宝の蒐集家", desc: "1回の転生のあいだに秘宝を5個持つ", test: () => itemsOwnedTotal() >= 5, bonus: { atkPct: 40 } },
    { id: "item15", name: "宝物庫の主", desc: "1回の転生のあいだに秘宝を15個持つ", test: () => itemsOwnedTotal() >= 15, bonus: { atkPct: 120 } },
    { id: "itemKinds", name: "万宝の目利き", desc: "伝説の秘宝を除く全種類の秘宝を同時に持つ", test: () => ITEM_DEFS.every((d) => d.legendary || itemCount(d) > 0), bonus: { atkPct: 200 } },
    { id: "itemAwaken10", name: "目覚める秘宝", desc: "秘宝を合計10回覚醒させる", test: () => stat("itemsAwakened") >= 10, bonus: { goldPct: 100 } },
    { id: "itemBought30", name: "商人の上客", desc: "秘宝を通算30個買う", test: () => stat("itemsBought") >= 30, bonus: { soulPct: 30 } },
    { id: "itemLegend", name: "混沌を掴む者", desc: "伝説の秘宝「混沌の欠片」を手に入れる", hidden: true, test: () => ITEM_DEFS.some((d) => d.legendary && itemCount(d) > 0), bonus: { atkPct: 100 } },
    // hidden: the only tampering a browser game can actually observe is the clock jumping backwards
    { id: "timeTraveler", name: "時を遡る者", desc: "端末の時計を過去に戻す", hidden: true, test: () => stat("clockRollback") >= 1, bonus: { soulPct: 10 } },
  ]);
  const ACHIEVEMENT_BONUS_LABELS = { atkPct: "攻撃力", expPct: "経験値", soulPct: "ソウル", goldPct: "獲得金額", critDmg: "会心ダメージ" };
  function achievementBonus(key) {
    let total = 0;
    ACHIEVEMENTS.forEach((a) => { if (save.achievements[a.id] && a.bonus[key]) total += a.bonus[key]; });
    return total;
  }
  function bonusText(bonus) {
    return Object.entries(bonus).map(([k, v]) => `${ACHIEVEMENT_BONUS_LABELS[k]}+${v}%`).join("・");
  }
  // repeats until nothing new unlocks: the "N achievements" entries count unlocks made in the same pass
  function checkAchievements() {
    let unlocked;
    do {
      unlocked = false;
      ACHIEVEMENTS.forEach((a) => {
        if (save.achievements[a.id] || !a.test()) return;
        save.achievements[a.id] = true;
        unlocked = true;
        showToast(`実績解除：${a.name}（${bonusText(a.bonus)}）`);
      });
    } while (unlocked);
  }

