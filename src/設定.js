// ============================================================
// config.gs - 設定値・スタッフマッピング
// ============================================================

// --- Google Sheets (PWA共有データDB) ---
// PWA APIと同じスプレッドシートを参照する
const SPREADSHEET_ID = '1QOGLA_VL0x2FlD3WV_Vc6LJitGLI9yoCZTGbU6aCbFo';
const SHEET_SHIFTS = 'シフト';
const SHEET_STAFF = 'スタッフ';
const SHEET_LOGS = '送信ログ';
const SHEET_SETTINGS = '設定';
const SHEET_MEETING = '店舗ミーティング'; // 実施日・時間 → 顧客カレンダーで前後1時間を貸切表示

// --- Google Drive (PDFフォールバック用) ---
const DRIVE_FOLDER_ID = '1sCuvYSNrekWdzpvvSlZq2SgPvZNyvc-D'; // シフトPDF格納フォルダのID

// --- LINE WORKS API ---
// Developer Console (https://dev.worksmobile.com) で取得
const LINEWORKS_CLIENT_ID = 'iAWkZErjLqvOtg8cAkE7';
const LINEWORKS_CLIENT_SECRET = 'TR2q7Utpio';
const LINEWORKS_SERVICE_ACCOUNT = 'mi56a.serviceaccount@enrission-46cafe';
const LINEWORKS_BOT_ID = '11633064'; // シフトリマインダーBot
const LINEWORKS_CHANNEL_ID_PROD = '87395b42-402f-e1fc-a646-39b288150c5e'; // シフトリマインド本番グループ
const LINEWORKS_CHANNEL_ID_TEST = '6181d196-faeb-3828-33ce-239454a2967c'; // テストグループ（共通）
var LINEWORKS_CHANNEL_ID = LINEWORKS_CHANNEL_ID_PROD;

const MEETUP_CHANNEL_ID_PROD = '343ae3b2-19ee-14e6-ae62-e01b5ae02be5'; // Meetup告知本番グループ
const MEETUP_CHANNEL_ID_TEST = '6181d196-faeb-3828-33ce-239454a2967c'; // テストグループ（共通）
var MEETUP_CHANNEL_ID = MEETUP_CHANNEL_ID_PROD;

const YUCHI_CHANNEL_ID_PROD = 'c3797a6d-7c30-2d0c-6390-c8cb62a70d92'; // 誘致情報本番グループ
const YUCHI_CHANNEL_ID_TEST = '6181d196-faeb-3828-33ce-239454a2967c'; // テストグループ（共通）
var YUCHI_CHANNEL_ID = YUCHI_CHANNEL_ID_PROD;

const SHIFT_CHANGE_BOT_ID = '11909229'; // シフト交代通知Bot
const SHIFT_CHANGE_CHANNEL_ID_PROD = '6e5b33f4-140b-92d1-78e1-754cbb00ff0e'; // シフト交代通知本番グループ
const SHIFT_CHANGE_CHANNEL_ID_TEST = '6181d196-faeb-3828-33ce-239454a2967c'; // テストグループ（共通）
var SHIFT_CHANGE_CHANNEL_ID = SHIFT_CHANGE_CHANNEL_ID_PROD;

const TROUBLE_REPORT_CHANNEL_ID_PROD = 'edbdefad-9be6-f281-cd94-2da7b744a884'; // 緊急シフト変更(トラブル)報告用
var TROUBLE_REPORT_CHANNEL_ID = TROUBLE_REPORT_CHANNEL_ID_PROD;

const KANBU_CHANNEL_ID_PROD = 'edbdefad-9be6-f281-cd94-2da7b744a884'; // 幹部グループ（シフト交代・募集通知用）
var KANBU_CHANNEL_ID = KANBU_CHANNEL_ID_PROD;

/**
 * 設定シートのテストモード設定を読み込み、各BotのチャンネルIDを更新する
 * 各Botのエントリ関数の先頭で呼び出すこと
 *
 * 設定シートの行:
 *   テストモード          → シフトリマインドBot (LINEWORKS_CHANNEL_ID)
 *   Meetupテストモード    → Meetup告知Bot     (MEETUP_CHANNEL_ID)
 *   誘致テストモード      → 誘致Bot           (YUCHI_CHANNEL_ID)
 */
function initChannelId_() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      var key = String(data[i][0]);
      var isTest = data[i][1] === true || String(data[i][1]).toUpperCase() === 'TRUE';

      if (key === 'テストモード') {
        LINEWORKS_CHANNEL_ID = isTest ? LINEWORKS_CHANNEL_ID_TEST : LINEWORKS_CHANNEL_ID_PROD;
        Logger.log('シフトリマインドチャンネル: ' + (isTest ? 'テスト' : '本番'));
      } else if (key === 'Meetupテストモード') {
        MEETUP_CHANNEL_ID = isTest ? MEETUP_CHANNEL_ID_TEST : MEETUP_CHANNEL_ID_PROD;
        Logger.log('Meetupチャンネル: ' + (isTest ? 'テスト' : '本番'));
      } else if (key === '誘致テストモード') {
        YUCHI_CHANNEL_ID = isTest ? YUCHI_CHANNEL_ID_TEST : YUCHI_CHANNEL_ID_PROD;
        Logger.log('誘致チャンネル: ' + (isTest ? 'テスト' : '本番'));
      } else if (key === 'シフト交代テストモード') {
        SHIFT_CHANGE_CHANNEL_ID = isTest ? SHIFT_CHANGE_CHANNEL_ID_TEST : SHIFT_CHANGE_CHANNEL_ID_PROD;
        TROUBLE_REPORT_CHANNEL_ID = isTest ? SHIFT_CHANGE_CHANNEL_ID_TEST : TROUBLE_REPORT_CHANNEL_ID_PROD;
        KANBU_CHANNEL_ID = isTest ? SHIFT_CHANGE_CHANNEL_ID_TEST : KANBU_CHANNEL_ID_PROD;
        Logger.log('シフト交代チャンネル(＋トラブル・幹部): ' + (isTest ? 'テスト' : '本番'));
      }
    }
  } catch (e) {
    Logger.log('チャンネルID初期化エラー: ' + e.message);
  }
}

// --- Meetup企業選択フォーム ---
const MEETUP_FORM_ID = '16jvJ4z6reUwimTsVZQsU6s0Rf3US2VpQpA7k7amNOr0';
const MEETUP_APPEAL_QUESTION_TITLE = '各企業のアピールポイント';

// --- Meetup告知Bot ---
const MEETUP_BOT_ID = '11785488';
const MEETUP_BOT_SECRET = 'qCMEFjG0m+Acg8qYdr0bZopyXg/IMy';
const LINEWORKS_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC6nllx8x7FBDmD
OeA6LTWAo7UQHmWagNKM+VC83xTJiUNxxFoxI5W8l8tHssLbt73JiH5z6K1VrFXg
CUHEovK2BTCQTdGglfwmFjNmpci9yTjt5Q/kVPI2MumNBzIZw2Vwg/NXa0lM8nQl
lyfJ6oDyR4i2T7UvqG1I5yF8+mynYLPM91wXyavDHAig4+C/mdmjeqe4lVutBzbO
KVL4IFKRXp5GMB5BNrylM+aceq0QVFZuxytKrpq1VEmI2sWFuSz3wYnfOZVhhxi/
iPqU239DegZ46aNW9xsbhzSUnWamiPn/zBbqpsaOIOfyTDEnANzBkdSyvFqW2ll1
cuF0iW/JAgMBAAECggEASqxyPhZ6iXtXSBswjhbpAcCAAyMmpNxHZAGfPPRG7R3v
zuYy8Na8Y+qZfOca8bBkUPA9KURBl7aN5kfN+VD6rbsF47g/2XIqo1Le3oQX/1k1
Xnv6D/Ott+JHchcfBRAa1xr1lFVpz1B1CVWipjkfv9K/8bOTXK6YjENwMwJB1/c6
JrUqTykA40HYSvZAdssAjq3q+Lt9UnVK9KW05Yh1Cgpp1zZrne19lWc7QRcQIq/w
Pqk4W67k1KY8afFoe+QqSrFwzA8EiSrF0QfYPc1hVU3TV3DjEN3hDj0znLa24HVG
Zjf/VIyzjVBIOAgIqXE2YgBTj5990W8ZFpQ3xrL4wQKBgQDx/gXQOrwhM5nNtxNO
TWANZkE3zs3lfu1LKad/aVK9o1JwLpZ8l8RZm8+JPeZhNQ2shOaHlyTM8Ucx/9o1
xP7s17m1DfoIWmD8a2uM6XdzFPKUDW8r9IiHuZRdpUhDQ274XGINGvV3a2qHHR38
CryMqunoDweJS/sStvzfeJ4jHwKBgQDFa8SNihUJvO8j0/ZCWR98VIMQ4hAIPYnv
m0kJBbENLIewz0fCQ4Usf0VGo+gA8exbDMW0rbA44SayegdpCxuniTCkRA1AQeJV
OUXKtI0ifbogDginyYKMtEd6XzjVEINenfaOw9xW2PO1QHuEISsq4hwT2ChE3bk4
AaZxjiq4FwKBgQDPxFWhboxPxUnsQZ8lv3EUkBK2o6xLuipqOh1BW2BayXriLl2u
I2/Fr+0D3E2McEyJLqHvEGncO9vwpcboG3b0SlN7i8B8o3xZvLDejySrffS4AMDO
cGk4frFPpbTha2g/fLICpn7SRTt1Ph6cY2t3KtchEqZZzw6GBu4dwCWl6QKBgQCH
mSvZ49vrYmAHBdGBZOGhbhLQB9XnMw2JC+mwTr57Q/i3UsgBAIt6MriMeowiCgjD
yRQKs7n0d4Ey2Wo5li2adzp3uV44oogo7TuorTa7WAv9dGYxiNEof7MQtFK+1abF
2E2/ZXv0EvPhrLap3HZf8ApE/xU5p+lONKP0HyfsZQKBgBLKiK6m4yyibhhHcXZO
UMlLGoVnpR8pZUJQg9REMWZkDLApN4FKpBUeN86NPPDdN8sXOxffKMe4Z4bkBb9P
GmrqaBLRD6F9JLgjnrHEqi6F9ug8/7MqG3U/2OukOeSCf1dQQA9+tN7OsfW6/u93
beihWHqXzTskisXI1XMQK4NY
-----END PRIVATE KEY-----`;

// --- LINE WORKS API エンドポイント ---
const LINEWORKS_AUTH_URL = 'https://auth.worksmobile.com/oauth2/v2.0/token';
const LINEWORKS_API_BASE = 'https://www.worksapis.com/v1.0';

// --- スプレッドシート ---
// シフト変更フォーマット管理
const SHIFT_CHANGE_SPREADSHEET_ID = '1QOGLA_VL0x2FlD3WV_Vc6LJitGLI9yoCZTGbU6aCbFo'; // ID統一
const SHIFT_CHANGE_SHEET_NAME = 'シフト変更';        // シート名 (使用しないかもだが一応残す)

// 営業時間設定管理
const BUSINESS_HOURS_SPREADSHEET_ID = '1QOGLA_VL0x2FlD3WV_Vc6LJitGLI9yoCZTGbU6aCbFo'; // ID統一
const BUSINESS_HOURS_SHEET_NAME = '営業時間';            // お客様向け営業時間（顧客カレンダー用）
const STAFF_HOURS_SHEET_NAME    = 'スタッフ勤務時間';    // スタッフ向け勤務時間（シフト不足チェック用）
const REQUIRED_OPE_SHEET_NAME   = '必要オペ数';          // 時間帯別必要オペ数（シフト不足判定用）

// --- アラート設定 ---
const SHIFT_SHORTAGE_ALERT_DAYS = 5; // 何日後のシフト不足を検知するか

// --- 期間設定 ---
const SHEET_PERIOD_SETTINGS   = '期間設定';         // 授業期間/ターム休みの日程管理シート
const SHEET_MEETING_ATTENDANCE = '店舗ミーティング参加'; // 参加確認シート（実施日/スタッフ名/参加区分/理由/登録日時）

// --- スタッフマッピング ---
// 初期値（フォールバック用）。PWA運用後は「スタッフ」シートから自動読み込み。
// main() 実行時に loadStaffMappingFromSheets_() で上書きされる。
var STAFF_MAPPING = {
  '星野竜大': 'hoshino@xxx.com',
  '杉本尚哉': 'sugimoto@xxx.com',
  '武田祥哉': 'takeda@xxx.com',
  '田中勇平': 'tanaka@xxx.com',
  // ↓ スタッフ追加時はここに追記 ↓
  // '新スタッフ名': 'account@xxx.com',
};

// --- タイムゾーン ---
const TIMEZONE = 'Asia/Tokyo';

// --- Gemini API ---
// GASエディタ「プロジェクトの設定」→「スクリプトプロパティ」に GEMINI_API_KEY を設定してください
// 取得先: https://aistudio.google.com → Get API key → Create API key（無料）
const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';
