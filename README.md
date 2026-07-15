# FACE RAIDERS WEB

ニンテンドー3DSの「フェイスレイダーズ」風、顔シューティングARゲームのWeb版。
カメラで撮影 or アップロードした顔写真が敵になり、ライブカメラ映像の上に出現する敵を撃退する
エンドレスサバイバルシューティングです。ビルド不要・素のHTML/CSS/JavaScript + Three.js で動作します。

## 遊び方

1. `index.html` を静的ホスティングするか、ローカルサーバーで開く（`file://` 直開きはカメラAPIの制約で動きません。下記「ローカルで動かす」参照）
2. タイトル画面でプレイヤー名を入力し「ゲームスタート」
3. カメラで撮影 or 画像をアップロードし、顔の範囲を四角で選択
4. 「たたかう」でゲーム開始
   - PC: 画面クリックでマウスロック → マウスで狙ってクリックで発射
   - スマホ: 画面をドラッグで狙う → 右下のFIREボタンで発射（「傾きセンサーを有効にする」でジャイロ照準にも切替可）
5. 敵は倒すごとにスコア加算、一定数倒すと「フェーズ」が上がり、敵のHP・攻撃力・出現速度が上昇していく
6. 倒しきれず敵の攻撃を受けるとHPが減少。HPが0になったらゲームオーバー（制限時間なし、死ぬまで続く）
7. ゲームオーバー画面からスコアをグローバルランキングに送信可能

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
- WebAudio APIで効果音を合成（音声ファイル不要）

## ディレクトリ構成

```
index.html          画面構成（タイトル/撮影/準備/プレイ/ゲームオーバー/ランキング/履歴）
style.css            3DS風デュアルスクリーンを意識したUIスタイル
src/
  main.js             画面遷移・全体の配線
  camera.js           カメラ撮影・アップロード・顔クロップUI
  game.js             Three.js製ARシューティングのゲームロジック（視点操作・射撃・フェーズ制敵AI）
  audio.js            効果音（WebAudio合成）
  ranking.js          グローバルランキング（Firebase）＋ローカル履歴
  firebaseConfig.js   Firebase設定（要編集、空でもローカルモードで動作）
firestore.rules      Firestoreセキュリティルール（参考・デプロイ用）
```
