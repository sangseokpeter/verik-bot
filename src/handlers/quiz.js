const { supabase } = require('../config/supabase');

// ── start_date 기준 current_day 계산 ──
function calcCurrentDay(startDate) {
  const start = new Date(startDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today - start) / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, Math.min(diffDays, 35));
}

// ── 퀴즈 시작 (chatId 직접 받기 — 스케줄러/콜백 양쪽에서 호출) ──
async function startQuiz(bot, chatIdOrMsg, quizType = 'daily') {
  const chatId = typeof chatIdOrMsg === 'object' ? chatIdOrMsg.chat.id : chatIdOrMsg;

  const { data: student } = await supabase
    .from('students')
    .select('current_day, start_date, first_name')
    .eq('id', chatId)
    .single();

  if (!student) {
    return bot.sendMessage(chatId,
      `❌ សូមចុច /start ដើម្បីចុះឈ្មោះជាមុន!`);
  }

  // start_date 기반 current_day 계산
  const dayNumber = student.start_date
    ? calcCurrentDay(student.start_date)
    : student.current_day;
  const isWeekly = quizType === 'weekly';

  // 전체 단어 풀 가져오기 (오답 보기용)
  const { data: allWords } = await supabase
    .from('words')
    .select('id, meaning_khmer')
    .order('id');

  // 문제 생성
  let questions = [];

  if (isWeekly) {
    // 토요일: 이번 주 전체 단어 (최근 6일)
    const weekStart = Math.max(1, dayNumber - 5);
    const { data: weekWords } = await supabase
      .from('words')
      .select('*')
      .gte('day_number', weekStart)
      .lte('day_number', dayNumber)
      .order('id');

    const wordQ = generateQuestions(weekWords, 20, allWords, 'word');
    const listeningPool = (weekWords || []).filter(w => w.example_audio_url || w.audio_url);
    const listeningQ = generateQuestions(
      listeningPool.length > 0 ? listeningPool : (weekWords || []),
      10, allWords, 'listening'
    );
    questions = [...wordQ, ...listeningQ];
  } else {
    // 평일: 복습 5 + 오늘 단어 10 + 듣기 5
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

    const reviewQ = generateQuestions(reviewWords, 5, allWords, 'word');
    const todayQ = generateQuestions(todayWords || [], 10, allWords, 'word');
    const listeningPool = (todayWords || []).filter(w => w.example_audio_url || w.audio_url);
    const listeningQ = generateQuestions(
      listeningPool.length > 0 ? listeningPool : (todayWords || []),
      5, allWords, 'listening'
    );
    questions = [...reviewQ, ...todayQ, ...listeningQ];
  }

  if (questions.length === 0) {
    return bot.sendMessage(chatId,
      `📝 មិនមានសំណួរថ្ងៃនេះទេ។\n(오늘 퀴즈 문제가 없습니다.)`);
  }

  // 문제 구성 안내
  const wordCount = questions.filter(q => q.type === 'word').length;
  const listenCount = questions.filter(q => q.type === 'listening').length;
  const hasAudio = questions.filter(q => q.type === 'listening' && q.audio_url).length;
  await bot.sendMessage(chatId,
    `📋 តេស្តថ្ងៃនេះ: ${questions.length} សំណួរ\n` +
    `📝 ពាក្យ: ${wordCount} | 🎧 ស្តាប់: ${listenCount}\n` +
    (listenCount > 0 && hasAudio === 0
      ? `⚠️ សំឡេងមិនទាន់មាន - តេស្តជាអក្សរ\n(음성 미준비 - 텍스트로 출제)\n\n`
      : `\n`) +
    `💪 ចាប់ផ្តើម!`
  );

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
function generateQuestions(words, count, allWords, type = 'word') {
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
      type: type,
      word_id: word.id,
      korean: word.korean,
      pronunciation: word.pronunciation,
      audio_url: type === 'listening'
        ? (word.example_audio_url || word.audio_url || null)
        : (word.audio_url || null),
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

  // 단어 → 듣기 전환 메시지
  if (index > 0 && questions[index].type === 'listening' && questions[index - 1].type === 'word') {
    await bot.sendMessage(chatId,
      `🎉 ពាក្យរួចហើយ! មកដល់ផ្នែកស្តាប់!\n` +
      `(단어퀴즈 완료! 이제 듣기 퀴즈!)\n\n` +
      `🎧 សូមស្តាប់សំឡេង ហើយជ្រើសន័យត្រឹមត្រូវ!\n` +
      `(음성을 듣고 크메르어 뜻을 고르세요!)`
    );
  }

  // 듣기 문제: 음성 먼저 전송
  let text;
  if (q.type === 'listening') {
    if (q.audio_url) {
      await bot.sendVoice(chatId, q.audio_url);
    }
    text =
      `🎧 ${index + 1}/${questions.length}\n\n` +
      `តើពាក្យនេះមានន័យថាអ្វី?\n(들은 단어의 뜻은?)`;
  } else {
    text =
      `📝 ${index + 1}/${questions.length}\n\n` +
      `🇰🇷 "${q.korean}" ${q.pronunciation}\n\n` +
      `이 단어의 뜻은? / តើពាក្យនេះមានន័យថាអ្វី?`;
  }

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

  // quiz_start_daily / quiz_start_weekly → 퀴즈 자동 생성 시작
  if (data === 'quiz_start_daily') {
    await bot.answerCallbackQuery(query.id);
    return startQuiz(bot, chatId, 'daily');
  }
  if (data === 'quiz_start_weekly') {
    await bot.answerCallbackQuery(query.id);
    return startQuiz(bot, chatId, 'weekly');
  }

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
    const { data: currentSession } = await supabase
      .from('quiz_sessions')
      .select('correct_answers')
      .eq('id', sessionId)
      .single();
    
    await supabase
      .from('quiz_sessions')
      .update({ correct_answers: (currentSession?.correct_answers || 0) + 1 })
      .eq('id', sessionId);
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

  // 콜백 응답 (한 번만 호출)
  await bot.answerCallbackQuery(query.id);

  if (nextIndex < questions.length) {
    // 피드백 + 다음 문제
    await bot.sendMessage(chatId, feedback);
    await sendQuizQuestion(bot, chatId, sessionId, questions, nextIndex);
  } else {
    // 퀴즈 완료 — DB에서 최종 점수 읽기
    const { data: session } = await supabase
      .from('quiz_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    // 마지막 문제 정답도 반영
    const totalCorrect = (session?.correct_answers || 0) + (isCorrect ? 1 : 0);
    const totalQ = questions.length;
    const pct = totalQ > 0 ? Math.round((totalCorrect / totalQ) * 100) : 0;

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
    let khmerMsg = pct >= 90 ? 'អស្ចារ្យ!' :
                   pct >= 70 ? 'ល្អណាស់!' :
                   pct >= 50 ? 'មិនអីទេ!' :
                   'ខិតខំបន្ថែម!';

    await bot.sendMessage(chatId, feedback);
    await bot.sendMessage(chatId,
      `${emoji} តេស្តរួចរាល់!\n\n` +
      `📊 លទ្ធផល: ${totalCorrect}/${totalQ} (${pct}%)\n` +
      `${khmerMsg}\n\n` +
      `${pct < 70 ? '🔄 ពាក្យខុសនឹងចេញម្តងទៀតថ្ងៃស្អែក!' : ''}`
    );

    // Admin에게 학생별 결과 요약 전송
    await sendQuizResultToAdmin(bot, chatId, session, totalCorrect, totalQ, pct);
  }
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

// ── Admin에게 퀴즈 결과 요약 전송 ──
async function sendQuizResultToAdmin(bot, studentId, session, correct, total, pct) {
  try {
    const { data: student } = await supabase
      .from('students')
      .select('first_name, username')
      .eq('id', studentId)
      .single();

    const { data: config } = await supabase
      .from('admin_config').select('value').eq('key', 'admin_chat_id').single();

    if (!config?.value) return;

    const emoji = pct >= 90 ? '🏆' : pct >= 70 ? '👏' : pct >= 50 ? '💪' : '⚠️';
    const name = student?.first_name || 'Unknown';
    const handle = student?.username ? ` (@${student.username})` : '';
    const type = session?.quiz_type === 'weekly' ? 'Weekly' : 'Daily';

    await bot.sendMessage(config.value,
      `${emoji} Quiz Result\n` +
      `Student: ${name}${handle}\n` +
      `Type: ${type} | Day ${session?.day_number || '?'}\n` +
      `Score: ${correct}/${total} (${pct}%)`
    );
  } catch (err) {
    console.error('Admin quiz result notify failed:', err.message);
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
