// ============================================
// VERI-K Telegram Bot - Main Entry Point
// Railway 24/7 Server
// ============================================
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const { supabase } = require('./config/supabase');
const { handleStart, handleCommand, handleStartDay, handleTestCard } = require('./handlers/commands');
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

// 학생용: Day 학습 시작
bot.onText(/\/start_day (\d+)/, (msg, match) => handleStartDay(bot, msg, match[1]));

// 테스트용: 카드 네비게이션 테스트
bot.onText(/\/test_card (\d+)/, (msg, match) => handleTestCard(bot, msg, match[1]));

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

// ── Cron 스케줄 (캄보디아 UTC+7 → UTC로 변환) ──
// 캄보디아 7AM = UTC 0:00
cron.schedule('0 0 * * 1-6', () => {
  console.log('📚 7AM Cambodia: Sending morning content...');
  sendMorningContent(bot);
});

// 캄보디아 8AM = UTC 1:00
cron.schedule('0 1 * * 1-5', () => {
  console.log('🎬 8AM Cambodia: Sending video links...');
  sendVideoLinks(bot);
});

// 캄보디아 7PM = UTC 12:00
cron.schedule('0 12 * * 1-6', () => {
  console.log('📝 7PM Cambodia: Sending evening quiz...');
  sendEveningQuiz(bot);
});

// 일요일 캄보디아 7AM = UTC 토요일 0:00 (일요일 UTC 0:00)
cron.schedule('0 0 * * 0', () => {
  console.log('🔄 Sunday 7AM Cambodia: Sending review cards...');
  sendSundayReview(bot);
});

// 캄보디아 9PM = UTC 14:00
cron.schedule('0 14 * * *', () => {
  console.log('🔍 9PM Cambodia: Checking inactive students...');
  checkInactiveStudents(bot);
});

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
