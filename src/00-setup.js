// src/00-setup.js — part of game.js (IIFE start, constants, enemies). Edit here, then run: node tools/build.js
(function () {
  const STORAGE_KEY = "magiaTower.save.v2";
  const BASE_ENEMY_HP = 100;
  const BASE_ATK = 3;
  const BASE_N = 5;
  const BASE_HAND = 5;
  const FINAL_FLOOR = 100;
  // deleting/benching can never shrink the battle deck below this. At 4 the deck was smaller than the
  // hand, so a played card came straight back and one buff/処刑の火 could be replayed every move.
  const MIN_DECK_SIZE = 9;
  // debug cards are off by default; open the file with ?debug=1 in the URL to enable them for testing
  const DEBUG_MODE = new URLSearchParams(location.search).get("debug") === "1";
  // the console cheats (window.mt, see the bottom of this file) are on wherever the game is being
  // worked on -- a local server or a file:// open -- and on a deployed build only with ?debug=1,
  // so a published page doesn't hand every player a points editor in one keystroke.
  const LOCAL_ORIGIN = ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname);
  const DEV_CONSOLE = DEBUG_MODE || LOCAL_ORIGIN;

  // enemy roster: floors cycle through 9 regular monsters, the 10th floor of every 10-floor
  // block is a mid-boss (the same art/name each time it comes around), and floor 100 exactly is
  // the one-time final boss reveal.
  // these 9 are pre-processed to a transparent background (flood-filled from the border, so the
  // dungeon backdrop below shows through) with the AI generator's watermark removed
  const ENEMY_ROSTER = [
    { name: "ゴブリン", art: "enemies/01-goblin.png" },
    { name: "ミミック", art: "enemies/02-mimic.png" },
    { name: "浮遊する眼魔", art: "enemies/03-eye.png" },
    { name: "スケルトン戦士", art: "enemies/04-skeleton.png" },
    { name: "キノコの妖精", art: "enemies/05-mushroom.png" },
    { name: "盗賊ネズミ", art: "enemies/06-rat.png" },
    { name: "腐食のコウモリ", art: "enemies/07-bat.png" },
    { name: "菌糸の蜘蛛", art: "enemies/08-spider.png" },
    { name: "亡霊茸", art: "enemies/09-mushroom-skeleton.png" },
  ];
  const MID_BOSS = { name: "死の賭博師", art: "enemies/10-midboss.png" };
  const FINAL_BOSS = { name: "塔の支配者（ラスボス）", art: "enemies/11-finalboss.png" };

