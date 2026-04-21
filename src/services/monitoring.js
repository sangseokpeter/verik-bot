const { supabase } = require('../config/supabase');
const { notifyAdmins } = require('./notifier');

// ── 미참여 학생 체크 (매일 밤 9시) ──
async function checkInactiveStudents(bot) {
  // 2일 연속 퀴즈 미완료 학생 찾기
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

  const { data: students } = await supabase
    .from('students')
    .select('id, first_name, username, current_day, last_active')
    .eq('is_active', true);

  if (!students) return;

  const inactiveStudents = [];

  for (const student of students) {
    // 최근 2일간 활동 기록 확인
    const { data: activities } = await supabase
      .from('daily_activity')
      .select('activity_date, quiz_completed')
      .eq('student_id', student.id)
      .gte('activity_date', twoDaysAgo.toISOString().split('T')[0])
      .order('activity_date', { ascending: false });

    const recentQuizDays = activities?.filter(a => a.quiz_completed).length || 0;

    // 2일 연속 퀴즈 안 풀었으면 → 3일째 알람
    if (recentQuizDays === 0) {
      inactiveStudents.push(student);
    }
  }

  if (inactiveStudents.length === 0) return;

  let alertMsg = `⚠️ Inactive students alert\n\n`;
  alertMsg += `Quiz not completed for 2+ days:\n\n`;

  for (const s of inactiveStudents) {
    const daysSinceActive = Math.floor(
      (Date.now() - new Date(s.last_active).getTime()) / (1000 * 60 * 60 * 24)
    );
    alertMsg += `• ${s.first_name} (@${s.username || 'N/A'}) - Day ${s.current_day} - inactive for ${daysSinceActive} day(s)\n`;
  }

  alertMsg += `\nTotal: ${inactiveStudents.length} students`;

  await notifyAdmins(bot, alertMsg);
  console.log(`⚠️ Inactive alert: ${inactiveStudents.length} students`);
}

module.exports = { checkInactiveStudents };
