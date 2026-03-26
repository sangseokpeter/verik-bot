const { supabase } = require('../config/supabase');

const ADMIN_IDS = process.env.ADMIN_IDS?.split(',').map(Number) || [];

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

// ── /admin 명령어 ──
async function handleAdminCommand(bot, msg) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ 관리자 전용 명령어입니다.');
  }

  const { count: studentCount } = await supabase
    .from('students')
    .select('id', { count: 'exact' })
    .eq('is_active', true);

  const { data: recentSessions } = await supabase
    .from('quiz_sessions')
    .select('correct_answers, total_questions')
    .eq('is_completed', true)
    .gte('completed_at', new Date(Date.now() - 24*60*60*1000).toISOString());

  const todayQuizzes = recentSessions?.length || 0;
  const avgScore = recentSessions?.length > 0
    ? Math.round(recentSessions.reduce((sum, s) => sum + (s.correct_answers / s.total_questions * 100), 0) / recentSessions.length)
    : 0;

  await bot.sendMessage(msg.chat.id,
    `🔧 VERI-K 관리자 대시보드\n\n` +
    `👥 활성 학생: ${studentCount}명\n` +
    `📝 오늘 퀴즈 완료: ${todayQuizzes}건\n` +
    `📊 평균 점수: ${avgScore}%\n\n` +
    `명령어:\n` +
    `/broadcast [메시지] - 전체 공지\n` +
    `/admin - 이 대시보드`
  );
}

// ── /broadcast 전체 공지 ──
async function handleBroadcast(bot, msg, message) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ 관리자 전용 명령어입니다.');
  }

  const { data: students } = await supabase
    .from('students')
    .select('id')
    .eq('is_active', true);

  if (!students || students.length === 0) {
    return bot.sendMessage(msg.chat.id, '활성 학생이 없습니다.');
  }

  let sent = 0;
  let failed = 0;

  for (const student of students) {
    try {
      await bot.sendMessage(student.id,
        `📢 공지사항 / សេចក្តីជូនដំណឹង\n\n${message}`
      );
      sent++;
    } catch (err) {
      failed++;
      console.error(`Broadcast failed for ${student.id}:`, err.message);
    }
  }

  // 로그 저장
  await supabase.from('announcements').insert({
    message: message,
    sent_by: msg.from.id,
    recipients_count: sent
  });

  await bot.sendMessage(msg.chat.id,
    `✅ 공지 발송 완료\n성공: ${sent}명 / 실패: ${failed}명`
  );
}

module.exports = { handleAdminCommand, handleBroadcast, isAdmin, ADMIN_IDS };
