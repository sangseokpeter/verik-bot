const { supabase } = require('../config/supabase');
const { sendWordCards } = require('../handlers/wordcard');
const { startQuiz } = require('../handlers/quiz');

// ── 아침 7시: 단어카드 전송 (학생별 current_day 기준) ──
async function sendMorningContent(bot) {
  const { data: students } = await supabase
    .from('students')
    .select('id, first_name, current_day')
    .eq('is_active', true);

  if (!students || students.length === 0) return;

  const dayOfWeek = new Date().getDay(); // 0=일, 6=토

  for (const student of students) {
    try {
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
          `📅 ថ្ងៃទី ${student.current_day} / 35 🎯\n\n` +
          `📚 ចាប់ផ្តើមរៀនពាក្យថ្ងៃនេះ!\n` +
          `(오늘의 단어카드를 시작합니다!)\n\n` +
          `💪 អ្នកអាចធ្វើបាន! ហ្វឹកហាត់ខ្លាំងៗ!`
        );
        // 단어카드 전송
        await sendWordCards(bot, student.id, student.current_day);
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
    .select('id, first_name, current_day')
    .eq('is_active', true);

  if (!students || students.length === 0) return;

  for (const student of students) {
    try {
      const { data: videos } = await supabase
        .from('videos')
        .select('*')
        .eq('day_number', student.current_day)
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

// ── 저녁 7시: 퀴즈 전송 + 진도 업데이트 ──
async function sendEveningQuiz(bot) {
  const { data: students } = await supabase
    .from('students')
    .select('id, first_name, current_day')
    .eq('is_active', true);

  if (!students || students.length === 0) return;

  const dayOfWeek = new Date().getDay();
  const isWeekend = dayOfWeek === 6; // 토요일

  for (const student of students) {
    try {
      if (isWeekend) {
        // 토요일: 주간 종합 퀴즈 (크메르어)
        await bot.sendMessage(student.id,
          `📝 ដល់ពេលធ្វើតេស្តហើយ! 🎯\n\n` +
          `📚 ពាក្យ 30 + 🎧 ស្តាប់ 10\n` +
          `(단어 30문제 + 듣기 10문제)\n\n` +
          `ចុចប៊ូតុងខាងក្រោមដើម្បីចាប់ផ្តើម!`,
          {
            reply_markup: {
              inline_keyboard: [[
                { text: '📝 ចាប់ផ្តើម! (시작)', callback_data: 'quiz_start_weekly' }
              ]]
            }
          }
        );
      } else {
        // 평일: 일일 퀴즈 (크메르어)
        await bot.sendMessage(student.id,
          `📝 ដល់ពេលធ្វើតេស្តហើយ! 🎯\n\n` +
          `📚 ពាក្យ 15 + 🎧 ស្តាប់ 5\n` +
          `(단어 15문제 + 듣기 5문제)\n\n` +
          `ចុចប៊ូតុងខាងក្រោមដើម្បីចាប់ផ្តើម!`,
          {
            reply_markup: {
              inline_keyboard: [[
                { text: '📝 ចាប់ផ្តើម! (시작)', callback_data: 'quiz_start_daily' }
              ]]
            }
          }
        );

        // 진도 +1 (평일만, 최대 35일)
        const newDay = Math.min(student.current_day + 1, 35);
        await supabase.from('students').update({
          current_day: newDay,
          last_active: new Date().toISOString()
        }).eq('id', student.id);
      }
    } catch (err) {
      console.error(`Quiz send failed for student ${student.id}:`, err.message);
    }
  }

  // Admin 알림 (영어)
  const { data: config } = await supabase
    .from('admin_config').select('value').eq('key', 'admin_chat_id').single();
  if (config?.value) {
    await bot.sendMessage(config.value,
      `✅ Evening quiz sent to ${students.length} students.`
    );
  }

  console.log(`📝 Evening quiz sent to ${students.length} students`);
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
