const { supabase } = require('../config/supabase');
const Anthropic = require('@anthropic-ai/sdk');

const ADMIN_IDS = process.env.ADMIN_IDS?.split(',').map(Number) || [];
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

// ── /admin 대시보드 ──
async function handleAdminCommand(bot, msg) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const { count: studentCount } = await supabase
    .from('students').select('id', { count: 'exact' }).eq('is_active', true);

  const { data: recentSessions } = await supabase
    .from('quiz_sessions')
    .select('correct_answers, total_questions')
    .eq('is_completed', true)
    .gte('completed_at', new Date(Date.now() - 24*60*60*1000).toISOString());

  const todayQuizzes = recentSessions?.length || 0;
  const avgScore = recentSessions?.length > 0
    ? Math.round(recentSessions.reduce((sum, s) => sum + (s.correct_answers / s.total_questions * 100), 0) / recentSessions.length)
    : 0;

  const { count: cardsReady } = await supabase
    .from('words').select('id', { count: 'exact' }).not('image_url', 'is', null);

  const { count: ttsReady } = await supabase
    .from('words').select('id', { count: 'exact' }).not('audio_url', 'is', null);

  await bot.sendMessage(msg.chat.id,
    `🔧 VERI-K Admin Dashboard\n\n` +
    `👥 Active students: ${studentCount}\n` +
    `📝 Quizzes today: ${todayQuizzes}\n` +
    `📊 Avg score: ${avgScore}%\n` +
    `🎨 Cards ready: ${cardsReady} / 1025\n` +
    `🔊 TTS ready: ${ttsReady} / 1025\n\n` +
    `Commands:\n` +
    `/broadcast [msg] - Send to all students\n` +
    `/reply [id] [msg] - Reply to a student (student sees Khmer header)\n` +
    `/generate_cards [day] - Generate card images\n` +
    `/generate_tts [day] - Generate TTS audio\n` +
    `/generate_all - Auto-generate Day 1~35 (cards + TTS)\n` +
    `/admin - This dashboard`
  );
}

// ── /broadcast 전체 공지 ──
async function handleBroadcast(bot, msg, message) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const { data: students } = await supabase
    .from('students').select('id').eq('is_active', true);

  if (!students || students.length === 0) {
    return bot.sendMessage(msg.chat.id, '⚠️ No active students found.');
  }

  let sent = 0, failed = 0;
  for (const student of students) {
    try {
      await bot.sendMessage(student.id, `📢 ${message}`);
      sent++;
    } catch (err) {
      failed++;
    }
  }

  await supabase.from('announcements').insert({
    message, sent_by: msg.from.id, recipients_count: sent
  });

  await bot.sendMessage(msg.chat.id,
    `✅ Broadcast complete\nSent: ${sent} / Failed: ${failed}`
  );
}

// ── /generate_cards [day] ──
async function handleGenerateCards(bot, msg, dayNumber) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const day = parseInt(dayNumber);
  if (isNaN(day) || day < 1 || day > 35) {
    return bot.sendMessage(msg.chat.id, '⚠️ Usage: /generate_cards [1-35]');
  }

  await bot.sendMessage(msg.chat.id, `🎨 Starting card generation for Day ${day}...`);
  const { generateCardsForDay } = require('../services/content-generator');
  generateCardsForDay(bot, day);
}

// ── /generate_tts [day] ──
async function handleGenerateTTS(bot, msg, dayNumber) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const day = parseInt(dayNumber);
  if (isNaN(day) || day < 1 || day > 35) {
    return bot.sendMessage(msg.chat.id, '⚠️ Usage: /generate_tts [1-35]');
  }

  await bot.sendMessage(msg.chat.id, `🔊 Starting TTS generation for Day ${day}...`);
  const { generateTTSForDay } = require('../services/content-generator');
  generateTTSForDay(bot, day);
}

// ── /generate_all - Day 1~35 전체 자동 순차 생성 ──
async function handleGenerateAll(bot, msg) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const adminId = msg.chat.id;
  await bot.sendMessage(adminId,
    `🚀 Starting auto-generation for Day 1~35\n` +
    `Cards + TTS will be generated sequentially.\n` +
    `You will receive a report after each day completes.`
  );

  const { generateCardsForDay, generateTTSForDay } = require('../services/content-generator');

  // 백그라운드에서 순차 실행
  (async () => {
    for (let day = 1; day <= 35; day++) {
      try {
        // 이미 카드 있는 day는 스킵
        const { count: existing } = await supabase
          .from('words')
          .select('id', { count: 'exact' })
          .eq('day_number', day)
          .not('image_url', 'is', null);

        const { count: total } = await supabase
          .from('words')
          .select('id', { count: 'exact' })
          .eq('day_number', day);

        if (existing >= total) {
          await bot.sendMessage(adminId, `⏭️ Day ${day}: Already complete (${existing}/${total}). Skipping.`);
          continue;
        }

        await bot.sendMessage(adminId, `🎨 Day ${day}: Generating ${total - existing} cards...`);
        await generateCardsForDay(bot, day);

        await bot.sendMessage(adminId, `🔊 Day ${day}: Generating TTS...`);
        await generateTTSForDay(bot, day);

        await bot.sendMessage(adminId, `✅ Day ${day} complete!`);

        // 다음 Day 전 2초 대기
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        await bot.sendMessage(adminId, `❌ Day ${day} failed: ${err.message}`);
      }
    }
    await bot.sendMessage(adminId, `🎉 All days (1~35) generation complete!`);
  })();
}

// ── Claude API 연동 - Admin 자연어 명령 처리 ──
async function handleAdminMessage(bot, msg) {
  if (!isAdmin(msg.from.id)) return;

  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  try {
    const response = await claude.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `You are VERI-K admin assistant. 
You help manage a Korean language learning bot for Cambodian students.
Available commands: /generate_cards [day], /generate_tts [day], /generate_all, /broadcast [msg], /admin.
When the admin asks to do something, respond with the exact command to execute, or explain the current system status.
Always respond in English. Be concise.`,
      messages: [{ role: 'user', content: text }]
    });

    const reply = response.content[0].text;
    await bot.sendMessage(msg.chat.id, `🤖 Assistant:\n${reply}`);

    // 명령어가 포함된 경우 자동 실행
    const cmdMatch = reply.match(/\/(generate_all|generate_cards \d+|generate_tts \d+|admin|broadcast .+)/);
    if (cmdMatch) {
      await bot.sendMessage(msg.chat.id, `⚡ Auto-executing: ${cmdMatch[0]}`);
      const fakeMsg = { ...msg, text: '/' + cmdMatch[1] };

      if (cmdMatch[1] === 'generate_all') {
        await handleGenerateAll(bot, msg);
      } else if (cmdMatch[1].startsWith('generate_cards')) {
        const day = cmdMatch[1].split(' ')[1];
        await handleGenerateCards(bot, msg, day);
      } else if (cmdMatch[1].startsWith('generate_tts')) {
        const day = cmdMatch[1].split(' ')[1];
        await handleGenerateTTS(bot, msg, day);
      }
    }
  } catch (err) {
    console.error('Claude API error:', err.message);
    await bot.sendMessage(msg.chat.id, `❌ Assistant error: ${err.message}`);
  }
}

// ── /ask — 학생 → Admin 문의 전달 ──
async function handleStudentAsk(bot, msg, question) {
  const chatId = msg.chat.id;

  const { data: student } = await supabase
    .from('students')
    .select('first_name, username, current_day')
    .eq('id', chatId)
    .single();

  if (!student) {
    return bot.sendMessage(chatId,
      `❌ សូមចុច /start ដើម្បីចុះឈ្មោះជាមុន!`);
  }

  // Admin에게 영어로 전달
  const { data: config } = await supabase
    .from('admin_config').select('value').eq('key', 'admin_chat_id').single();

  if (!config?.value) return;

  const name = student.first_name || 'Unknown';
  const handle = student.username ? ` (@${student.username})` : '';

  await bot.sendMessage(config.value,
    `💬 Student Question\n` +
    `From: ${name}${handle}\n` +
    `ID: ${chatId}\n` +
    `Day: ${student.current_day}/35\n\n` +
    `"${question}"\n\n` +
    `Reply: /reply ${chatId} [message]`
  );

  // 학생에게 크메르어로 수신 확인
  await bot.sendMessage(chatId,
    `✅ សំណួររបស់អ្នកត្រូវបានផ្ញើទៅគ្រូរួចហើយ!\n` +
    `សូមរង់ចាំការឆ្លើយតប។`
  );
}

// ── /reply — Admin → 학생 개별 답장 ──
async function handleReply(bot, msg, studentId, message) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const id = parseInt(studentId);

  const { data: student } = await supabase
    .from('students')
    .select('first_name')
    .eq('id', id)
    .single();

  if (!student) {
    return bot.sendMessage(msg.chat.id, `⚠️ Student not found: ${id}`);
  }

  try {
    // 학생에게 크메르어로 답장
    await bot.sendMessage(id,
      `📩 ការឆ្លើយតបពីគ្រូ:\n\n${message}`
    );

    // Admin에게 영어로 확인
    await bot.sendMessage(msg.chat.id,
      `✅ Reply sent to ${student.first_name} (${id})`
    );
  } catch (err) {
    await bot.sendMessage(msg.chat.id,
      `❌ Failed to send: ${err.message}`
    );
  }
}

module.exports = {
  handleAdminCommand,
  handleBroadcast,
  handleGenerateCards,
  handleGenerateTTS,
  handleGenerateAll,
  handleAdminMessage,
  handleStudentAsk,
  handleReply,
  isAdmin,
  ADMIN_IDS
};
