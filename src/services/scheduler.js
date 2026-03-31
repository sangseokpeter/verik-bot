const { supabase } = require('../config/supabase');
const { sendWordCards } = require('../handlers/wordcard');
const { startQuiz } = require('../handlers/quiz');

// ── start_date 기준 current_day 계산 헬퍼 ──
function calcCurrentDay(startDate) {
  if (!startDate) return 1;
  const start = new Date(startDate + 'T00:00:00');
  if (isNaN(start.getTime())) return 1;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today - start) / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, Math.min(diffDays, 35));
}

// ── 아침 7시: 단어카드 전송 (학생별 start_date 기준 Day 계산) ──
async function sendMorningContent(bot) {
  const { data: students } = await supabase
    .from('students')
    .select('id, first_name, start_date')
    .eq('is_active', true);

  if (!students || students.length === 0) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay(); // 0=일, 6=토

  for (const student of students) {
    try {
      // start_date가 null이면 등록 안내 후 스킵
      if (!student.start_date) {
        await bot.sendMessage(student.id, `❌ /start 를 먼저 눌러 등록해주세요!`);
        continue;
      }

      // start_date가 아직 미래이면 스킵 (내일부터 시작)
      const startD = new Date(student.start_date + 'T00:00:00');
      if (startD > today) continue;

      const currentDay = calcCurrentDay(student.start_date);

      // DB의 current_day도 동기화
      await supabase.from('students').update({ current_day: currentDay }).eq('id', student.id);

      if (dayOfWeek === 6) {
        // 토요일: 주간 복습 안내 (크메르어)
        await bot.sendMessage(student.id,
          `🌟 សួស្តី ${student.first_name}!\n\n` +
          `🔄 ថ្ងៃសៅរ៍នេះ គឺជាថ្ងៃពិនិត្យឡើងវិញ!\n` +
          `(토요일: 주간 복습의 날)\n\n` +
          `📚 នៅម៉ោង 7 យប់ នឹងមានកម្រងសំណួរ 30 ពាក្យ + 10 ស្តាប់!\n` +
          `(저녁 7시에 종합 퀴즈 30문제 + 듣기 10문제)`
        );
      } else {
        // 평일: 단어카드 전송 (크메르어)
        await bot.sendMessage(student.id,
          `🌅 អរុណសួស្តី ${student.first_name}!\n\n` +
          `📅 ថ្ងៃទី ${currentDay} / 35 🎯\n\n` +
          `📚 ចាប់ផ្តើមរៀនពាក្យថ្ងៃនេះ!\n` +
          `(오늘의 단어카드를 시작합니다!)\n\n` +
          `💪 អ្នកអាចធ្វើបាន! ហ្វឹកហាត់ខ្លាំងៗ!`
        );
        // 단어카드 전송
        await sendWordCards(bot, student.id, currentDay);
      }

      // 활동 기록
      await supabase.from('daily_activity').upsert({
        student_id: student.id,
        activity_date: new Date().toISOString().split('T')[0],
        words_received: true
      }, { onConflict: 'student_id, activity_date' });

    } catch (err) {
      console.error(`Morning send failed for student ${student.id}:`, err.message);
    }
  }

  // Admin 알림 (영어)
  const { data: config } = await supabase
    .from('admin_config').select('value').eq('key', 'admin_chat_id').single();
  if (config?.value) {
    await bot.sendMessage(config.value,
      `✅ Morning word cards sent to ${students.length} students.`
    );
  }

  console.log(`📚 Morning content sent to ${students.length} students`);
}

// ── 아침 8시: 동영상 강의 링크 (평일만) ──
async function sendVideoLinks(bot) {
  const { data: students } = await supabase
    .from('students')
    .select('id, first_name, start_date')
    .eq('is_active', true);

  if (!students || students.length === 0) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const student of students) {
    try {
      const startD = new Date(student.start_date + 'T00:00:00');
      if (startD > today) continue;

      const currentDay = calcCurrentDay(student.start_date);

      const { data: videos } = await supabase
        .from('videos')
        .select('*')
        .eq('day_number', currentDay)
        .order('sort_order');

      if (!videos || videos.length === 0) continue;

      // 크메르어 메시지
      let videoText = `🎬 វីដេអូមេរៀនថ្ងៃនេះ!\n(오늘의 강의 영상)\n\n`;

      for (const vid of videos) {
        const label = vid.sub_unit
          ? `${vid.unit} - ${vid.sub_unit}`
          : vid.unit;
        videoText += `📺 ${label}\n${vid.youtube_url}\n\n`;
      }

      videoText += `💪 មើលឱ្យចប់ហើយរៀន!\n(끝까지 보고 공부해요!)`;

      await bot.sendMessage(student.id, videoText, {
        disable_web_page_preview: false
      });
    } catch (err) {
      console.error(`Video send failed for student ${student.id}:`, err.message);
    }
  }

  console.log(`🎬 Video links sent to ${students.length} students`);
}

// ── 저녁 7시: 퀴즈 자동 생성 & 전송 (start_date 기준) ──
async function sendEveningQuiz(bot) {
  const { data: students } = await supabase
    .from('students')
    .select('id, first_name, start_date')
    .eq('is_active', true);

  if (!students || students.length === 0) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay();
  const isWeekend = dayOfWeek === 6; // 토요일
  const quizType = isWeekend ? 'weekly' : 'daily';
  const qCount = isWeekend ? 30 : 15;

  let sentCount = 0;

  for (const student of students) {
    try {
      const startD = new Date(student.start_date + 'T00:00:00');
      if (startD > today) continue;

      // 안내 메시지 + 시작 버튼
      await bot.sendMessage(student.id,
        `📝 ដល់ពេលធ្វើតេស្តហើយ! 🎯\n\n` +
        (isWeekend
          ? `📚 ពាក្យ ${qCount} សំណួរ (ពិនិត្យឡើងវិញប្រចាំសប្តាហ៍)\n` +
            `(주간 복습 ${qCount}문제)\n\n`
          : `📚 ពាក្យ 10 + 🔄 ពិនិត្យ 5 = ${qCount} សំណួរ\n` +
            `(오늘 단어 10 + 복습 5 = ${qCount}문제)\n\n`) +
        `ចុចប៊ូតុងខាងក្រោមដើម្បីចាប់ផ្តើម!`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: '📝 ចាប់ផ្តើម! (시작)',
                callback_data: isWeekend ? 'quiz_start_weekly' : 'quiz_start_daily' }
            ]]
          }
        }
      );

      // last_active 업데이트
      await supabase.from('students').update({
        last_active: new Date().toISOString()
      }).eq('id', student.id);

      sentCount++;
    } catch (err) {
      console.error(`Quiz send failed for student ${student.id}:`, err.message);
    }
  }

  // Admin 알림 (영어)
  const { data: config } = await supabase
    .from('admin_config').select('value').eq('key', 'admin_chat_id').single();
  if (config?.value) {
    await bot.sendMessage(config.value,
      `✅ Evening ${quizType} quiz sent to ${sentCount} students.\n` +
      `Format: ${isWeekend ? '30 weekly review' : '10 today + 5 review = 15'} questions`
    );
  }

  console.log(`📝 Evening ${quizType} quiz sent to ${sentCount} students`);
}

// ── 듣기 문제 전송 ──
async function sendListeningQuestions(bot, chatId, dayNumber, count) {
  const { data: questions } = await supabase
    .from('listening_questions')
    .select('*')
    .eq('day_number', dayNumber)
    .eq('is_approved', true)
    .limit(count);

  if (!questions || questions.length === 0) {
    await bot.sendMessage(chatId,
      `🎧 កំពុងរៀបចំសំណួរស្តាប់...\n(듣기 문제 준비 중입니다.)`
    );
    return;
  }

  await bot.sendMessage(chatId,
    `🎧 ចាប់ផ្តើមតេស្តស្តាប់!\n(듣기 평가 시작!) ${questions.length} សំណួរ`
  );

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (q.audio_url) await bot.sendVoice(chatId, q.audio_url);

    await bot.sendMessage(chatId,
      `🎧 ${i + 1}/${questions.length}\n\n${q.question_text}`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: `A. ${q.option_a}`, callback_data: `listen_${q.id}_A_${q.correct_answer}` },
              { text: `B. ${q.option_b}`, callback_data: `listen_${q.id}_B_${q.correct_answer}` }
            ],
            [
              { text: `C. ${q.option_c}`, callback_data: `listen_${q.id}_C_${q.correct_answer}` },
              { text: `D. ${q.option_d}`, callback_data: `listen_${q.id}_D_${q.correct_answer}` }
            ]
          ]
        }
      }
    );
  }
}

module.exports = { sendMorningContent, sendVideoLinks, sendEveningQuiz, sendListeningQuestions };
