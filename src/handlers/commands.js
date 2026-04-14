const { supabase } = require('../config/supabase');
const { sendWordCard } = require('./wordcard');

// ── /start 명령어 ──
async function handleStart(bot, msg) {
  const chatId = msg.chat.id;
  const user = msg.from;

  const { data: existing } = await supabase
    .from('students')
    .select('id, first_name, current_day')
    .eq('id', chatId)
    .single();

  if (!existing) {
    // 신규 학생 등록 — start_date는 내일 (첫 카드는 내일 7AM에 발송)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const startDate = tomorrow.toISOString().split('T')[0];

    await supabase.from('students').insert({
      id: chatId,
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      username: user.username || '',
      current_day: 1,
      start_date: startDate,
      is_active: true
    });

    // 학생에게 크메르어로 환영 메시지
    await bot.sendMessage(chatId,
      `🎉 សូមស្វាគមន៍ ${user.first_name}!\n\n` +
      `📚 VERI-K ជាកម្មវិធីរៀនភាសាកូរ៉េ 35 ថ្ងៃ!\n` +
      `🎯 គោលដៅ: TOPIK I Level 2\n\n` +
      `⏰ កាលវិភាគប្រចាំថ្ងៃ:\n` +
      `   🌅 ម៉ោង 7 ព្រឹក → កាតពាក្យ\n` +
      `   🎬 ម៉ោង 8 ព្រឹក → វីដេអូមេរៀន\n` +
      `   📝 ម៉ោង 7 យប់ → កម្រងសំណួរ\n\n` +
      `📌 បញ្ជា:\n` +
      `/progress - ស្ថានភាពរៀន\n` +
      `/help - ជំនួយ\n\n` +
      `💪 ចាប់ផ្តើមហើយ! អ្នកអាចធ្វើបាន!`
    );

    // Admin에게 영어로 알림
    const { data: config } = await supabase
      .from('admin_config').select('value').eq('key', 'admin_chat_id').single();

    if (config?.value) {
      await bot.sendMessage(config.value,
        `📋 New student registered!\n` +
        `Name: ${user.first_name} ${user.last_name || ''}\n` +
        `Username: @${user.username || 'N/A'}\n` +
        `Telegram ID: ${chatId}\n` +
        `Start Day: 1`
      );
    }
  } else {
    // 기존 학생 재방문 (크메르어)
    await bot.sendMessage(chatId,
      `👋 សូមស្វាគមន៍ ${existing.first_name}!\n\n` +
      `📅 អ្នកកំពុងនៅថ្ងៃទី ${existing.current_day} / 35\n\n` +
      `/progress - ស្ថានភាពរៀន\n` +
      `/help - ជំនួយ`
    );
  }
}

// ── /progress 명령어 ──
async function handleProgress(bot, msg) {
  const chatId = msg.chat.id;

  const { data: student } = await supabase
    .from('students').select('*').eq('id', chatId).single();

  if (!student) {
    return bot.sendMessage(chatId,
      `❌ សូមចុច /start ដើម្បីចុះឈ្មោះជាមុន!\n(먼저 /start 로 등록해주세요!)`
    );
  }

  const { data: sessions } = await supabase
    .from('quiz_sessions')
    .select('total_questions, correct_answers')
    .eq('student_id', chatId)
    .eq('is_completed', true);

  const totalQ = sessions?.reduce((sum, s) => sum + s.total_questions, 0) || 0;
  const totalCorrect = sessions?.reduce((sum, s) => sum + s.correct_answers, 0) || 0;
  const accuracy = totalQ > 0 ? Math.round((totalCorrect / totalQ) * 100) : 0;

  const { count: wrongCount } = await supabase
    .from('wrong_word_tracker')
    .select('id', { count: 'exact' })
    .eq('student_id', chatId)
    .eq('is_mastered', false);

  const progressBar = makeProgressBar(student.current_day, 35);

  // 크메르어로 진도 표시
  await bot.sendMessage(chatId,
    `📊 ស្ថានភាពរៀន\n\n` +
    `📅 ថ្ងៃទី ${student.current_day} / 35\n` +
    `${progressBar}\n\n` +
    `📝 ភាគរយត្រូវ: ${accuracy}% (${totalCorrect}/${totalQ})\n` +
    `🔄 ពាក្យត្រូវការពិនិត្យ: ${wrongCount || 0}\n\n` +
    `💪 អ្នកអាចធ្វើបាន!`
  );
}

function makeProgressBar(current, total) {
  const filled = Math.round((current / total) * 20);
  const empty = 20 - filled;
  return '▓'.repeat(filled) + '░'.repeat(empty) + ` ${Math.round((current/total)*100)}%`;
}

// ── /help 명령어 ──
async function handleHelp(bot, msg) {
  await bot.sendMessage(msg.chat.id,
    `📖 ជំនួយ VERI-K\n\n` +
    `⏰ កាលវិភាគ:\n` +
    `  🌅 ម៉ោង 7 ព្រឹក - កាតពាក្យ\n` +
    `  🎬 ម៉ោង 8 ព្រឹក - វីដេអូ\n` +
    `  📝 ម៉ោង 7 យប់ - កម្រងសំណួរ\n\n` +
    `📌 បញ្ជា:\n` +
    `/start - ចុះឈ្មោះ\n` +
    `/quiz - កម្រងសំណួរពាក្យ (단어 퀴즈)\n` +
    `/listening - កម្រងសំណួរស្តាប់ (듣기 퀴즈)\n` +
    `/progress - ស្ថានភាពរៀន\n` +
    `/help - ជំនួយ\n` +
    `/ask [សំណួរ] - សួរគ្រូ\n\n` +
    `❓ មានសំណួរ? សូមប្រើ /ask`
  );
}

// ── /start_day 명령어 ──
async function handleStartDay(bot, msg, day) {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId,
    `📚 ចាប់ផ្តើមថ្ងៃទី ${day}!\n(Day ${day} 학습을 시작합니다!)`
  );
  await sendWordCard(bot, chatId, parseInt(day), 0);
}

// ── /test_card 명령어 ──
async function handleTestCard(bot, msg, day) {
  const chatId = msg.chat.id;
  await sendWordCard(bot, chatId, parseInt(day), 0);
}

// ── 명령어 라우터 ──
async function handleCommand(bot, msg, command) {
  switch (command) {
    case 'quiz':
      const { startQuiz } = require('./quiz');
      await startQuiz(bot, msg);
      break;
    case 'progress':
      await handleProgress(bot, msg);
      break;
    case 'help':
      await handleHelp(bot, msg);
      break;
  }
}

module.exports = {
  handleStart,
  handleCommand,
  handleStartDay,
  handleTestCard
};
