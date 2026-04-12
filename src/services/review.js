const { supabase } = require('../config/supabase');
const { sendReviewCard } = require('../handlers/wordcard');

const REVIEW_CARD_DELAY_MS = 500;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── 일요일 복습: 그 주 틀린 단어 카드 재전송 ──
async function sendSundayReview(bot) {
  const { data: students } = await supabase
    .from('students')
    .select('id, first_name')
    .eq('is_active', true);

  if (!students || students.length === 0) return;

  let sentCount = 0;
  let failCount = 0;

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
        // 틀린 단어 없음 — 축하 메시지 (크메르어 + 한국어)
        await bot.sendMessage(student.id,
          `🎉 ការពិនិត្យឡើងវិញថ្ងៃអាទិត្យ\n\n` +
          `សប្តាហ៍នេះគ្មានពាក្យខុសទេ! អស្ចារ្យ! 🏆\n` +
          `(이번 주 틀린 단어가 없어요! 완벽해요!)\n\n` +
          `ថ្ងៃស្អែកយើងរៀនពាក្យថ្មី! 💪`
        );
        sentCount++;
        continue;
      }

      // word 객체 추출 (join 결과에서)
      const words = wrongWords.map(w => w.words).filter(Boolean);

      if (words.length === 0) {
        sentCount++;
        continue;
      }

      // 인트로 메시지 (크메르어 + 한국어)
      await bot.sendMessage(student.id,
        `🔄 ការពិនិត្យឡើងវិញថ្ងៃអាទិត្យ\n\n` +
        `សប្តាហ៍នេះមានពាក្យខុស ${words.length} ពាក្យត្រូវពិនិត្យឡើងវិញ!\n` +
        `(이번 주 틀린 단어 ${words.length}개를 복습합니다!)\n\n` +
        `មើលកាតនិមួយៗ ហើយព្យាយាមចាំអត្ថន័យ! 👇`
      );

      // 각 복습 카드를 순서대로 전송 (video → image → text 폴백)
      for (let i = 0; i < words.length; i++) {
        await sendReviewCard(bot, student.id, words[i], i, words.length);
        if (i < words.length - 1) {
          await sleep(REVIEW_CARD_DELAY_MS);
        }
      }

      // 마무리 메시지
      await bot.sendMessage(student.id,
        `✅ បានពិនិត្យ ${words.length} ពាក្យហើយ!\n` +
        `(${words.length}개 복습 완료!)\n\n` +
        `📝 នៅម៉ោង 7 យប់ នឹងមានកម្រងសំណួរ!\n` +
        `(저녁 7시에 퀴즈가 있어요!)`
      );

      sentCount++;
    } catch (err) {
      failCount++;
      console.error(`Sunday review failed for ${student.id}:`, err.message);
    }
  }

  console.log(`🔄 Sunday review: sent=${sentCount} failed=${failCount} total=${students.length}`);
}

module.exports = { sendSundayReview };
