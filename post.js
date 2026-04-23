require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');
const { google } = require('googleapis');

// --live オプションを付けたときだけ実際に投稿する
const isLive = process.argv.includes('--live');

// 今日の日付を JST（日本時間）で取得する
const now = new Date();
const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
const today = jstDate.toISOString().slice(0, 10); // YYYY-MM-DD

async function getSheetClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function main() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheetName = process.env.SHEET_NAME || 'Sheet1';

  if (!spreadsheetId) {
    console.error('[エラー] SPREADSHEET_ID が設定されていません。');
    process.exit(1);
  }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.error('[エラー] GOOGLE_SERVICE_ACCOUNT_JSON が設定されていません。');
    process.exit(1);
  }

  const sheets = await getSheetClient();

  // スプレッドシートから A〜C 列を取得する
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:C`,
  });

  const rows = res.data.values || [];

  // 1行目はヘッダーなのでスキップして今日の日付の行を探す
  let targetRowIndex = -1;
  let postText = '';

  for (let i = 1; i < rows.length; i++) {
    const date = (rows[i][0] || '').trim();
    const status = (rows[i][2] || '').trim();

    if (date === today) {
      if (status === '投稿済み') {
        console.log('今日の投稿はすでに完了しています。');
        console.log('（日付: ' + today + '）');
        process.exit(0);
      }
      postText = (rows[i][1] || '').trim();
      targetRowIndex = i;
      break;
    }
  }

  if (targetRowIndex === -1) {
    console.log('今日（' + today + '）の投稿がスプレッドシートに見つかりませんでした。');
    console.log('A列に今日の日付、B列に投稿文を追加してください。');
    process.exit(0);
  }

  if (!postText) {
    console.error('[エラー] B列の投稿文が空です。スプレッドシートを確認してください。');
    process.exit(1);
  }

  console.log('========================================');
  console.log('【今日のX投稿】 ' + today);
  console.log('モード: ' + (isLive ? '🚀 LIVE（実際に投稿します）' : '🧪 DRY-RUN（投稿しません）'));
  console.log('========================================');
  console.log(postText);
  console.log('========================================');

  if (!isLive) {
    console.log('\n[DRY-RUN] Xへの投稿はスキップしました。');
    console.log('実際に投稿するには --live オプションを付けて実行してください:');
    console.log('  node post.js --live');
    process.exit(0);
  }

  // 環境変数のチェック
  const requiredEnvVars = [
    'X_API_KEY',
    'X_API_SECRET',
    'X_ACCESS_TOKEN',
    'X_ACCESS_TOKEN_SECRET',
  ];
  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error('\n[エラー] .env に以下の値が設定されていません:');
    missing.forEach((key) => console.error('  - ' + key));
    process.exit(1);
  }

  // X API クライアントを初期化する
  const client = new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  });

  try {
    console.log('\nXに投稿中...');
    const response = await client.v2.tweet(postText);
    const tweetId = response.data.id;

    console.log('✔ 投稿成功！');
    console.log('  ツイートID: ' + tweetId);
    console.log('  URL: https://x.com/i/web/status/' + tweetId);

    // スプレッドシートのステータス列を「投稿済み」に更新する
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!C${targetRowIndex + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [['投稿済み']] },
    });

    console.log('\n✔ スプレッドシートのステータスを「投稿済み」に更新しました。');
  } catch (err) {
    console.error('\n[エラー] 投稿に失敗しました。');
    if (err.data) {
      console.error('  ステータスコード: ' + err.code);
      console.error('  メッセージ: ' + JSON.stringify(err.data, null, 2));
    } else {
      console.error('  ' + err.message);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[致命的エラー]', err.message);
  process.exit(1);
});
