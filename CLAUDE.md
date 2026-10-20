# マギア・タワー — Claude 向けメモ

ローカルでもクラウドでも、このリポジトリで作業する Claude は最初にこれを読むこと。
ゲームの仕様の詳細は README.md、直近の改修の設計は `docs/roadmap-v5.md` にある。

## 必ず守ること

- **返答は必ず日本語。** 英語で返すと強く嫌がられる。コミットメッセージも日本語で書く。
- **フォントのライセンス（最重要）。** ダメージ数字は「ゆうたONE / Y1StadiumSlab-Block」をラスタライズした PNG だけを使う
  （`assets/dmg-font/`。文化祭版は同じ画像を data URI にした `festival/dmg-glyphs.js`）。
  - `.otf` `.ttf` `.woff` などのフォントファイルや、そこから文字を復元できるデータを、リポジトリにも公開物にも**絶対に入れない**。
    第三者が吸い出せる形はすべて規約違反になる（`assets/dmg-font/LICENSE-NOTE.txt`）。
  - 新しい文字が必要になったら、自分でフォントを探して組み込まず、ユーザーに PNG 化を頼む。
- **プッシュすると本番に公開される。** プッシュはユーザーが頼んだときだけ行う。プッシュ前に必ず `cd tools && npm test` を通す
  （`git config core.hooksPath tools/hooks` が設定されていれば、プッシュ時に自動で走る）。
- **`game.js` を直接編集しない。** 中身は `src/*.js` を結合して作る生成ファイル。`src/` を直したら `node tools/build.js` を実行する
  （テストとプッシュ前のフックが、ずれを検出して止める）。
- **ユーザーのセーブを壊さない。** ブラウザで動作確認するときは、先に localStorage のセーブを退避してから試し、終わったら元に戻す。
  ゲーム自身が pagehide / visibilitychange でセーブを書き戻すので、戻すときは別キーを使う文化祭版 `/festival/` のページから書き込むと確実。
  開発サーバー（ポート8747）は別のオリジンなので、ユーザーのセーブ（8746）には触れない。
- **本番のサーバーにテストのデータを送らない。** ゲームは localhost と `?debug=1` ではサーバーと通信しない。試すときは開発サーバーと `?net=1` を使う。

## 構成

- 本編：静的サイト。`index.html` / `style.css` / `game.js`（全体が1つの IIFE）、巨大数は `vendor/break_infinity.min.js`（MIT）。
  - `game.js` は `src/00-setup.js` 〜 `src/19-init.js` を名前順に結合したもの（各ファイルの1行目の `// src/…` の行は結合時に外れる）。
  - セーブは localStorage の `magiaTower.save.v2`。フィールドを足すときは `defaultSave()` に追加し、意味を変えるときは `loadSave()` で移行する。
    読み込むたびに `sanitizeSave()`（型を直す）と `clampSaveToDefinitions()`（範囲を直す）を通る。カード名など、セーブ由来の文字を innerHTML に入れるときは `escapeHtml()` を使う。
- サーバー：`api/`（Vercel の関数、Node、依存パッケージなし）＋ Upstash Redis（REST API を fetch で呼ぶ）。
  - `health` / `cloud`（引き継ぎ）/ `telemetry`（プレイ情報）/ `admin`（集計）。`api/_lib/` は共通部品（`_` で始まるので関数にならない）。
  - 環境変数：`KV_REST_API_URL` / `KV_REST_API_TOKEN`（Upstash をつなぐと自動）、`ADMIN_TOKEN`（集計画面の合言葉）。手順は `docs/server-setup.md`。
  - データベースが無くてもゲームは動く（通信はすべて失敗しても何も起きない作り）。
- 文化祭版：`festival/`。本編とは別のセーブ・別のコードで、ラスボスまで15〜20分の体験版。`enemies/` と `assets/` の一部は共通。
  - `festival/tools/` はバランス確認用（公開物からは除外）。
- 開発用：`tools/`（公開物から除外）。
  - `npm test`：`tools/test/*.test.js`（jsdom＋仮想時計。偽の Upstash でサーバーも含めて試す）
  - `node tools/build.js`：`src/` から `game.js` を作る（`--check` で確認だけ）
  - `node tools/devserver.js 8747`：静的ファイル＋`api/`（偽の Upstash、メモリ上）。`http://localhost:8747/?net=1` で開く
  - `tools/sim/`：苦難の手間の測定（`trial-effort.js`・`sweep.js`）など
- ローカルで遊ぶだけなら、リポジトリ直下で静的サーバーを立てて開く（`file://` では画像グリフが出ない）。例：`python -m http.server 8746`

## デバッグ

- URL に `?debug=1`：手札に即死・確定会心カード、ソウル・転生ポイント・ゴールドが常に 1E15 に補充される（セーブにも残る）。
- localhost で開くと開発コンソール `mt` が使える（`mt.help()`）。
- ヘッドレス確認は `tools/lib/harness.js`（jsdom、仮想時計、ゲーム内部を `g` で触れる）。長い自動プレイは `fast: true`（戦闘画面の描画を省く）。

## 公開・リポジトリ

- 正のリポジトリは `aiking-01/magia-tower`。公開（Vercel プロジェクト `magia-tower-f`）は、その写しの
  `suzuki1027mizuki-ops/magia-tower-f` の main へのプッシュで自動デプロイされる → https://magia-tower-f.vercel.app/
- **クラウドのセッションは `suzuki1027mizuki-ops/magia-tower-f` で作業する。** その main にプッシュすればそのまま公開される。
  aiking-01 側へはクラウドからは送れないので、そちらは下の手順でユーザーの PC からそろえる。
- ユーザーの PC では `origin` が両方に同時にプッシュする設定（fetch は aiking-01、push は2つ）。写しは `mirror` で取得できる。
  クラウドで進んだ分を aiking-01 にそろえる手順（ユーザーの PC で）：
  ```
  git fetch mirror
  git merge --ff-only mirror/main
  git push origin main
  ```
  ローカルで作業を始める前にもこれを実行しておく（クラウド側の変更を取り込まないまま作業すると食い違う）。
- `.vercelignore` で `.claude` / `.github` / `festival/tools` / `tools` / `docs` / `src` / この `CLAUDE.md` を公開物から外している。
- GitHub Actions（`.github/workflows/test.yml`）がプッシュのたびに `npm test` を回す。公開はその結果を待たないので、プッシュ前に通すこと。
- コミットの末尾には `Co-Authored-By:` の行を付ける。

## ユーザーの好み（これまでのやり取りから）

- インクリメンタル（数字が指数関数的に伸びる）であることがこのゲームの魅力。バランス調整でもその爽快感を残す。
- テンポ重視・スタイリッシュな見た目。演出は明滅より「常に光っている」ほうが好まれる。
- 基本強化ツリーの全体の形は変えない（位置の調整は重ならない範囲で最小限に）。
- 依頼が多いときや仕様が分かれるときは、先に質問してから作る。
- 仕様は詰めてから、問題点を洗い出して直してから実装する（`docs/roadmap-v5.md` のように、洗い出した問題と対処を書き残す）。
