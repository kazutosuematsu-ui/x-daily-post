require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');
const { google } = require('googleapis');

// --live オプションを付けたときだけ実際に投稿する
const isLive = process.argv.includes('--live');

// 今日の日付・曜日を JST（日本時間）で取得する
const now = new Date();
const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
const today = jstDate.toISOString().slice(0, 10); // YYYY-MM-DD
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const todayWeekday = WEEKDAYS[jstDate.getUTCDay()]; // 今日の曜日（例: "月"）

// Google Drive の共有URLからファイルIDを抽出する
function extractFileId(input) {
  if (!input) return null;
  const match1 = input.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match1) return match1[1];
  const match2 = input.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match2) return match2[1];
  return input.trim() || null;
}

async function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });
}

async function downloadDriveFile(auth, fileId) {
  const drive = google.drive({ version: 'v3', auth });
  const meta = await drive.files.get({ fileId, fields: 'name,mimeType' });
  const mimeType = meta.data.mimeType;
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return { buffer: Buffer.from(res.data), mimeType };
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

  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // スプレッドシートから A〜D 列を取得する
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:D`,
  });

  const rows = res.data.values || [];
  let targetRowIndex = -1;
  let postText = '';
  let mediaInput = '';

  // 今日の曜日と一致する行を探す（1行目はヘッダーなのでスキップ）
  for (let i = 1; i < rows.length; i++) {
    const weekday = (rows[i][0] || '').trim();
    const lastPostedDate = (rows[i][2] || '').trim();

    if (weekday === todayWeekday) {
      // 今日すでに投稿済みか確認する
      if (lastPostedDate === today) {
        console.log('今日の投稿はすでに完了しています。');
        console.log('（日付: ' + today + '、曜日: ' + todayWeekday + '）');
        process.exit(0);
      }
      postText = (rows[i][1] || '').trim();
      mediaInput = (rows[i][3] || '').trim();
      targetRowIndex = i;
      break;
    }
  }

  if (targetRowIndex === -1) {
    console.log('今日（' + todayWeekday + '曜日）の投稿がスプレッドシートに見つかりませんでした。');
    console.log('A列に曜日（月・火・水・木・金・土・日）を入力してください。');
    process.exit(0);
  }

  if (!postText) {
    console.error('[エラー] B列の投稿文が空です。スプレッドシートを確認してください。');
    process.exit(1);
  }

  const fileId = extractFileId(mediaInput);

  console.log('========================================');
  console.log('【今日のX投稿】 ' + today + '（' + todayWeekday + '曜日）');
  console.log('モード: ' + (isLive ? '🚀 LIVE（実際に投稿します）' : '🧪 DRY-RUN（投稿しません）'));
  console.log('メディア: ' + (fileId ? 'あり（ID: ' + fileId + '）' : 'なし'));
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
    let mediaId = null;

    if (fileId) {
      console.log('\nGoogle Driveからメディアをダウンロード中...');
      const { buffer, mimeType } = await downloadDriveFile(auth, fileId);
      console.log('✔ ダウンロード完了（タイプ: ' + mimeType + '）');

      console.log('Xにメディアをアップロード中...');
      mediaId = await client.v1.uploadMedia(buffer, { mimeType });
      console.log('✔ メディアアップロード完了');
    }

    console.log('\nXに投稿中...');
    const tweetData = { text: postText };
    if (mediaId) {
      tweetData.media = { media_ids: [mediaId] };
    }
    const response = await client.v2.tweet(tweetData);
    const tweetId = response.data.id;

    console.log('✔ 投稿成功！');
    console.log('  URL: https://x.com/i/web/status/' + tweetId);

    // C列に今日の日付を記録する（次回同じ曜日に再投稿するため）
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!C${targetRowIndex + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[today]] },
    });

    console.log('✔ スプレッドシートの最終投稿日を更新しました。');
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
