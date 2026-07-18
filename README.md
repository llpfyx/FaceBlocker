# FaceBlocker

ニンテンドー3DSの「フェイスレイダーズ」風、顔シューティングゲームのWeb版。
カメラで撮影 or アップロードした顔写真が敵になり、地球から冥王星まで惑星を巡る宇宙空間で
襲いくる敵を撃退するエンドレスサバイバルシューティングです。
ビルド不要・素のHTML/CSS/JavaScript + Three.js で動作します。

## 遊び方

1. `index.html` を静的ホスティングするか、ローカルサーバーで開く（`file://` 直開きはカメラAPIの制約で動きません。下記「ローカルで動かす」参照）
2. タイトル画面でプレイヤー名を入力し「ゲームスタート」
3. カメラ（内/外選択可）で撮影 or 画像をアップロードし、顔の範囲を四角で選択
4. 「たたかう」でゲーム開始
   - PC: 画面クリックでマウスロック → マウスで狙ってクリックで発射
   - スマホ: 画面をドラッグで狙う → 右下のFIREボタンで発射（「傾きセンサーを有効にする」でジャイロ照準にも切替可、360度対応）
   - 画面外にいる敵は画面端に矢印で表示されます
5. 敵は倒すごとにスコア加算、一定数倒すと「フェーズ」が上がり、敵のHP・攻撃力・出現速度が上昇。
   フェーズが進むごとに背景の惑星も水星→金星→地球→火星→木星→土星→天王星→海王星→冥王星と切り替わる
6. 倒しきれず敵の攻撃を受けるとHPが減少。HPが0になったらゲームオーバー（制限時間なし、死ぬまで続く）
7. ゲームオーバー画面からスコアをグローバルランキングに送信可能。「リプレイ」で同じ顔・名前のまま即再戦できる

顔写真はプレイヤー自身の端末のみに保存され（じぶんの記録画面）、グローバルランキングには
**スコア・フェーズ・ユーザー名のみ**が送信されます（写真は送信されません）。

## ローカルで動かす

Node.js が入っていれば、プロジェクトルートで：

```bash
npx serve .
```

または VSCode の Live Server 拡張機能でも可。ブラウザで `http://localhost:xxxx` を開いてください。
カメラAPI (`getUserMedia`) は `https` または `localhost` でないと動作しない点に注意してください。

## グローバルランキングを有効にする（Firebase）

デフォルトでは `src/firebaseConfig.js` が空のため、ランキングは**この端末のlocalStorageのみ**に保存されます
（プレイは可能、ランキングは自分だけに見える状態）。世界共通のランキングにするには：

1. [Firebase コンソール](https://console.firebase.google.com/) で新規プロジェクトを作成
2. 「Firestore Database」を作成（本番モードでOK。ルールは後述の `firestore.rules` を反映）
3. 「プロジェクトの設定 > 全般 > マイアプリ」でWebアプリを追加し、表示された `firebaseConfig` の値を
   `src/firebaseConfig.js` にコピペ
4. Firebase CLI でルールをデプロイ（任意）:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase init firestore   # 既存プロジェクトを選択、firestore.rules はそのまま使う
   firebase deploy --only firestore:rules
   ```
5. これで `git push` 後にGitHub Pages等へデプロイすれば、誰がプレイしてもグローバルランキングに反映されます

`firestore.rules` は「誰でも読み取り可・新規作成のみ可・編集/削除不可」というシンプルな設計にしてあります。
不正な形式のスコア（型が違う、名前が長すぎる等）は書き込み時点で弾かれます。

## 技術構成

- Three.js (`import "three"`, CDN経由のESM importmap、ビルド不要)
- 素のHTML/CSS/JavaScript（VSCodeでそのまま編集・確認可能）
- Firebase Firestore（グローバルランキング、未設定時はlocalStorageに自動フォールバック）
- WebAudio APIで効果音・BGMを合成し、一部は実録音サンプルとレイヤー化（下記クレジット参照）

## 素材クレジット

画像生成AIが使えない環境のため、グラフィックの大半（惑星・ヘルメット3段階・UI等）は
Canvas 2Dによる手続き的な自作です。一部、以下の著作権フリー素材を使用しています：

- **`assets/models/DamagedHelmet.glb`** — Khronos Group公式の glTF-Sample-Assets より。
  © 2018 ctxwing, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)（要クレジット）。
  フェーズ7以降の敵が被る最上位ヘルメットとして使用。
- **`assets/audio/*.ogg`** — [Kenney](https://kenney.nl) の "Sci-Fi Sounds" パックより
  （レーザー音・爆発音・金属衝撃音）。[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
  （クレジット不要、著作権フリー）。

詳細は各ディレクトリ内の `LICENSE.txt` を参照してください。

## ディレクトリ構成

```
index.html          画面構成（タイトル/撮影/準備/プレイ/ゲームオーバー/ランキング/履歴）
style.css            3DS風デュアルスクリーンを意識したUIスタイル
src/
  main.js             画面遷移・全体の配線
  camera.js           カメラ撮影・アップロード・顔クロップUI（楕円マスク切り抜き）
  game.js             Three.js製シューティングのゲームロジック（視点操作・射撃・フェーズ制敵AI）
  space.js            惑星・星空の宇宙背景（水星〜冥王星、フェーズ連動）
  helmets.js          フェーズ連動ヘルメット（手続き生成3段階＋実体3Dモデル1段階）
  titleScene.js        タイトル画面の浮遊3Dシーン
  audio.js            効果音・バトルBGM（WebAudio合成＋実録音サンプル）
  ranking.js          グローバルランキング（Firebase）＋ローカル履歴
  firebaseConfig.js   Firebase設定（要編集、空でもローカルモードで動作）
assets/
  models/             3Dモデル素材（LICENSE.txt参照）
  audio/              効果音サンプル素材（LICENSE.txt参照）
firestore.rules      Firestoreセキュリティルール（参考・デプロイ用）
```
