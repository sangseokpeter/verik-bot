const { supabase } = require('../config/supabase');
const { sendSingleCard } = require('../handlers/wordcard');

// ── 일요일 복습: 그 주 틀린 단어 카드 재전송 ──
async function sendSundayReview(bot) {
  const { data: students } = await supabase
    .from('students')
    .select('id, first_name')
    .eq('is_active', true);

  if (!students) return;

  for (const student of students) {
    try {
      // 이번 주 틀린 단어 가져오기 (마스터 안 된 것만)
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      const { data: wrongWords } = await supabase
        .from('wrong_word_tracker')
        .select('word_id, wrong_count, words(*)')
        .eq('student_id', student.id)
        .eq('is_mastered', false)
        .gte('last_wrong_at', oneWeekAgo.toISOString())
        .order('wrong_count', { ascending: false })
        .limit(20);

      if (!wrongWords || wrongWords.length === 0) {
        await bot.sendMessage(student.id,
          `🎉 일요일 복습\n\n` +
          `이번 주 틀린 단어가 없어요! 완벽해요! 🏆\n` +
          `សប្តាហ៍នេះគ្មានពាក្យខុសទេ! អស្ចារ្យ!\n\n` +
          `내일부터 새로운 단어를 배워요! 💪`
        );
        continue;
      }

      const words = wrongWords.map(w => w.words).filter(Boolean);

      await bot.sendMessage(student.id,
        `🔄 일요일 복습 / ការពិនិត្យឡើងវិញថ្ងៃអាទិត្យ\n\n` +
        `이번 주 틀린 단어 ${words.length}개를 복습합니다!\n` +
        `សប្តាហ៍នេះមានពាក្យខុស ${words.length} ពាក្យត្រូវពិនិត្យឡើងវិញ!\n\n` +
        `카드를 넘기면서 뜻을 맞혀보세요! 👇`
      );

      // 첫 번째 카드 전송
      if (words.length > 0) {
        await sendSingleCard(bot, student.id, words[0], 0, words.length);
      }

    } catch (err) {
      console.error(`Sunday review failed for ${student.id}:`, err.message);
    }
  }

  console.log(`🔄 Sunday review sent to ${students.length} students`);
}

module.exports = { sendSundayReview };
