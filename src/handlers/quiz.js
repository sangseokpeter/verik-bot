const { supabase } = require('../config/supabase');

// ── start_date 기준 current_day 계산 ──
function calcCurrentDay(startDate) {
  if (!startDate) return 1;
  const start = new Date(startDate + 'T00:00:00');
  if (isNaN(start.getTime())) return 1;
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
    // 평일: 오늘 단어 15 + 복습 5 = 20문제
    const { data: todayWords } = await supabase
      .from('words')
      .select('*')
      .eq('day_number', dayNumber)
      .order('id');

    const { data: wrongWords } = await supabase
      .from('wrong_word_tracker')
      .select('word_id, words(*)')
      .eq('student_id', chatId)
      .eq('is_mastered', false)
      .order('wrong_count', { ascending: false })
      .limit(5);

    const reviewWords = wrongWords?.map(w => w.words).filter(Boolean) || [];

    const todayQ = generateQuestions(todayWords || [], 15, allWords, 'word');
    const reviewQ = generateQuestions(reviewWords, 5, allWords, 'word');
    questions = [...todayQ, ...reviewQ];
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
      try { await bot.sendAudio(chatId, q.audio_url); } catch (e) {
        console.error(`[QUIZ] Audio send error:`, e.message);
      }
      text =
        `🎧 ${index + 1}/${questions.length}\n\n` +
        `តើពាក្យនេះមានន័យថាអ្វី?\n(들은 단어의 뜻은?)`;
    } else {
      text =
        `🎧 ${index + 1}/${questions.length}\n\n` +
        `🇰🇷 "${q.korean}" ${q.pronunciation || ''}\n\n` +
        `(음성 없음) 이 단어의 크메르어 뜻은?\nតើពាក្យនេះមានន័យថាអ្វី?`;
    }
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

    // correct_answers는 258-268행에서 이미 업데이트됨 → 그대로 사용
    const totalCorrect = session?.correct_answers || 0;
    const totalQ = questions.length;
    const pct = totalQ > 0 ? Math.round((totalCorrect / totalQ) * 100) : 0;

    await supabase.from('quiz_sessions').update({
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
      `${emoji} តេស្តពាក្យរួចរាល់!\n\n` +
      `📊 លទ្ធផល: ${totalCorrect}/${totalQ} (${pct}%)\n` +
      `${khmerMsg}\n\n` +
      `${pct < 70 ? '🔄 ពាក្យខុសនឹងចេញម្តងទៀតថ្ងៃស្អែក!\n\n' : ''}` +
      `🎧 ឥឡូវដល់ផ្នែកស្តាប់!\n(이제 듣기 퀴즈 시작!)`
    );

    // Admin에게 학생별 결과 요약 전송
    await sendQuizResultToAdmin(bot, chatId, session, totalCorrect, totalQ, pct);

    // 단어 퀴즈 완료 → 듣기 퀴즈 자동 시작
    try {
      await startListeningQuiz(bot, chatId);
    } catch (listenErr) {
      console.error('[QUIZ→LISTENING] Auto-start failed:', listenErr.message);
    }
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

// ══════════════════════════════════════════════
// 듣기 퀴즈 시스템 (listening_questions 테이블 기반)
// ══════════════════════════════════════════════

// ── 듣기 퀴즈 시작 ──
// overrideDay: 테스트용 day 지정 (null이면 학생 current_day 사용)
async function startListeningQuiz(bot, chatIdOrMsg, overrideDay = null) {
  const chatId = typeof chatIdOrMsg === 'object' ? chatIdOrMsg.chat.id : chatIdOrMsg;

  try {
    const { data: student, error: studentErr } = await supabase
      .from('students')
      .select('current_day, start_date, first_name')
      .eq('id', chatId)
      .single();

    if (studentErr) {
      console.error('[LISTENING] Student lookup error:', studentErr.message);
    }

    if (!student) {
      return bot.sendMessage(chatId,
        `❌ សូមចុច /start ដើម្បីចុះឈ្មោះជាមុន!`);
    }

    let dayNumber = overrideDay
      || (student.start_date ? calcCurrentDay(student.start_date) : student.current_day)
      || 1;

    console.log(`[LISTENING] Student ${chatId} day=${dayNumber} (override=${overrideDay || 'none'})`);

    // listening_questions 테이블에서 해당 day 문제 가져오기
    let { data: questions, error: qErr } = await supabase
      .from('listening_questions')
      .select('*')
      .eq('day_number', dayNumber)
      .eq('is_approved', true)
      .order('id');

    if (qErr) {
      console.error('[LISTENING] Questions query error:', qErr.message);
      return bot.sendMessage(chatId, `❌ Error loading listening questions: ${qErr.message}`);
    }

    // Day에 문제가 없으면: day 1로 fallback (전체 일정 순환)
    if (!questions || questions.length === 0) {
      console.log(`[LISTENING] No questions for day ${dayNumber}, falling back to day 1`);
      const fallback = await supabase
        .from('listening_questions')
        .select('*')
        .eq('day_number', 1)
        .eq('is_approved', true)
        .order('id');
      questions = fallback.data;
      if (!questions || questions.length === 0) {
        return bot.sendMessage(chatId,
          `🎧 ថ្ងៃនេះមិនមានសំណួរស្តាប់ទេ។\n(오늘 듣기 문제가 없습니다.)\n\n📌 Day: ${dayNumber}`);
      }
      dayNumber = 1; // fallback day
    }

    console.log(`[LISTENING] Found ${questions.length} questions for day ${dayNumber}`);

    // 5문제만 선택
    const selected = questions.slice(0, 5);

    // TOPIK 메타 정보 파싱 (첫 문제에서 회차 추출)
    let examInfo = '';
    try {
      const meta = JSON.parse(selected[0].transcript_kr || '{}');
      if (meta.exam_round) examInfo = ` (TOPIK ${meta.exam_round}회)`;
    } catch (e) { /* ignore */ }

    await bot.sendMessage(chatId,
      `🎧 តេស្តស្តាប់ថ្ងៃនេះ: ${selected.length} សំណួរ${examInfo}\n` +
      `(듣기 퀴즈 ${selected.length}문제${examInfo})\n\n` +
      `📋 សូមស្តាប់សំឡេង → អានសំណួរ → ជ្រើសចម្លើយ\n` +
      `(음성 듣기 → 문제 읽기 → 답 선택)\n\n` +
      `💪 ចាប់ផ្តើម!`
    );

    // 세션 생성
    const { data: session, error: sessionErr } = await supabase
      .from('quiz_sessions')
      .insert({
        student_id: chatId,
        day_number: dayNumber,
        quiz_type: 'listening',
        total_questions: selected.length
      })
      .select()
      .single();

    if (sessionErr) {
      console.error('[LISTENING] Session create error:', sessionErr.message);
      return bot.sendMessage(chatId, `❌ Error creating quiz session: ${sessionErr.message}`);
    }

    // 문제 데이터를 세션에 저장
    const questionsData = selected.map(q => ({
      id: q.id,
      audio_url: q.audio_url,
      question_text: q.question_text,
      options: [q.option_a, q.option_b, q.option_c, q.option_d],
      correct_answer: q.correct_answer // 'A', 'B', 'C', 'D'
    }));

    await supabase.from('admin_config').upsert({
      key: `lquiz_data_${session.id}`,
      value: JSON.stringify(questionsData),
      updated_at: new Date().toISOString()
    });

    // 첫 문제 전송
    await sendListeningQuestion(bot, chatId, session.id, questionsData, 0);
  } catch (err) {
    console.error('[LISTENING] Unexpected error:', err);
    // Admin 알림
    try {
      const { data: cfg } = await supabase
        .from('admin_config').select('value').eq('key', 'admin_chat_id').single();
      if (cfg?.value) {
        await bot.sendMessage(cfg.value,
          `⚠️ [LISTENING ERROR]\nStudent: ${chatId}\nError: ${err.message}\n${err.stack?.slice(0, 200) || ''}`);
      }
    } catch (e) { /* ignore admin notify error */ }
    try {
      await bot.sendMessage(chatId, `❌ Listening quiz error: ${err.message}`);
    } catch (e) { /* ignore send error */ }
  }
}

// ── 듣기 문제 전송 (문제+보기 → 음성 → 답 대기) ──
async function sendListeningQuestion(bot, chatId, sessionId, questions, index) {
  const q = questions[index];
  const labels = ['A', 'B', 'C', 'D'];
  const correctIdx = labels.indexOf(q.correct_answer);

  // Step 1: 문제 텍스트 + 보기 전송
  let text = `🎧 ${index + 1}/${questions.length}\n\n`;
  text += `${q.question_text}\n\n`;
  text += q.options.map((opt, i) => `${labels[i]}. ${opt}`).join('\n');

  await bot.sendMessage(chatId, text);

  // Step 2: 음성 전송 (MP3 → sendAudio)
  if (q.audio_url) {
    try {
      await bot.sendAudio(chatId, q.audio_url, {
        caption: '🔊 សូមស្តាប់រួចជ្រើសចម្លើយ (음성을 듣고 답을 선택하세요)',
        title: `TOPIK 듣기`
      });
    } catch (err) {
      console.error(`[LISTENING] Audio send error for Q${q.id}:`, err.message);
      await bot.sendMessage(chatId, `⚠️ សំឡេងមិនអាចបើកបាន (음성 재생 불가)\nURL: ${q.audio_url}`);
    }
  }

  // Step 3: 답 선택 버튼
  const keyboard = {
    inline_keyboard: q.options.map((opt, i) => [{
      text: `${labels[i]}. ${opt}`,
      callback_data: `lquiz_${sessionId}_${index}_${i}_${correctIdx}_${q.id}`
    }])
  };

  await bot.sendMessage(chatId, `❓ ជ្រើសចម្លើយ / 답을 선택하세요:`, { reply_markup: keyboard });
}

// ── 듣기 퀴즈 콜백 처리 ──
async function handleListeningCallback(bot, query) {
  const chatId = query.message.chat.id;
  const data = query.data;

  // lquiz_start → 듣기 퀴즈 시작
  if (data === 'lquiz_start') {
    await bot.answerCallbackQuery(query.id);
    return startListeningQuiz(bot, chatId);
  }

  // lquiz_sessionId_qIndex_selected_correct_questionId
  const parts = data.split('_');
  const sessionId = parseInt(parts[1]);
  const qIndex = parseInt(parts[2]);
  const selected = parseInt(parts[3]);
  const correct = parseInt(parts[4]);
  const questionId = parseInt(parts[5]);

  const isCorrect = selected === correct;
  const labels = ['A', 'B', 'C', 'D'];

  // 답변 저장 (listening_answers)
  await supabase.from('listening_answers').insert({
    student_id: chatId,
    question_id: questionId,
    student_answer: labels[selected],
    is_correct: isCorrect
  });

  // 세션 점수 업데이트
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

  // 피드백
  let feedback;
  if (isCorrect) {
    feedback = `✅ ត្រឹមត្រូវ! / 정답! (${labels[correct]})`;
  } else {
    feedback = `❌ មិនត្រឹមត្រូវ / 오답\n정답: ${labels[correct]}`;
  }

  // 문제 데이터 가져오기
  const { data: configData } = await supabase
    .from('admin_config')
    .select('value')
    .eq('key', `lquiz_data_${sessionId}`)
    .single();

  const questions = configData ? JSON.parse(configData.value) : [];
  const nextIndex = qIndex + 1;

  await bot.answerCallbackQuery(query.id);

  if (nextIndex < questions.length) {
    // 피드백 + 다음 문제
    await bot.sendMessage(chatId, feedback);
    await sendListeningQuestion(bot, chatId, sessionId, questions, nextIndex);
  } else {
    // 퀴즈 완료
    const { data: session } = await supabase
      .from('quiz_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    // correct_answers는 619-630행에서 이미 업데이트됨 → 그대로 사용
    const totalCorrect = session?.correct_answers || 0;
    const totalQ = questions.length;
    const pct = totalQ > 0 ? Math.round((totalCorrect / totalQ) * 100) : 0;

    await supabase.from('quiz_sessions').update({
      is_completed: true,
      completed_at: new Date().toISOString()
    }).eq('id', sessionId);

    // 활동 기록
    await supabase.from('daily_activity').upsert({
      student_id: chatId,
      activity_date: new Date().toISOString().split('T')[0],
      listening_completed: true
    }, { onConflict: 'student_id, activity_date' });

    // 임시 데이터 정리
    await supabase.from('admin_config').delete().eq('key', `lquiz_data_${sessionId}`);

    let emoji = pct >= 90 ? '🏆' : pct >= 70 ? '👏' : pct >= 50 ? '💪' : '📚';
    let khmerMsg = pct >= 90 ? 'អស្ចារ្យ!' :
                   pct >= 70 ? 'ល្អណាស់!' :
                   pct >= 50 ? 'មិនអីទេ!' :
                   'ខិតខំបន្ថែម!';

    await bot.sendMessage(chatId, feedback);
    await bot.sendMessage(chatId,
      `${emoji} តេស្តស្តាប់រួចរាល់!\n\n` +
      `📊 លទ្ធផល: ${totalCorrect}/${totalQ} (${pct}%)\n` +
      `${khmerMsg}\n\n` +
      `🎧 듣기 퀴즈 완료!`
    );

    // Admin 알림
    await sendQuizResultToAdmin(bot, chatId, session, totalCorrect, totalQ, pct);
  }
}

// ══════════════════════════════════════════════
// 테스트 명령어
// ══════════════════════════════════════════════

// /test_listening {day} — 특정 day 듣기 5문제 테스트
async function testListeningByDay(bot, msg, day) {
  const chatId = msg.chat.id;
  const dayNum = parseInt(day);
  if (!dayNum || dayNum < 1) {
    return bot.sendMessage(chatId, `Usage: /test_listening {day}\nExample: /test_listening 1`);
  }
  console.log(`[TEST_LISTENING] Admin ${chatId} testing day=${dayNum}`);
  return startListeningQuiz(bot, chatId, dayNum);
}

// /test_listening_q {exam}_{qnum} — 특정 회차/번호 단일 문제 테스트
async function testListeningQuestion(bot, msg, examQ) {
  const chatId = msg.chat.id;
  const parts = (examQ || '').split('_');
  if (parts.length < 2) {
    return bot.sendMessage(chatId, `Usage: /test_listening_q {exam}_{qnum}\nExample: /test_listening_q 52_1`);
  }
  const exam = parseInt(parts[0]);
  const qnum = parseInt(parts[1]);

  try {
    // transcript_kr JSON에서 exam_round, question_number 매칭
    const { data: questions, error } = await supabase
      .from('listening_questions')
      .select('*')
      .eq('question_type', `TOPIK_${exam}`)
      .order('id');

    if (error) {
      return bot.sendMessage(chatId, `❌ Query error: ${error.message}`);
    }

    // transcript_kr에서 question_number 매칭
    const match = (questions || []).find(q => {
      try {
        const meta = JSON.parse(q.transcript_kr || '{}');
        return meta.question_number === qnum;
      } catch { return false; }
    });

    if (!match) {
      return bot.sendMessage(chatId, `❌ Not found: TOPIK ${exam}회 Q${qnum}`);
    }

    const meta = JSON.parse(match.transcript_kr || '{}');
    await bot.sendMessage(chatId,
      `🧪 Test: TOPIK ${exam}회 Q${qnum}\n` +
      `Type: ${match.question_type}\n` +
      `Day: ${match.day_number}\n` +
      `Active: ${match.is_approved}\n` +
      `Audio key: ${meta.audio_key || 'N/A'}\n` +
      `Notes: ${meta.notes || 'none'}\n` +
      `Picture: ${meta.is_picture ? 'YES (excluded)' : 'no'}`
    );

    // 음성 전송
    if (match.audio_url) {
      try {
        await bot.sendAudio(chatId, match.audio_url, {
          caption: `🔊 TOPIK ${exam}회 Q${qnum}`,
          title: `TOPIK_${exam}_Q${qnum}`
        });
      } catch (err) {
        await bot.sendMessage(chatId, `⚠️ Audio failed: ${err.message}\nURL: ${match.audio_url}`);
      }
    }

    // 문제 + 보기
    const labels = ['A', 'B', 'C', 'D'];
    let text = `❓ ${match.question_text}\n\n`;
    text += [match.option_a, match.option_b, match.option_c, match.option_d]
      .map((opt, i) => `${labels[i]}. ${opt}`).join('\n');
    text += `\n\n✅ 정답: ${match.correct_answer}`;

    await bot.sendMessage(chatId, text);
  } catch (err) {
    console.error('[TEST_LISTENING_Q] Error:', err);
    await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
}

module.exports = {
  startQuiz, startListeningQuiz, handleQuizCallback, handleListeningCallback,
  testListeningByDay, testListeningQuestion
};
