// ============================================================
// config.gs - PWA API 設定値
// ============================================================

// --- Google Sheets (データDB) ---
// PWA用スプレッドシートのID（新規作成後に設定）
var SPREADSHEET_ID = '1QOGLA_VL0x2FlD3WV_Vc6LJitGLI9yoCZTGbU6aCbFo';

// シート名
var SHEET_SHIFTS  = 'シフト';
var SHEET_STAFF   = 'スタッフ';
var SHEET_LOGS    = '送信ログ';
var SHEET_SETTINGS = '設定';

// --- LINE WORKS API ---
var LW_CLIENT_ID       = 'iAWkZErjLqvOtg8cAkE7';
var LW_CLIENT_SECRET   = 'TR2q7Utpio';
var LW_SERVICE_ACCOUNT = 'mi56a.serviceaccount@enrission-46cafe';
var LW_BOT_ID          = 'xxxxxxxxxx'; // Bot作成後に設定
var LW_CHANNEL_ID      = '87395b42-402f-e1fc-a646-39b288150c5e';
var LW_PRIVATE_KEY     = '-----BEGIN PRIVATE KEY-----\n' +
'MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC6nllx8x7FBDmD\n' +
'OeA6LTWAo7UQHmWagNKM+VC83xTJiUNxxFoxI5W8l8tHssLbt73JiH5z6K1VrFXg\n' +
'CUHEovK2BTCQTdGglfwmFjNmpci9yTjt5Q/kVPI2MumNBzIZw2Vwg/NXa0lM8nQl\n' +
'lyfJ6oDyR4i2T7UvqG1I5yF8+mynYLPM91wXyavDHAig4+C/mdmjeqe4lVutBzbO\n' +
'KVL4IFKRXp5GMB5BNrylM+aceq0QVFZuxytKrpq1VEmI2sWFuSz3wYnfOZVhhxi/\n' +
'iPqU239DegZ46aNW9xsbhzSUnWamiPn/zBbqpsaOIOfyTDEnANzBkdSyvFqW2ll1\n' +
'cuF0iW/JAgMBAAECggEASqxyPhZ6iXtXSBswjhbpAcCAAyMmpNxHZAGfPPRG7R3v\n' +
'zuYy8Na8Y+qZfOca8bBkUPA9KURBl7aN5kfN+VD6rbsF47g/2XIqo1Le3oQX/1k1\n' +
'Xnv6D/Ott+JHchcfBRAa1xr1lFVpz1B1CVWipjkfv9K/8bOTXK6YjENwMwJB1/c6\n' +
'JrUqTykA40HYSvZAdssAjq3q+Lt9UnVK9KW05Yh1Cgpp1zZrne19lWc7QRcQIq/w\n' +
'Pqk4W67k1KY8afFoe+QqSrFwzA8EiSrF0QfYPc1hVU3TV3DjEN3hDj0znLa24HVG\n' +
'Zjf/VIyzjVBIOAgIqXE2YgBTj5990W8ZFpQ3xrL4wQKBgQDx/gXQOrwhM5nNtxNO\n' +
'TWANZkE3zs3lfu1LKad/aVK9o1JwLpZ8l8RZm8+JPeZhNQ2shOaHlyTM8Ucx/9o1\n' +
'xP7s17m1DfoIWmD8a2uM6XdzFPKUDW8r9IiHuZRdpUhDQ274XGINGvV3a2qHHR38\n' +
'CryMqunoDweJS/sStvzfeJ4jHwKBgQDFa8SNihUJvO8j0/ZCWR98VIMQ4hAIPYnv\n' +
'm0kJBbENLIewz0fCQ4Usf0VGo+gA8exbDMW0rbA44SayegdpCxuniTCkRA1AQeJV\n' +
'OUXKtI0ifbogDginyYKMtEd6XzjVEINenfaOw9xW2PO1QHuEISsq4hwT2ChE3bk4\n' +
'AaZxjiq4FwKBgQDPxFWhboxPxUnsQZ8lv3EUkBK2o6xLuipqOh1BW2BayXriLl2u\n' +
'I2/Fr+0D3E2McEyJLqHvEGncO9vwpcboG3b0SlN7i8B8o3xZvLDejySrffS4AMDO\n' +
'cGk4frFPpbTha2g/fLICpn7SRTt1Ph6cY2t3KtchEqZZzw6GBu4dwCWl6QKBgQCH\n' +
'mSvZ49vrYmAHBdGBZOGhbhLQB9XnMw2JC+mwTr57Q/i3UsgBAIt6MriMeowiCgjD\n' +
'yRQKs7n0d4Ey2Wo5li2adzp3uV44oogo7TuorTa7WAv9dGYxiNEof7MQtFK+1abF\n' +
'2E2/ZXv0EvPhrLap3HZf8ApE/xU5p+lONKP0HyfsZQKBgBLKiK6m4yyibhhHcXZO\n' +
'UMlLGoVnpR8pZUJQg9REMWZkDLApN4FKpBUeN86NPPDdN8sXOxffKMe4Z4bkBb9P\n' +
'GmrqaBLRD6F9JLgjnrHEqi6F9ug8/7MqG3U/2OukOeSCf1dQQA9+tN7OsfW6/u93\n' +
'beihWHqXzTskisXI1XMQK4NY\n' +
'-----END PRIVATE KEY-----';

var LW_AUTH_URL  = 'https://auth.worksmobile.com/oauth2/v2.0/token';
var LW_API_BASE  = 'https://www.worksapis.com/v1.0';

// --- トークン有効期限（日数） ---
var TOKEN_EXPIRY_DAYS = 30;

// --- タイムゾーン ---
var TIMEZONE = 'Asia/Tokyo';
