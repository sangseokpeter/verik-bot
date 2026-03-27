const { supabase } = require('../config/supabase');
const { sendWordCard } = require('./wordcard');

// ── /start 명령어 ──
async function handleStart(bot, msg) {
  const chatId = msg.chat.id;
  const user = msg.from;

  // 학생 등록 또는 업데이트
  const { data: existing } = await supabase
    .from('students')
    .select('id')
    .eq('id', chatId)
    .single();

  if (!existing) {
    await supabase.from('students').insert({
      id: chatId,
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      username: user.username || '',
      current_day: 1,
      start_date: new Date().toISOString().split('T')[0]
    });

    await bot.sendMessage(chatId,
      `🎉 សួស្តី ${user.first_name}!\n\n` +
      `VERI-K 한국어 학습 봇에 오신 것을 환영합니다!\n` +
      `សូមស្វាគមន៍មកកាន់ VERI-K!\n\n` +
      `📚 60일 한국어 학습 프로그램\n` +
      `🎯 목표: TOPIK I Level 2\n\n` +
      `매일 아침 7시에 단어카드가 전송됩니다.\n` +
      `រៀងរាល់ព្រឹក 7AM នឹងផ្ញើកាតពាក្យ។\n\n` +
      `명령어 / បញ្ជា:\n` +
      `/quiz - 퀴즈 시작 / ចាប់ផ្តើមកម្រងសំណួរ\n` +
      `/progress - 학습 현황 / ស្ថានភាពរៀន\n` +
      `/help - 도움말 / ជំនួយ`
    );

    // 관리자에게 알림
    const { data: config } = await supabase
      .from('admin_config')
      .select('value')
      .eq('key', 'admin_chat_id')
      .single();

    if (config?.value) {
      await bot.sendMessage(config.value,
        `📋 새 학생 등록!\n이름: ${user.first_name} ${user.last_name || ''}\n` +
        `Username: @${user.username || 'N/A'}\nID: ${chatId}`
      );
    }
  } else {
    await bot.sendMessage(chatId,
      `👋 ${user.first_name}, 다시 오셨군요!\n\n` +
      `/quiz - 퀴즈 시작\n/progress - 학습 현황`
    );
  }
}

// ── /progress 명령어 ──
async function handleProgress(bot, msg) {
  const chatId = msg.chat.id;

  const { data: student } = await supabase
    .from('students')
    .select('*')
    .eq('id', chatId)
    .single();

  if (!student) {
    return bot.sendMessage(chatId, '먼저 /start 로 등록해주세요!');
  }

  // 퀴즈 통계
  const { data: sessions } = await supabase
    .from('quiz_sessions')
    .select('total_questions, correct_answers')
    .eq('student_id', chatId)
    .eq('is_completed', true);

  const totalQ = sessions?.reduce((sum, s) => sum + s.total_questions, 0) || 0;
  const totalCorrect = sessions?.reduce((sum, s) => sum + s.correct_answers, 0) || 0;
  const accuracy = totalQ > 0 ? Math.round((totalCorrect / totalQ) * 100) : 0;

  // 틀린 단어 수
  const { count: wrongCount } = await supabase
    .from('wrong_word_tracker')
    .select('id', { count: 'exact' })
    .eq('student_id', chatId)
    .eq('is_mastered', false);

  const progressBar = makeProgressBar(student.current_day, 58);

  await bot.sendMessage(chatId,
    `📊 학습 현황 / ស្ថានភាពរៀន\n\n` +
    `📅 학습일: Day ${student.current_day} / 58\n` +
    `${progressBar}\n\n` +
    `📝 퀴즈 정답률: ${accuracy}% (${totalCorrect}/${totalQ})\n` +
    `🔄 복습 필요 단어: ${wrongCount || 0}개\n\n` +
    `💪 화이팅! អ្នកអាចធ្វើបាន!`
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
    `📖 VERI-K 도움말\n\n` +
    `🕐 일일 스케줄:\n` +
    `  7AM - 단어카드 전송\n` +
    `  8AM - 동영상 강의 링크\n` +
    `  7PM - 퀴즈 + 듣기 문제\n\n` +
    `📝 명령어:\n` +
    `/start - 등록/재시작\n` +
    `/quiz - 퀴즈 시작\n` +
    `/progress - 학습 현황\n` +
    `/help - 이 도움말\n\n` +
    `❓ 질문이 있으면 메시지를 보내세요!`
  );
}

// ── /start_day 명령어 (학생용) ──
async function handleStartDay(bot, msg, day) {
  const chatId = msg.chat.id;
  
  await bot.sendMessage(chatId, `📚 Day ${day} 학습을 시작합니다!`);
  
  // 첫 번째 카드 전송
  await sendWordCard(bot, chatId, parseInt(day), 0);
}

// ── /test_card 명령어 (테스트용) ──
async function handleTestCard(bot, msg, day) {
  const chatId = msg.chat.id;
  
  // 첫 번째 카드 전송
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
