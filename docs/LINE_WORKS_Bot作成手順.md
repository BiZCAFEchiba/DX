# LINE WORKS Bot 作成手順

## 前提
- LINE WORKSの**管理者権限**が必要
- 管理者でない場合は、組織の管理者に依頼してください

---

## Step 1: LINE WORKS Developer Console にアクセス

1. https://dev.worksmobile.com にアクセス
2. LINE WORKSアカウントでログイン（管理者アカウント）
3. 「Console」画面が表示される

---

## Step 2: アプリを作成する

1. 左メニューの **「API 2.0」** をクリック
2. **「アプリの新規追加」** をクリック
3. 以下を入力：
   - **アプリ名**: `ShiftReminderBot`（任意の名前）
   - **説明**: 
4. **「保存」** をクリック

### ここで取得できる情報：
```
✅ Client ID       → config.gs の LINEWORKS_CLIENT_ID に設定
✅ Client Secret   → config.gs の LINEWORKS_CLIENT_SECRET に設定
```

---

## Step 3: Service Account を発行する

1. 作成したアプリの詳細画面で **「Service Account」** セクションを確認
2. **「Service Account 発行」** をクリック
3. Service Account ID が表示される

### ここで取得できる情報：
```
✅ Service Account ID → config.gs の LINEWORKS_SERVICE_ACCOUNT に設定
   （例: xxxxx.serviceaccount@xxx）
```

---

## Step 4: Private Key を発行する

1. Service Account セクション内の **「Private Key 発行」** をクリック
2. `.key` ファイルがダウンロードされる
3. ダウンロードした `.key` ファイルをテキストエディタで開く
4. 中身を全てコピーする

### ここで取得できる情報：
```
✅ Private Key → config.gs の LINEWORKS_PRIVATE_KEY に貼り付け
   （-----BEGIN PRIVATE KEY----- から -----END PRIVATE KEY----- まで全て）
```

> ⚠️ Private Key は再表示できません。紛失した場合は再発行が必要です。

---

## Step 5: OAuth Scope を設定する

1. アプリ詳細画面の **「OAuth Scopes」** セクション
2. **「管理」** をクリック
3. 以下のスコープにチェックを入れる：
   - ✅ `bot` （Botの利用）
4. **「保存」** をクリック

---

## Step 6: Bot を作成する

1. 左メニューの **「Bot」** をクリック
2. **「登録」** をクリック
3. 以下を入力：
   - **Bot名**: `シフトリマインド`（グループに表示される名前）
   - **説明**: 前日正午にシフトリマインドを送信
   - **管理者**: 自分のアカウントを選択
   - **Callback URL**: 空欄のまま（受信不要）
   - **トークルーム**: **複数人のトークルームに対応** にチェック
4. **「保存」** をクリック

### ここで取得できる情報：
```
✅ Bot ID → config.gs の LINEWORKS_BOT_ID に設定
   （例: 12345678）
```

---

## Step 7: Bot をグループに招待する

1. **LINE WORKS アプリ**（PC版またはスマホ版）を開く
2. シフトリマインドを送りたい**グループトーク**を開く
3. 右上の **メニュー（≡）** → **「メンバー招待」** または **「Bot追加」**
4. 作成した **「シフトリマインド」Bot** を選択して追加

> グループにBotが参加した状態でないとメッセージ送信できません。

---

## Step 8: config.gs に設定値を入力

全て取得したら `config.gs` を以下のように更新：

```javascript
const LINEWORKS_CLIENT_ID       = '取得したClient ID';
const LINEWORKS_CLIENT_SECRET   = '取得したClient Secret';
const LINEWORKS_SERVICE_ACCOUNT = '取得したService Account ID';
const LINEWORKS_BOT_ID          = '取得したBot ID';
const LINEWORKS_CHANNEL_ID      = '87395b42-402f-e1fc-a646-39b288150c5e'; // 設定済み
const LINEWORKS_PRIVATE_KEY     = `-----BEGIN PRIVATE KEY-----
ダウンロードした.keyファイルの中身をここに貼り付け
-----END PRIVATE KEY-----`;
```

---

## Step 9: テスト実行

1. GASエディタで `main.gs` を開く
2. 関数選択プルダウンで **`testParsePdf`** を選択
3. **「実行」** をクリック
4. 初回は権限承認ダイアログが出る → **「許可」** をクリック
5. 実行ログでPDF解析結果を確認

問題なければ：
1. 関数選択プルダウンで **`setupTrigger`** を選択
2. **「実行」** をクリック
3. 毎日12:00自動実行が設定される

---

## トラブルシューティング

| 問題 | 対処法 |
|------|--------|
| 「権限がありません」 | LINE WORKS管理者に権限付与を依頼 |
| Bot作成メニューが出ない | Developer Console の左メニュー「Bot」から作成 |
| メッセージが届かない | BotがグループにAdd済みか確認 |
| 認証エラー | Client ID/Secret/Private Key を再確認 |
| Private Keyエラー | .keyファイルの中身を改行含めて正確にコピー |
