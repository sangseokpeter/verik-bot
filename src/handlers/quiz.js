const { supabase } = require('../config/supabase');

// ── 퀴즈 시작 ──
async function startQuiz(bot, msg, quizType = 'daily') {
  const chatId = msg.chat.id;

  const { data: student } = await supabase
    .from('students')
    .select('current_day')
    .eq('id', chatId)
    .single();

  if (!student) {
    return bot.sendMessage(chatId, '먼저 /start 로 등록해주세요!');
  }

  const dayNumber = student.current_day;
  const isWeekly = quizType === 'weekly';

  // 전체 단어 풀 가져오기 (오답 보기용)
  const { data: allWords } = await supabase
    .from('words')
    .select('id, meaning_khmer')
    .order('id');

  // 문제 생성
  let questions = [];

  if (isWeekly) {
    const weekStart = Math.max(1, dayNumber - 5);
    const { data: weekWords } = await supabase
      .from('words')
      .select('*')
      .gte('day_number', weekStart)
      .lte('day_number', dayNumber)
      .order('id');
    
    questions = generateQuestions(weekWords, 30, allWords);
  } else {
    const { data: wrongWords } = await supabase
      .from('wrong_word_tracker')
      .select('word_id, words(*)')
      .eq('student_id', chatId)
      .eq('is_mastered', false)
      .order('wrong_count', { ascending: false })
      .limit(5);

    const reviewWords = wrongWords?.map(w => w.words).filter(Boolean) || [];

    const { data: todayWords } = await supabase
      .from('words')
      .select('*')
      .eq('day_number', dayNumber)
      .order('id');

    const todayQ = generateQuestions(todayWords || [], 10, allWords);
    const reviewQ = generateQuestions(reviewWords, 5, allWords);
    
    questions = [...reviewQ, ...todayQ];
  }

  if (questions.length === 0) {
    return bot.sendMessage(chatId, '오늘 퀴즈 문제가 없습니다.');
  }

  // 세션 생성
  const { data: session } = await supabase
    .from('quiz_sessions')
    .insert({
      student_id: chatId,
      day_number: dayNumber,
      quiz_type: quizType,
      total_questions: questions.length
    })
    .select()
    .single();

  // 첫 문제 전송
  await sendQuizQuestion(bot, chatId, session.id, questions, 0);
}

// ── 문제 생성 (4지선다) — 중복 없는 오답 보기 ──
function generateQuestions(words, count, allWords) {
  if (!words || words.length === 0) return [];
  
  const pool = allWords && allWords.length > 3 ? allWords : words;
  const shuffled = [...words].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(count, shuffled.length));
  
  return selected.map(word => {
    // 오답 3개: 정답과 다른 뜻 + 서로 겹치지 않는 것만
    const usedMeanings = new Set([word.meaning_khmer]);
    const wrongOptions = [];
    
    const candidates = pool
      .filter(w => w.id !== word.id && w.meaning_khmer && w.meaning_khmer !== word.meaning_khmer)
      .sort(() => Math.random() - 0.5);

    for (const candidate of candidates) {
      if (wrongOptions.length >= 3) break;
      if (!usedMeanings.has(candidate.meaning_khmer)) {
        usedMeanings.add(candidate.meaning_khmer);
        wrongOptions.push(candidate.meaning_khmer);
      }
    }

    while (wrongOptions.length < 3) {
      wrongOptions.push('—');
    }

    const options = [word.meaning_khmer, ...wrongOptions]
      .sort(() => Math.random() - 0.5);

    const correctIndex = options.indexOf(word.meaning_khmer);

    return {
      word_id: word.id,
      korean: word.korean,
      pronunciation: word.pronunciation,
      correct_answer: word.meaning_khmer,
      options: options,
      correct_index: correctIndex
    };
  });
}

// ── 퀴즈 문제 전송 ──
async function sendQuizQuestion(bot, chatId, sessionId, questions, index) {
  const q = questions[index];
  const labels = ['A', 'B', 'C', 'D'];

  const text =
    `📝 문제 ${index + 1}/${questions.length}\n\n` +
    `🇰🇷 "${q.korean}" ${q.pronunciation}\n\n` +
    `이 단어의 뜻은? / តើពាក្យនេះមានន័យថាអ្វី?`;

  const keyboard = {
    inline_keyboard: q.options.map((opt, i) => [{
      text: `${labels[i]}. ${opt}`,
      callback_data: `quiz_${sessionId}_${index}_${i}_${q.correct_index}_${q.word_id}`
    }])
  };

  // 문제 데이터를 임시 저장 (다음 문제 전송용)
  await supabase.from('admin_config').upsert({
    key: `quiz_data_${sessionId}`,
    value: JSON.stringify(questions),
    updated_at: new Date().toISOString()
  });

  await bot.sendMessage(chatId, text, { reply_markup: keyboard });
}

// ── 퀴즈 콜백 처리 ──
async function handleQuizCallback(bot, query) {
  const chatId = query.message.chat.id;
  const data = query.data;
  
  // quiz_sessionId_questionIndex_selectedIndex_correctIndex_wordId
  const parts = data.split('_');
  const sessionId = parseInt(parts[1]);
  const qIndex = parseInt(parts[2]);
  const selected = parseInt(parts[3]);
  const correct = parseInt(parts[4]);
  const wordId = parseInt(parts[5]);

  const isCorrect = selected === correct;
  const labels = ['A', 'B', 'C', 'D'];

  // 답변 저장
  await supabase.from('quiz_answers').insert({
    session_id: sessionId,
    word_id: wordId,
    student_answer: labels[selected],
    correct_answer: labels[correct],
    is_correct: isCorrect
  });

  // 맞으면 세션 점수 +1
  if (isCorrect) {
    await supabase.rpc('increment_correct', { session_id_param: sessionId });
  }

  // 틀린 단어 추적 업데이트
  await updateWrongTracker(chatId, wordId, isCorrect);

  // 피드백 표시
  const { data: word } = await supabase
    .from('words')
    .select('korean, meaning_khmer')
    .eq('id', wordId)
    .single();

  let feedback;
  if (isCorrect) {
    feedback = `✅ 정답! / ត្រឹមត្រូវ!\n${word?.korean} = ${word?.meaning_khmer}`;
  } else {
    feedback = `❌ 오답 / មិនត្រឹមត្រូវ\n정답: ${labels[correct]}. ${word?.meaning_khmer}`;
  }

  // 문제 데이터 가져오기
  const { data: configData } = await supabase
    .from('admin_config')
    .select('value')
    .eq('key', `quiz_data_${sessionId}`)
    .single();

  const questions = configData ? JSON.parse(configData.value) : [];
  const nextIndex = qIndex + 1;

  if (nextIndex < questions.length) {
    // 피드백 + 다음 문제
    await bot.answerCallbackQuery(query.id, { text: feedback, show_alert: false });
    await bot.sendMessage(chatId, feedback);
    await sendQuizQuestion(bot, chatId, sessionId, questions, nextIndex);
  } else {
    // 퀴즈 완료
    const { data: session } = await supabase
      .from('quiz_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    const totalCorrect = (session?.correct_answers || 0) + (isCorrect ? 1 : 0);
    const totalQ = questions.length;
    const pct = Math.round((totalCorrect / totalQ) * 100);

    await supabase.from('quiz_sessions').update({
      correct_answers: totalCorrect,
      is_completed: true,
      completed_at: new Date().toISOString()
    }).eq('id', sessionId);

    // 활동 기록
    await supabase.from('daily_activity').upsert({
      student_id: chatId,
      activity_date: new Date().toISOString().split('T')[0],
      quiz_completed: true
    }, { onConflict: 'student_id, activity_date' });

    // 임시 데이터 정리
    await supabase.from('admin_config').delete().eq('key', `quiz_data_${sessionId}`);

    let emoji = pct >= 90 ? '🏆' : pct >= 70 ? '👏' : pct >= 50 ? '💪' : '📚';
    let message = pct >= 90 ? '완벽해요! / អស្ចារ្យ!' :
                  pct >= 70 ? '잘했어요! / ល្អណាស់!' :
                  pct >= 50 ? '괜찮아요! / មិនអីទេ!' :
                  '더 열심히! / ខិតខំបន្ថែម!';

    await bot.sendMessage(chatId, feedback);
    await bot.sendMessage(chatId,
      `${emoji} 퀴즈 완료!\n\n` +
      `📊 결과: ${totalCorrect}/${totalQ} (${pct}%)\n` +
      `${message}\n\n` +
      `${pct < 70 ? '틀린 단어는 내일 복습 퀴즈에 나옵니다! / ពាក្យខុសនឹងចេញម្តងទៀតថ្ងៃស្អែក!' : ''}`
    );
  }

  await bot.answerCallbackQuery(query.id);
}

// ── 틀린 단어 추적 업데이트 ──
async function updateWrongTracker(studentId, wordId, isCorrect) {
  const { data: existing } = await supabase
    .from('wrong_word_tracker')
    .select('*')
    .eq('student_id', studentId)
    .eq('word_id', wordId)
    .single();

  if (isCorrect) {
    if (existing) {
      const newConsecutive = existing.consecutive_correct + 1;
      await supabase.from('wrong_word_tracker').update({
        consecutive_correct: newConsecutive,
        is_mastered: newConsecutive >= 3,  // 3번 연속 맞히면 마스터
        last_reviewed_at: new Date().toISOString()
      }).eq('id', existing.id);
    }
  } else {
    if (existing) {
      await supabase.from('wrong_word_tracker').update({
        wrong_count: existing.wrong_count + 1,
        consecutive_correct: 0,  // 리셋
        is_mastered: false,
        last_wrong_at: new Date().toISOString()
      }).eq('id', existing.id);
    } else {
      await supabase.from('wrong_word_tracker').insert({
        student_id: studentId,
        word_id: wordId,
        wrong_count: 1,
        consecutive_correct: 0
      });
    }
  }
}

// ── 듣기 문제 콜백 처리 ──
async function handleListeningCallback(bot, query) {
  const chatId = query.message.chat.id;
  const data = query.data;

  // listen_questionId_selectedAnswer_correctAnswer
  const parts = data.split('_');
  const questionId = parseInt(parts[1]);
  const selected = parts[2];
  const correct = parts[3];

  const isCorrect = selected === correct;

  // 답변 저장
  await supabase.from('listening_answers').insert({
    student_id: chatId,
    question_id: questionId,
    student_answer: selected,
    is_correct: isCorrect
  });

  const feedback = isCorrect
    ? `✅ 정답! / ត្រឹមត្រូវ!`
    : `❌ 오답! 정답: ${correct}`;

  await bot.answerCallbackQuery(query.id, { text: feedback, show_alert: true });
  await bot.sendMessage(chatId, feedback);
}

module.exports = { startQuiz, handleQuizCallback, handleListeningCallback };
