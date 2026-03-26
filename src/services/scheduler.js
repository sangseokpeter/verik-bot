const { supabase } = require('../config/supabase');
const { sendWordCards } = require('../handlers/wordcard');
const { startQuiz } = require('../handlers/quiz');

// ── 아침 7시: 동기부여 쇼츠 + 단어카드 ──
async function sendMorningContent(bot) {
  const { data: students } = await supabase
    .from('students')
    .select('id, current_day')
    .eq('is_active', true);

  if (!students) return;

  // 동기부여 쇼츠 URL
  const { data: config } = await supabase
    .from('admin_config')
    .select('value')
    .eq('key', 'motivation_video_url')
    .single();

  const videoUrl = config?.value;

  for (const student of students) {
    try {
      const dayOfWeek = new Date().getDay(); // 0=일, 6=토

      if (dayOfWeek === 6) {
        // 토요일: 주간 요약 메시지
        await bot.sendMessage(student.id,
          `🌟 주말 종합 복습!\n\n` +
          `📚 이번 주 배운 내용을 총정리합니다.\n` +
          `សប្តាហ៍នេះយើងនឹងធ្វើការពិនិត្យឡើងវិញទាំងអស់។\n\n` +
          `저녁 7시에 종합 퀴즈 30문제 + 듣기 10문제가 나옵니다!`
        );
      } else {
        // 평일: 쇼츠 + 단어카드
        if (videoUrl) {
          await bot.sendMessage(student.id,
            `🌅 좋은 아침이에요! / អរុណសួស្តី!\n\n` +
            `Day ${student.current_day}/58 🎯\n` +
            `여러분 오늘도 힘차게 한국어 공부를 같이 해 봐요! 💪`
          );
          await bot.sendVideo(student.id, videoUrl);
        }

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
      console.error(`Morning send failed for ${student.id}:`, err.message);
    }
  }

  console.log(`📚 Morning content sent to ${students.length} students`);
}

// ── 아침 8시: 동영상 강의 링크 (평일만) ──
async function sendVideoLinks(bot) {
  const { data: students } = await supabase
    .from('students')
    .select('id, current_day')
    .eq('is_active', true);

  if (!students) return;

  for (const student of students) {
    try {
      const { data: videos } = await supabase
        .from('videos')
        .select('*')
        .eq('day_number', student.current_day)
        .order('sort_order');

      if (!videos || videos.length === 0) continue;

      let videoText = `🎬 오늘의 강의 / មេរៀនថ្ងៃនេះ\n\n`;
      
      for (const vid of videos) {
        const label = vid.sub_unit 
          ? `${vid.unit} - ${vid.sub_unit}`
          : vid.unit;
        videoText += `📺 ${label}\n${vid.youtube_url}\n\n`;
      }

      videoText += `열심히 공부해요! / រៀនឱ្យខ្លាំង! 💪`;

      await bot.sendMessage(student.id, videoText, {
        disable_web_page_preview: false
      });
    } catch (err) {
      console.error(`Video send failed for ${student.id}:`, err.message);
    }
  }
}

// ── 저녁 7시: 퀴즈 + 듣기 ──
async function sendEveningQuiz(bot) {
  const { data: students } = await supabase
    .from('students')
    .select('id, current_day')
    .eq('is_active', true);

  if (!students) return;

  const dayOfWeek = new Date().getDay();
  const isWeekend = dayOfWeek === 6; // 토요일

  for (const student of students) {
    try {
      if (isWeekend) {
        await bot.sendMessage(student.id,
          `📝 주말 종합 퀴즈! / កម្រងសំណួរសរុប!\n\n` +
          `📚 단어 30문제 + 🎧 듣기 10문제\n\n` +
          `준비됐으면 아래 버튼을 눌러주세요!`,
          {
            reply_markup: {
              inline_keyboard: [[
                { text: '📝 종합 퀴즈 시작!', callback_data: 'quiz_start_weekly' }
              ]]
            }
          }
        );
      } else {
        await bot.sendMessage(student.id,
          `📝 오늘의 퀴즈 시간! / ពេលធ្វើកម្រងសំណួរ!\n\n` +
          `📚 단어 15문제 + 🎧 듣기 5문제\n\n` +
          `준비됐으면 시작하세요!`,
          {
            reply_markup: {
              inline_keyboard: [[
                { text: '📝 퀴즈 시작!', callback_data: 'quiz_start_daily' }
              ]]
            }
          }
        );
      }

      // 하루 진도 +1 (평일만)
      if (!isWeekend) {
        const newDay = Math.min(student.current_day + 1, 58);
        await supabase.from('students').update({
          current_day: newDay,
          last_active: new Date().toISOString()
        }).eq('id', student.id);
      }

    } catch (err) {
      console.error(`Quiz send failed for ${student.id}:`, err.message);
    }
  }
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
    await bot.sendMessage(chatId, '🎧 듣기 문제 준비 중입니다. / កំពុងរៀបចំសំណួរស្តាប់។');
    return;
  }

  await bot.sendMessage(chatId, `🎧 듣기 평가 시작! / ចាប់ផ្តើមតេស្តស្តាប់!\n${questions.length}문제`);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];

    // 음원 전송
    if (q.audio_url) {
      await bot.sendVoice(chatId, q.audio_url);
    }

    // 문제 전송
    await bot.sendMessage(chatId,
      `🎧 듣기 ${i + 1}/${questions.length}\n\n${q.question_text}`,
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
