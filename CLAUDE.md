# マギア・タワー — Claude 向けメモ

ローカルでもクラウドでも、このリポジトリで作業する Claude は最初にこれを読むこと。
ゲームの仕様の詳細は README.md にある。

## 必ず守ること

- **返答は必ず日本語。** 英語で返すと強く嫌がられる。コミットメッセージも日本語で書く。
- **フォントのライセンス（最重要）。** ダメージ数字は「ゆうたONE / Y1StadiumSlab-Block」をラスタライズした PNG だけを使う
  （`assets/dmg-font/`。文化祭版は同じ画像を data URI にした `festival/dmg-glyphs.js`）。
  - `.otf` `.ttf` `.woff` などのフォントファイルや、そこから文字を復元できるデータを、リポジトリにも公開物にも**絶対に入れない**。
    第三者が吸い出せる形はすべて規約違反になる（`assets/dmg-font/LICENSE-NOTE.txt`）。
  - 新しい文字が必要になったら、自分でフォントを探して組み込まず、ユーザーに PNG 化を頼む。
- **プッシュすると本番に公開される。** プッシュはユーザーが頼んだときだけ行う。
- **ユーザーのセーブを壊さない。** ブラウザで動作確認するときは、先に localStorage のセーブを退避してから試し、終わったら元に戻す。
  ゲーム自身が pagehide / visibilitychange でセーブを書き戻すので、戻すときは別キーを使う文化祭版 `/festival/` のページから書き込むと確実。

## 構成

- 本編：静的サイト。`index.html` / `style.css` / `game.js`（全体が1つの IIFE）、巨大数は `vendor/break_infinity.min.js`（MIT）。
  - セーブは localStorage の `magiaTower.save.v2`。フィールドを足すときは `defaultSave()` に追加し、意味を変えるときは `loadSave()` で移行する。
- 文化祭版：`festival/`。本編とは別のセーブ・別のコードで、ラスボスまで15〜20分の体験版。`enemies/` と `assets/` の一部は共通。
  - `festival/tools/` はバランス確認用（公開物からは除外）。
- ビルド工程はない。ローカルではリポジトリ直下で静的サーバーを立てて開く（`file://` では画像グリフが出ない）。
  例：`python -m http.server 8746`

## デバッグ

- URL に `?debug=1`：手札に即死・確定会心カード、ソウル・転生ポイント・ゴールドが常に 1E15 に補充される（セーブにも残る）。
- localhost で開くと開発コンソール `mt` が使える（`mt.help()`）。
- ヘッドレス確認は jsdom で `index.html` と `game.js` を読み込む方式が使える。その場合は `vendor/break_infinity.min.js` を先に評価し、
  `performance.now` を仮想時間に差し替えないと、階の開始直後300msの入力ガードでカードが打てない。

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
- `.vercelignore` で `.claude` / `festival/tools` / この `CLAUDE.md` を公開物から外している。
- コミットの末尾には `Co-Authored-By:` の行を付ける。

## ユーザーの好み（これまでのやり取りから）

- インクリメンタル（数字が指数関数的に伸びる）であることがこのゲームの魅力。バランス調整でもその爽快感を残す。
- テンポ重視・スタイリッシュな見た目。演出は明滅より「常に光っている」ほうが好まれる。
- 基本強化ツリーの全体の形は変えない（位置の調整は重ならない範囲で最小限に）。
- 依頼が多いときや仕様が分かれるときは、先に質問してから作る。
