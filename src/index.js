// ============================================
// VERI-K Telegram Bot - Main Entry Point
// Railway 24/7 Server
// ============================================

const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const { supabase } = require('./config/supabase');
const { handleStart, handleCommand } = require('./handlers/commands');
const { handleQuizCallback, handleListeningCallback } = require('./handlers/quiz');
const { handleWordCardCallback } = require('./handlers/wordcard');
const { handleAdminCommand, handleBroadcast, handleGenerateCards, handleGenerateTTS } = require('./handlers/admin');
const { sendMorningContent, sendVideoLinks, sendEveningQuiz } = require('./services/scheduler');
const { checkInactiveStudents } = require('./services/monitoring');
const { sendSundayReview } = require('./services/review');

// ── Bot 초기화 ──
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
console.log('🤖 VERI-K Bot started!');

// ── 메시지 핸들러 ──
bot.onText(/\/start/, (msg) => handleStart(bot, msg));
bot.onText(/\/quiz/, (msg) => handleCommand(bot, msg, 'quiz'));
bot.onText(/\/progress/, (msg) => handleCommand(bot, msg, 'progress'));
bot.onText(/\/help/, (msg) => handleCommand(bot, msg, 'help'));

// 관리자 명령어
bot.onText(/\/admin/, (msg) => handleAdminCommand(bot, msg));
bot.onText(/\/broadcast (.+)/, (msg, match) => handleBroadcast(bot, msg, match[1]));
bot.onText(/\/generate_cards (\d+)/, (msg, match) => handleGenerateCards(bot, msg, match[1]));
bot.onText(/\/generate_tts (\d+)/, (msg, match) => handleGenerateTTS(bot, msg, match[1]));

// ── 콜백 핸들러 (inline keyboard) ──
bot.on('callback_query', async (query) => {
  const data = query.data;
  
  if (data.startsWith('quiz_')) {
    await handleQuizCallback(bot, query);
  } else if (data.startsWith('listen_')) {
    await handleListeningCallback(bot, query);
  } else if (data.startsWith('card_')) {
    await handleWordCardCallback(bot, query);
  }
});

// ── Cron 스케줄 (캄보디아 시간 UTC+7) ──
// 아침 7시 = UTC 0시
cron.schedule('0 0 * * 1-6', () => {
  console.log('📚 7AM: Sending morning content...');
  sendMorningContent(bot);
}, { timezone: 'Asia/Phnom_Penh' });

// 아침 8시 = UTC 1시
cron.schedule('0 1 * * 1-5', () => {
  console.log('🎬 8AM: Sending video links...');
  sendVideoLinks(bot);
}, { timezone: 'Asia/Phnom_Penh' });

// 저녁 7시 = UTC 12시
cron.schedule('0 12 * * 1-6', () => {
  console.log('📝 7PM: Sending evening quiz...');
  sendEveningQuiz(bot);
}, { timezone: 'Asia/Phnom_Penh' });

// 일요일 아침 7시 = 복습 카드
cron.schedule('0 0 * * 0', () => {
  console.log('🔄 Sunday: Sending review cards...');
  sendSundayReview(bot);
}, { timezone: 'Asia/Phnom_Penh' });

// 매일 밤 9시 = 미참여 체크
cron.schedule('0 14 * * *', () => {
  console.log('🔍 9PM: Checking inactive students...');
  checkInactiveStudents(bot);
}, { timezone: 'Asia/Phnom_Penh' });

// ── 에러 핸들링 ──
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.code);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// ── Health check endpoint ──
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'healthy', bot: 'VERI-K', uptime: process.uptime() }));
}).listen(process.env.PORT || 3000);

console.log(`🌐 Health check on port ${process.env.PORT || 3000}`);
