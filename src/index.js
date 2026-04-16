const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const { supabase } = require('./config/supabase');
const { handleStart, handleCommand, handleStartDay, handleTestCard } = require('./handlers/commands');
const { handleQuizCallback, handleListeningCallback, startListeningQuiz, testListeningByDay, testListeningQuestion } = require('./handlers/quiz');
const { handleWordCardCallback, handleTTSCallback } = require('./handlers/wordcard');
const { handleAdminCommand, handleBroadcast, handleGenerateCards, handleGenerateTTS, handleGenerateAll, handleStudentAsk, handleReply, handleStats, handleGenerateMotion, handleGenerateMotionAll, handleGenerateImages, handleGenerateImagesAll, handleApproveImages, handleRedoImage, handleImageStatus, handleTriggerReview, handleRunPipeline, handlePipelineStatus, handleNotifyUpgrade, handleTestCountdown, isAdmin } = require('./handlers/admin');
const { sendMorningContent, sendVideoLinks, sendEveningQuiz } = require('./services/scheduler');
const { checkInactiveStudents } = require('./services/monitoring');
const { sendSundayReview } = require('./services/review');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
console.log('🤖 VERI-K Bot started!');

// ── Startup DB check: example_khmer 컬럼 확인 ──
(async () => {
  try {
    // Day 1, sort_order 1 의 example_khmer 확인
    const { data: row, error: err1 } = await supabase
      .from('words')
      .select('id, korean, example_khmer')
      .eq('day_number', 1)
      .eq('sort_order', 1)
      .single();
    if (err1) {
      console.error('[DB CHECK] Day1 sort1 query error:', err1.message);
    } else {
      console.log(`[DB CHECK] Day1 sort1 → id=${row.id}, korean=${row.korean}, example_khmer=${JSON.stringify(row.example_khmer)}`);
    }

    // example_khmer가 비어있는 행 수 카운트
    const { count, error: err2 } = await supabase
      .from('words')
      .select('id', { count: 'exact', head: true })
      .or('example_khmer.is.null,example_khmer.eq.');
    if (err2) {
      console.error('[DB CHECK] empty example_khmer count error:', err2.message);
    } else {
      console.log(`[DB CHECK] Words with empty example_khmer: ${count} rows`);
    }
  } catch (e) {
    console.error('[DB CHECK] exception:', e.message);
  }
})();

// ── 학생 명령어 ──
bot.onText(/\/start/, (msg) => handleStart(bot, msg));
bot.onText(/\/quiz/, (msg) => handleCommand(bot, msg, 'quiz'));
bot.onText(/\/listening/, (msg) => startListeningQuiz(bot, msg));
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
bot.onText(/\/generate_motion_all(?:\s+(--force))?/, (msg, match) => handleGenerateMotionAll(bot, msg, match?.[1]));
bot.onText(/\/generate_motion(?:\s+(\d+))?/, (msg, match) => handleGenerateMotion(bot, msg, match[1]));

// ── Gemini 이미지 생성 + 검수 플로우 ──
bot.onText(/\/generate_images_all\b/, (msg) => handleGenerateImagesAll(bot, msg));
bot.onText(/\/generate_images\s+(\d+)/, (msg, match) => handleGenerateImages(bot, msg, match[1]));
bot.onText(/\/approve_images\s+(\d+)/, (msg, match) => handleApproveImages(bot, msg, match[1]));
bot.onText(/\/redo_image\s+(\d+)\s+(.+)/, (msg, match) => handleRedoImage(bot, msg, match[1], match[2].trim()));
bot.onText(/\/image_status/, (msg) => handleImageStatus(bot, msg));
bot.onText(/\/trigger_review/, (msg) => handleTriggerReview(bot, msg));
bot.onText(/\/run_pipeline/, (msg) => handleRunPipeline(bot, msg));
bot.onText(/\/pipeline_status/, (msg) => handlePipelineStatus(bot, msg));
bot.onText(/\/notify_upgrade/, (msg) => handleNotifyUpgrade(bot, msg));
bot.onText(/\/test_countdown/, (msg) => handleTestCountdown(bot, msg));

// ── 학생 문의 ──
bot.onText(/\/ask (.+)/, (msg, match) => handleStudentAsk(bot, msg, match[1]));

// 테스트용
bot.onText(/\/start_day (\d+)/, (msg, match) => handleStartDay(bot, msg, match[1]));
bot.onText(/\/test_card (\d+)/, (msg, match) => handleTestCard(bot, msg, match[1]));
bot.onText(/\/test_listening_q\s+(.+)/, (msg, match) => {
  if (isAdmin(msg.from.id)) testListeningQuestion(bot, msg, match[1].trim());
});
bot.onText(/\/test_listening(?:\s+(\d+))?$/, (msg, match) => {
  if (isAdmin(msg.from.id)) testListeningByDay(bot, msg, match?.[1] || '1');
});

// ── 콜백 핸들러 ──
bot.on('callback_query', async (query) => {
  const data = query.data;
  if (data.startsWith('quiz_')) {
    await handleQuizCallback(bot, query);
  } else if (data.startsWith('lquiz_')) {
    await handleListeningCallback(bot, query);
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
