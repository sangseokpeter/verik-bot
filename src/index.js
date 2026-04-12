const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const { supabase } = require('./config/supabase');
const { handleStart, handleCommand, handleStartDay, handleTestCard } = require('./handlers/commands');
const { handleQuizCallback, handleListeningCallback } = require('./handlers/quiz');
const { handleWordCardCallback, handleTTSCallback } = require('./handlers/wordcard');
const { handleAdminCommand, handleBroadcast, handleGenerateCards, handleGenerateTTS, handleGenerateAll, handleStudentAsk, handleReply, handleStats, handleGenerateMotion, handleGenerateImages, handleGenerateImagesAll, handleApproveImages, handleRedoImage, handleImageStatus, handleTriggerReview, isAdmin } = require('./handlers/admin');
const { sendMorningContent, sendVideoLinks, sendEveningQuiz } = require('./services/scheduler');
const { checkInactiveStudents } = require('./services/monitoring');
const { sendSundayReview } = require('./services/review');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
console.log('🤖 VERI-K Bot started!');

// ── 학생 명령어 ──
bot.onText(/\/start/, (msg) => handleStart(bot, msg));
bot.onText(/\/quiz/, (msg) => handleCommand(bot, msg, 'quiz'));
bot.onText(/\/progress/, (msg) => handleCommand(bot, msg, 'progress'));
bot.onText(/\/help/, (msg) => handleCommand(bot, msg, 'help'));

// ── Admin 명령어 ──
bot.onText(/\/admin/, (msg) => handleAdminCommand(bot, msg));
bot.onText(/\/broadcast (.+)/, (msg, match) => handleBroadcast(bot, msg, match[1]));
bot.onText(/\/generate_cards (\d+)/, (msg, match) => handleGenerateCards(bot, msg, match[1]));
bot.onText(/\/generate_tts (\d+)/, (msg, match) => handleGenerateTTS(bot, msg, match[1]));
bot.onText(/\/generate_all/, (msg) => handleGenerateAll(bot, msg));
bot.onText(/\/reply (\d+) (.+)/, (msg, match) => handleReply(bot, msg, match[1], match[2]));
bot.onText(/\/stats/, (msg) => handleStats(bot, msg));
bot.onText(/\/generate_motion(?:\s+(\d+))?/, (msg, match) => handleGenerateMotion(bot, msg, match[1]));

// ── Gemini 이미지 생성 + 검수 플로우 ──
bot.onText(/\/generate_images_all\b/, (msg) => handleGenerateImagesAll(bot, msg));
bot.onText(/\/generate_images\s+(\d+)/, (msg, match) => handleGenerateImages(bot, msg, match[1]));
bot.onText(/\/approve_images\s+(\d+)/, (msg, match) => handleApproveImages(bot, msg, match[1]));
bot.onText(/\/redo_image\s+(\d+)\s+(.+)/, (msg, match) => handleRedoImage(bot, msg, match[1], match[2].trim()));
bot.onText(/\/image_status/, (msg) => handleImageStatus(bot, msg));
bot.onText(/\/trigger_review/, (msg) => handleTriggerReview(bot, msg));

// ── 학생 문의 ──
bot.onText(/\/ask (.+)/, (msg, match) => handleStudentAsk(bot, msg, match[1]));

// 테스트용
bot.onText(/\/start_day (\d+)/, (msg, match) => handleStartDay(bot, msg, match[1]));
bot.onText(/\/test_card (\d+)/, (msg, match) => handleTestCard(bot, msg, match[1]));

// ── 콜백 핸들러 ──
bot.on('callback_query', async (query) => {
  const data = query.data;
  if (data.startsWith('quiz_')) {
    await handleQuizCallback(bot, query);
  } else if (data.startsWith('listen_')) {
    await handleListeningCallback(bot, query);
  } else if (data.startsWith('tts_')) {
    await handleTTSCallback(bot, query);
  } else if (data.startsWith('card_')) {
    await handleWordCardCallback(bot, query);
  }
});

// ── Cron 스케줄 (캄보디아 UTC+7) ──
// 캄보디아 7AM = UTC 0:00 (월~토)
cron.schedule('0 0 * * 1-6', () => {
  console.log('📚 7AM Cambodia: Sending morning content...');
  sendMorningContent(bot);
});

// 캄보디아 8AM = UTC 1:00 (월~금)
cron.schedule('0 1 * * 1-5', () => {
  console.log('🎬 8AM Cambodia: Sending video links...');
  sendVideoLinks(bot);
});

// 캄보디아 7PM = UTC 12:00 (월~토)
cron.schedule('0 12 * * 1-6', () => {
  console.log('📝 7PM Cambodia: Sending evening quiz...');
  sendEveningQuiz(bot);
});

// 일요일 7AM (UTC 0:00)
cron.schedule('0 0 * * 0', () => {
  console.log('🔄 Sunday: Sending review...');
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

// ── Health check ──
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'healthy', bot: 'VERI-K', uptime: process.uptime() }));
}).listen(process.env.PORT || 3000);

console.log(`🌐 Health check on port ${process.env.PORT || 3000}`);
