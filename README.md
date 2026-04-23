# x-daily-post

Google Spreadsheet で管理した投稿文を、毎日 18:00 JST に X（Twitter）へ自動投稿するツールです。
GitHub Actions で動作するため、PC を起動しておく必要はありません。

---

## スプレッドシートの形式

| A列（投稿日）  | B列（投稿文）         | C列（ステータス） |
|---------------|-----------------------|----------------|
| 2026-04-23    | 今日の投稿内容をここに | （自動入力）    |
| 2026-04-24    | 明日の投稿内容をここに |                |

- **A列**：`YYYY-MM-DD` 形式で投稿日を入力
- **B列**：投稿したいテキストを入力（最大280文字）
- **C列**：投稿後に自動で「投稿済み」と記入されます。手動で入力しないでください。
- 1行目はヘッダー行として扱われます（内容は何でも構いません）

---

## セットアップ手順

### 1. Google Cloud の設定

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. **Google Sheets API** を有効化
3. **サービスアカウント**を作成し、JSON 形式のキーをダウンロード
4. スプレッドシートを開き、サービスアカウントのメールアドレスに**編集権限**を付与

### 2. スプレッドシートの準備

1. Google Spreadsheet を新規作成
2. 上記の形式でデータを入力
3. URL から **Spreadsheet ID** をメモ（`/d/〇〇〇/edit` の〇〇〇の部分）

### 3. GitHub リポジトリの準備

1. GitHub に新しいリポジトリを作成（Private 推奨）
2. このディレクトリをプッシュ:

```bash
git remote add origin https://github.com/あなたのユーザー名/リポジトリ名.git
git push -u origin main
```

### 4. GitHub Secrets の設定

GitHub リポジトリの **Settings → Secrets and variables → Actions** で以下を登録:

| Secret 名 | 内容 |
|-----------|------|
| `X_API_KEY` | X API Key |
| `X_API_SECRET` | X API Secret |
| `X_ACCESS_TOKEN` | X Access Token |
| `X_ACCESS_TOKEN_SECRET` | X Access Token Secret |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | サービスアカウントの JSON ファイルの中身をそのまま貼り付け |
| `SPREADSHEET_ID` | スプレッドシートの ID |

---

## 投稿時刻の変更方法

`.github/workflows/daily-post.yml` の cron 式を変更してください。

```yaml
- cron: '0 9 * * *'  # 18:00 JST（= 09:00 UTC）
```

JST と UTC の変換：JST = UTC + 9時間

| 投稿したい時刻（JST） | cron 式 |
|----------------------|---------|
| 12:00 | `0 3 * * *` |
| 18:00 | `0 9 * * *` |
| 20:00 | `0 11 * * *` |
| 21:00 | `0 12 * * *` |

---

## ローカルでのテスト方法

`.env` ファイルを作成して認証情報を設定した後:

```bash
# dry-run（Xには投稿しない・内容確認用）
node post.js

# live（実際に投稿する）
node post.js --live
```

---

## 動作の仕組み

1. GitHub Actions が毎日 18:00 JST に `post.js --live` を実行
2. スプレッドシートから今日の日付（A列）に対応する行を検索
3. B列の投稿文を X API で投稿
4. 投稿成功後、C列のステータスを「投稿済み」に更新
