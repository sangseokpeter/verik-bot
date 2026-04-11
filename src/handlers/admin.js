const { supabase } = require('../config/supabase');
const Anthropic = require('@anthropic-ai/sdk');

const ADMIN_IDS = process.env.ADMIN_IDS?.split(',').map(Number) || [];
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

function calcCurrentDay(startDate) {
  if (!startDate) return 1;
  const start = new Date(startDate + 'T00:00:00');
  if (isNaN(start.getTime())) return 1;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today - start) / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, Math.min(diffDays, 35));
}

// ── /admin 대시보드 ──
async function handleAdminCommand(bot, msg) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const { count: studentCount } = await supabase
    .from('students').select('id', { count: 'exact' }).eq('is_active', true);

  const { data: recentSessions } = await supabase
    .from('quiz_sessions')
    .select('correct_answers, total_questions')
    .eq('is_completed', true)
    .gte('completed_at', new Date(Date.now() - 24*60*60*1000).toISOString());

  const todayQuizzes = recentSessions?.length || 0;
  const avgScore = recentSessions?.length > 0
    ? Math.round(recentSessions.reduce((sum, s) => sum + (s.correct_answers / s.total_questions * 100), 0) / recentSessions.length)
    : 0;

  const { count: cardsReady } = await supabase
    .from('words').select('id', { count: 'exact' }).not('image_url', 'is', null);

  const { count: ttsReady } = await supabase
    .from('words').select('id', { count: 'exact' }).not('audio_url', 'is', null);

  await bot.sendMessage(msg.chat.id,
    `🔧 VERI-K Admin Dashboard\n\n` +
    `👥 Active students: ${studentCount}\n` +
    `📝 Quizzes today: ${todayQuizzes}\n` +
    `📊 Avg score: ${avgScore}%\n` +
    `🎨 Cards ready: ${cardsReady} / 1025\n` +
    `🔊 TTS ready: ${ttsReady} / 1025\n\n` +
    `Commands:\n` +
    `/broadcast [msg] - Send to all students\n` +
    `/reply [id] [msg] - Reply to a student (student sees Khmer header)\n` +
    `/generate_cards [day] - Generate card images\n` +
    `/generate_tts [day] - Generate TTS audio\n` +
    `/generate_all - Auto-generate Day 1~35 (cards + TTS)\n` +
    `/admin - This dashboard`
  );
}

// ── /broadcast 전체 공지 ──
async function handleBroadcast(bot, msg, message) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const { data: students } = await supabase
    .from('students').select('id').eq('is_active', true);

  if (!students || students.length === 0) {
    return bot.sendMessage(msg.chat.id, '⚠️ No active students found.');
  }

  let sent = 0, failed = 0;
  for (const student of students) {
    try {
      await bot.sendMessage(student.id, `📢 ${message}`);
      sent++;
    } catch (err) {
      failed++;
    }
  }

  await supabase.from('announcements').insert({
    message, sent_by: msg.from.id, recipients_count: sent
  });

  await bot.sendMessage(msg.chat.id,
    `✅ Broadcast complete\nSent: ${sent} / Failed: ${failed}`
  );
}

// ── /generate_cards [day] ──
async function handleGenerateCards(bot, msg, dayNumber) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const day = parseInt(dayNumber);
  if (isNaN(day) || day < 1 || day > 35) {
    return bot.sendMessage(msg.chat.id, '⚠️ Usage: /generate_cards [1-35]');
  }

  await bot.sendMessage(msg.chat.id, `🎨 Starting card generation for Day ${day}...`);
  const { generateCardsForDay } = require('../services/content-generator');
  generateCardsForDay(bot, day);
}

// ── /generate_tts [day] ──
async function handleGenerateTTS(bot, msg, dayNumber) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const day = parseInt(dayNumber);
  if (isNaN(day) || day < 1 || day > 35) {
    return bot.sendMessage(msg.chat.id, '⚠️ Usage: /generate_tts [1-35]');
  }

  await bot.sendMessage(msg.chat.id, `🔊 Starting TTS generation for Day ${day}...`);
  const { generateTTSForDay } = require('../services/content-generator');
  generateTTSForDay(bot, day);
}

// ── /generate_all - Day 1~35 전체 자동 순차 생성 ──
async function handleGenerateAll(bot, msg) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const adminId = msg.chat.id;
  await bot.sendMessage(adminId,
    `🚀 Starting auto-generation for Day 1~35\n` +
    `Cards + TTS will be generated sequentially.\n` +
    `You will receive a report after each day completes.`
  );

  const { generateCardsForDay, generateTTSForDay } = require('../services/content-generator');

  // 백그라운드에서 순차 실행
  (async () => {
    for (let day = 1; day <= 35; day++) {
      try {
        // 이미 카드 있는 day는 스킵
        const { count: existing } = await supabase
          .from('words')
          .select('id', { count: 'exact' })
          .eq('day_number', day)
          .not('image_url', 'is', null);

        const { count: total } = await supabase
          .from('words')
          .select('id', { count: 'exact' })
          .eq('day_number', day);

        if (existing >= total) {
          await bot.sendMessage(adminId, `⏭️ Day ${day}: Already complete (${existing}/${total}). Skipping.`);
          continue;
        }

        await bot.sendMessage(adminId, `🎨 Day ${day}: Generating ${total - existing} cards...`);
        await generateCardsForDay(bot, day);

        await bot.sendMessage(adminId, `🔊 Day ${day}: Generating TTS...`);
        await generateTTSForDay(bot, day);

        await bot.sendMessage(adminId, `✅ Day ${day} complete!`);

        // 다음 Day 전 2초 대기
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        await bot.sendMessage(adminId, `❌ Day ${day} failed: ${err.message}`);
      }
    }
    await bot.sendMessage(adminId, `🎉 All days (1~35) generation complete!`);
  })();
}

// ── Claude API 연동 - Admin 자연어 명령 처리 ──
async function handleAdminMessage(bot, msg) {
  if (!isAdmin(msg.from.id)) return;

  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  try {
    const response = await claude.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `You are VERI-K admin assistant.
You help manage a Korean language learning bot for Cambodian students.
Available commands: /generate_cards [day], /generate_tts [day], /generate_all, /broadcast [msg], /admin, /generate_motion [day], /generate_images [day], /approve_images [day], /redo_image [day] [word], /image_status.

When the admin asks to do something, SUGGEST the exact command they should type — but make it clear they must run it themselves. NEVER imply that you will execute it for them. Always respond in English. Be concise.`,
      messages: [{ role: 'user', content: text }]
    });

    const reply = response.content[0].text;
    await bot.sendMessage(msg.chat.id, `🤖 Assistant:\n${reply}`);

    // NOTE: 자동 명령어 실행 기능 비활성화 (2026-04-11).
    // 어시스턴트의 응답에 명령어가 포함되어 있어도 자동으로 실행하지 않는다.
    // 어드민이 명령어를 직접 입력해야 한다.
  } catch (err) {
    console.error('Claude API error:', err.message);
    await bot.sendMessage(msg.chat.id, `❌ Assistant error: ${err.message}`);
  }
}

// ── /ask — 학생 → Admin 문의 전달 ──
async function handleStudentAsk(bot, msg, question) {
  const studentId = msg.from.id;
  const firstName = msg.from.first_name || 'Unknown';
  const username = msg.from.username ? `@${msg.from.username}` : '(no username)';

  // 학생에게 확인 메시지
  await bot.sendMessage(studentId,
    `✅ សំណួររបស់អ្នកបានផ្ញើហើយ!\n(질문이 전달되었습니다. 곧 답변드릴게요!)\n\n❓ "${question}"`
  );

  // Admin에게 학생 정보 + 질문 전송
  const { data: config } = await supabase
    .from('admin_config').select('value').eq('key', 'admin_chat_id').single();

  if (!config?.value) return;

  // DB에서 학생 추가 정보 조회
  const { data: student } = await supabase
    .from('students')
    .select('first_name, username, start_date, current_day')
    .eq('id', studentId)
    .single();

  const currentDay = student?.start_date ? calcCurrentDay(student.start_date) : '?';
  const name = student?.first_name || firstName;
  const handle = student?.username ? ` (@${student.username})` : ` (${username})`;

  await bot.sendMessage(config.value,
    `❓ Student Question\n` +
    `──────────────────\n` +
    `👤 ${name}${handle}\n` +
    `🆔 ID: ${studentId}\n` +
    `📅 Day: ${currentDay}/35\n` +
    `──────────────────\n` +
    `💬 "${question}"\n\n` +
    `↩️ 답장: /reply ${studentId} [내용]`
  );
}

// ── /reply — Admin → 학생 개별 답장 ──
async function handleReply(bot, msg, studentId, message) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const id = parseInt(studentId);

  const { data: student } = await supabase
    .from('students')
    .select('first_name')
    .eq('id', id)
    .single();

  if (!student) {
    return bot.sendMessage(msg.chat.id, `⚠️ Student not found: ${id}`);
  }

  try {
    // 학생에게 크메르어로 답장
    await bot.sendMessage(id,
      `📩 ការឆ្លើយតបពីគ្រូ:\n\n${message}`
    );

    // Admin에게 영어로 확인
    await bot.sendMessage(msg.chat.id,
      `✅ Reply sent to ${student.first_name} (${id})`
    );
  } catch (err) {
    await bot.sendMessage(msg.chat.id,
      `❌ Failed to send: ${err.message}`
    );
  }
}

// ── /stats — 학생 현황 통계 ──
async function handleStats(bot, msg) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  // 전체 학생
  const { data: students } = await supabase
    .from('students')
    .select('id, start_date')
    .eq('is_active', true);

  const totalStudents = students?.length || 0;

  // 오늘 퀴즈 완료 학생 수
  const todayStr = new Date().toISOString().split('T')[0];
  const { count: activeToday } = await supabase
    .from('daily_activity')
    .select('id', { count: 'exact' })
    .eq('activity_date', todayStr)
    .eq('quiz_completed', true);

  // Day별 학생 수 분포
  const dayMap = {};
  for (const s of (students || [])) {
    const day = calcCurrentDay(s.start_date);
    dayMap[day] = (dayMap[day] || 0) + 1;
  }

  const dayDist = Object.entries(dayMap)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([day, count]) => `  Day ${day}: ${count}명`)
    .join('\n');

  await bot.sendMessage(msg.chat.id,
    `📊 VERI-K Stats\n` +
    `──────────────────\n` +
    `👥 Total students: ${totalStudents}\n` +
    `📅 Active today: ${activeToday || 0}\n` +
    `──────────────────\n` +
    `📈 Day distribution:\n${dayDist || '  (no students)'}`
  );
}

// ── /generate_motion [day] — 모션 카드 비디오 생성 ──
async function handleGenerateMotion(bot, msg, dayArg) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const label = dayArg ? `Day ${dayArg}` : 'All 35 days';
  await bot.sendMessage(msg.chat.id, `🎬 Starting motion card generation: ${label}...`);

  const { execSync } = require('child_process');
  // python3 또는 python 자동 탐지
  let py = 'python3';
  try { execSync('python3 --version', { stdio: 'ignore' }); } catch {
    try { execSync('python --version', { stdio: 'ignore' }); py = 'python'; } catch {}
  }
  try {
    const cmd = dayArg
      ? `${py} scripts/batch_generate_all.py ${dayArg}`
      : `${py} scripts/batch_generate_all.py`;
    const result = execSync(cmd, {
      timeout: 1800000,
      env: { ...process.env },
      cwd: require('path').resolve(__dirname, '../..')
    });
    await bot.sendMessage(msg.chat.id, `✅ Motion card generation complete!\n${result.toString().split('\n').slice(-3).join('\n')}`);

    // ── 샘플 카드 미리보기: Day N 첫 번째 단어 MP4 전송 ──
    try {
      const sampleDay = dayArg ? Number(dayArg) : 1;
      const { data: sampleWord, error: sampleErr } = await supabase
        .from('words')
        .select('korean, meaning_khmer, video_url, sort_order')
        .eq('day_number', sampleDay)
        .order('sort_order', { ascending: true })
        .limit(1)
        .single();

      if (sampleErr || !sampleWord) {
        await bot.sendMessage(msg.chat.id, `⚠️ 샘플 미리보기 불러오기 실패: ${sampleErr?.message || 'no word found'}`);
      } else if (!sampleWord.video_url) {
        await bot.sendMessage(msg.chat.id, `⚠️ Day ${sampleDay} 첫 번째 단어(${sampleWord.korean})에 video_url이 없습니다.`);
      } else {
        await bot.sendVideo(msg.chat.id, sampleWord.video_url, {
          caption: `📱 샘플 카드 미리보기 - Day ${sampleDay} 첫 번째 단어\n${sampleWord.korean} (${sampleWord.meaning_khmer})`
        });
      }
    } catch (previewErr) {
      await bot.sendMessage(msg.chat.id, `⚠️ 샘플 미리보기 전송 오류: ${previewErr.message}`);
    }
  } catch (err) {
    await bot.sendMessage(msg.chat.id, `❌ Error: ${err.stderr?.toString()?.slice(-200) || err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Gemini 이미지 생성 + 어드민 검수 플로우
// ═══════════════════════════════════════════════════════════════════
//
// /generate_images N      Day N의 단어 전체에 대해 Gemini로 이미지 생성
//                         (이미 image_url이 있는 단어는 자동으로 건너뜀)
// /approve_images N       Day N 검수 승인 → Day N+1 자동 시작
// /redo_image N 단어명    Day N의 특정 단어만 재생성
// /image_status           전체 Day별 진행 현황
//
// 통신: Python 배치 스크립트가 stdout에 JSON 라인 이벤트를 출력하면
//       Node.js가 line-by-line으로 파싱해서 텔레그램에 sendPhoto/sendMessage 한다.
// 상태 보관: in-memory Map (봇 재시작 시 초기화). "approved"만 메모리에 두고,
//           나머지 진행률은 매 호출 때 Supabase에서 계산한다.
//
const imageReviewState = new Map();
// dayNumber -> { chatId, status, total, ok, skipped, failed }

function detectPython() {
  const { execSync } = require('child_process');
  try { execSync('python3 --version', { stdio: 'ignore' }); return 'python3'; } catch {}
  try { execSync('python --version', { stdio: 'ignore' }); return 'python'; } catch {}
  return 'python3';
}

// 어드민 그룹 chat_id (env var로 별도 지정 가능). 미설정 시 명령어 발행 채팅으로 폴백.
function adminChatId(fallbackChatId) {
  const envId = process.env.ADMIN_CHAT_ID;
  if (envId && /^-?\d+$/.test(envId.trim())) return Number(envId.trim());
  return fallbackChatId;
}

async function handleImageEvent(bot, chatId, day, ev) {
  const state = imageReviewState.get(day) || {
    chatId, status: 'generating', total: 0, ok: 0, skipped: 0, failed: 0
  };

  switch (ev.type) {
    case 'config_error':
      await bot.sendMessage(chatId, `❌ Config error: ${ev.message}`);
      return;

    case 'no_words':
      await bot.sendMessage(chatId, `⚠️ Day ${day}에 단어가 없습니다.`);
      return;

    case 'start':
      state.total = ev.total || 0;
      state.ok = 0;
      state.skipped = 0;
      state.failed = 0;
      state.status = 'generating';
      imageReviewState.set(day, state);
      await bot.sendMessage(
        chatId,
        `📋 Day ${day}: 총 ${state.total}개 단어 (생성 대상 ${ev.to_generate || state.total}개)`
      );
      return;

    case 'img': {
      state.ok = (state.ok || 0) + 1;
      imageReviewState.set(day, state);
      const caption = `[${ev.sort}/${ev.total}] ${ev.korean} (${ev.meaning_khmer || ''})`;
      try {
        await bot.sendPhoto(chatId, ev.url, { caption });
      } catch (e) {
        await bot.sendMessage(chatId, `${caption}\n${ev.url}\n(이미지 전송 실패: ${e.message})`);
      }
      return;
    }

    case 'skip':
      state.skipped = (state.skipped || 0) + 1;
      imageReviewState.set(day, state);
      // 너무 시끄러우니 개별 알림은 생략 (요약에 포함됨)
      return;

    case 'fail':
      state.failed = (state.failed || 0) + 1;
      imageReviewState.set(day, state);
      await bot.sendMessage(
        chatId,
        `⚠️ [${ev.sort}/${ev.total}] ${ev.korean}: ${ev.reason}`.slice(0, 400)
      );
      return;

    case 'done':
      state.ok = ev.ok || 0;
      state.skipped = ev.skipped || 0;
      state.failed = ev.failed || 0;
      state.total = ev.total || state.total;
      imageReviewState.set(day, state);
      return;
  }
}

function spawnImageBatch(bot, chatId, day, koreanFilter) {
  const { spawn } = require('child_process');
  const py = detectPython();
  const cwd = require('path').resolve(__dirname, '../..');

  const args = ['scripts/batch_generate_images.py', String(day)];
  if (koreanFilter) args.push(koreanFilter);

  const child = spawn(py, args, { cwd, env: { ...process.env } });

  let buffer = '';
  child.stdout.on('data', async (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let ev;
      try {
        ev = JSON.parse(trimmed);
      } catch {
        // 일반 stderr 누락이나 비-JSON 출력은 로그로만 남김
        console.log(`[gen_images day=${day}] ${trimmed}`);
        continue;
      }
      try {
        await handleImageEvent(bot, chatId, day, ev);
      } catch (err) {
        console.error('image event handler error:', err.message);
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    console.error(`[gen_images day=${day}]`, chunk.toString());
  });

  return new Promise((resolve) => {
    child.on('close', (code) => resolve(code));
  });
}

// ── /generate_images N ──
async function handleGenerateImages(bot, msg, dayArg) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }
  if (!dayArg) {
    return bot.sendMessage(msg.chat.id, '사용법: /generate_images <day>');
  }
  const day = parseInt(dayArg, 10);
  if (isNaN(day) || day < 1) {
    return bot.sendMessage(msg.chat.id, '❌ Day는 양의 정수여야 합니다.');
  }

  const chatId = adminChatId(msg.chat.id);
  imageReviewState.set(day, {
    chatId, status: 'generating', total: 0, ok: 0, skipped: 0, failed: 0
  });

  await bot.sendMessage(chatId, `🎨 Day ${day} 이미지 생성 시작...`);

  const code = await spawnImageBatch(bot, chatId, day, null);
  const state = imageReviewState.get(day) || { ok: 0, skipped: 0, failed: 0, total: 0 };

  if (code === 0) {
    state.status = 'awaiting_review';
    imageReviewState.set(day, state);
    const summary =
      `✅ Day ${day} 이미지 생성 완료 (${state.ok + state.skipped}/${state.total})\n` +
      `   생성: ${state.ok} · 건너뜀: ${state.skipped} · 실패: ${state.failed}\n\n` +
      `승인: /approve_images ${day}\n` +
      `재생성: /redo_image ${day} 단어명`;
    await bot.sendMessage(chatId, summary);
  } else {
    state.status = 'error';
    imageReviewState.set(day, state);
    await bot.sendMessage(chatId, `❌ Day ${day} 생성 실패 (exit ${code})`);
  }
}

// ── /approve_images N ──
async function handleApproveImages(bot, msg, dayArg) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }
  if (!dayArg) {
    return bot.sendMessage(msg.chat.id, '사용법: /approve_images <day>');
  }
  const day = parseInt(dayArg, 10);
  if (isNaN(day) || day < 1) {
    return bot.sendMessage(msg.chat.id, '❌ Day는 양의 정수여야 합니다.');
  }

  const chatId = adminChatId(msg.chat.id);
  const state = imageReviewState.get(day) || {
    chatId, status: 'approved', total: 0, ok: 0, skipped: 0, failed: 0
  };
  state.status = 'approved';
  imageReviewState.set(day, state);

  await bot.sendMessage(chatId, `✅ Day ${day} 승인 완료\n→ Day ${day + 1} 자동 시작`);
  return handleGenerateImages(bot, msg, String(day + 1));
}

// ── /redo_image N 단어명 ──
async function handleRedoImage(bot, msg, dayArg, koreanWord) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }
  if (!dayArg || !koreanWord) {
    return bot.sendMessage(msg.chat.id, '사용법: /redo_image <day> <단어>');
  }
  const day = parseInt(dayArg, 10);
  if (isNaN(day) || day < 1) {
    return bot.sendMessage(msg.chat.id, '❌ Day는 양의 정수여야 합니다.');
  }

  const chatId = adminChatId(msg.chat.id);
  await bot.sendMessage(chatId, `🔄 Day ${day} "${koreanWord}" 재생성 중...`);

  const code = await spawnImageBatch(bot, chatId, day, koreanWord);
  if (code === 0) {
    await bot.sendMessage(chatId, `✅ "${koreanWord}" 재생성 완료`);
  } else {
    await bot.sendMessage(chatId, `❌ 재생성 실패 (exit ${code})`);
  }
}

// ── /image_status ──
async function handleImageStatus(bot, msg) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const { data, error } = await supabase
    .from('words')
    .select('day_number, image_url');

  if (error || !data) {
    return bot.sendMessage(msg.chat.id, `❌ 조회 실패: ${error?.message || 'no data'}`);
  }

  const byDay = new Map();
  for (const w of data) {
    const d = w.day_number;
    if (!byDay.has(d)) byDay.set(d, { total: 0, withImg: 0 });
    const stats = byDay.get(d);
    stats.total++;
    if (w.image_url && w.image_url !== 'skip') stats.withImg++;
  }

  const sortedDays = [...byDay.keys()].sort((a, b) => a - b);
  let report = '📊 이미지 진행 현황\n';
  for (const d of sortedDays) {
    const { total, withImg } = byDay.get(d);
    let mark = '⬜';
    if (total > 0 && withImg === total) mark = '✅';
    else if (withImg > 0) mark = '🟡';

    const state = imageReviewState.get(d);
    let suffix = '';
    if (state?.status === 'approved') suffix = ' [승인됨]';
    else if (state?.status === 'awaiting_review') suffix = ' [검수대기]';
    else if (state?.status === 'generating') suffix = ' [생성중]';
    else if (state?.status === 'error') suffix = ' [에러]';

    report += `${mark} Day ${d}: ${withImg}/${total}${suffix}\n`;
  }

  await bot.sendMessage(msg.chat.id, report);
}

module.exports = {
  handleAdminCommand,
  handleBroadcast,
  handleGenerateCards,
  handleGenerateTTS,
  handleGenerateAll,
  handleAdminMessage,
  handleStudentAsk,
  handleReply,
  handleStats,
  handleGenerateMotion,
  handleGenerateImages,
  handleApproveImages,
  handleRedoImage,
  handleImageStatus,
  isAdmin,
  ADMIN_IDS
};
