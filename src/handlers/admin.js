const { supabase } = require('../config/supabase');

const ADMIN_IDS = process.env.ADMIN_IDS?.split(',').map(Number) || [];

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
    `🎨 Cards ready: ${cardsReady} / 1207\n` +
    `🔊 TTS ready: ${ttsReady} / 1207\n\n` +
    `Commands:\n` +
    `/run_pipeline - Full pipeline (illustrations+TTS+motion)\n` +
    `/pipeline_status - Pipeline progress\n` +
    `/notify_upgrade - Send upgrade notice to students\n` +
    `/broadcast [msg] - Send to all students\n` +
    `/reply [id] [msg] - Reply to a student\n` +
    `/generate_images [day] - Generate illustrations\n` +
    `/image_status - Image generation status\n` +
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
    `↩️ Reply: /reply ${studentId} [message]`
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
    .map(([day, count]) => `  Day ${day}: ${count}`)
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

// ── /generate_motion [day] — 모션 카드 비디오 생성 (non-blocking spawn) ──
async function handleGenerateMotion(bot, msg, dayArg) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const label = dayArg ? `Day ${dayArg}` : 'All 35 days';
  await bot.sendMessage(msg.chat.id, `🎬 Starting motion card generation: ${label}...\n(Running in background — bot stays responsive)`);

  const { spawn, execSync } = require('child_process');
  // python3 또는 python 자동 탐지
  let py = 'python3';
  try { execSync('python3 --version', { stdio: 'ignore' }); } catch {
    try { execSync('python --version', { stdio: 'ignore' }); py = 'python'; } catch {}
  }

  const args = ['scripts/batch_generate_all.py'];
  if (dayArg) args.push(String(dayArg));

  const cwd = require('path').resolve(__dirname, '../..');
  const child = spawn(py, args, { cwd, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  let lastProgress = 0;

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    console.log('[motion-card stdout]', text);
    stdout += text;
    // 진행률 10단어마다 텔레그램에 보고
    const lines = stdout.split('\n');
    const progressLines = lines.filter(l => l.includes('Progress:'));
    if (progressLines.length > lastProgress) {
      lastProgress = progressLines.length;
      const latest = progressLines[progressLines.length - 1].trim();
      bot.sendMessage(msg.chat.id, `🎬 ${latest}`).catch(() => {});
    }
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    console.error('[motion-card stderr]', text);
    stderr += text;
  });

  child.on('close', async (code) => {
    if (code === 0) {
      const lastLines = stdout.trim().split('\n').slice(-3).join('\n');
      await bot.sendMessage(msg.chat.id, `✅ Motion card generation complete!\n${lastLines}`);

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
          await bot.sendMessage(msg.chat.id, `⚠️ Failed to load sample preview: ${sampleErr?.message || 'no word found'}`);
        } else if (!sampleWord.video_url) {
          await bot.sendMessage(msg.chat.id, `⚠️ Day ${sampleDay} first word (${sampleWord.korean}) has no video_url.`);
        } else {
          await bot.sendVideo(msg.chat.id, sampleWord.video_url, {
            caption: `📱 Sample preview - Day ${sampleDay} first word\n${sampleWord.korean} (${sampleWord.meaning_khmer})`
          });
        }
      } catch (previewErr) {
        await bot.sendMessage(msg.chat.id, `⚠️ Sample preview send error: ${previewErr.message}`);
      }
    } else {
      const errTail = stderr.slice(-300) || stdout.slice(-300) || `exit code ${code}`;
      await bot.sendMessage(msg.chat.id, `❌ Motion card generation failed:\n${errTail}`);
    }
  });

  child.on('error', async (err) => {
    await bot.sendMessage(msg.chat.id, `❌ Failed to start motion card process: ${err.message}`);
  });
}

// ── /generate_motion_all [--force] — Day 1~35 전체 모션카드 순차 생성 ──
async function handleGenerateMotionAll(bot, msg, forceFlag) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const force = forceFlag === '--force';
  await bot.sendMessage(msg.chat.id,
    `🎬 Starting motion cards for Day 1~35${force ? ' (--force: regenerating all)' : ' (skipping days with existing MP4s)'}...\n(Running in background — bot stays responsive)`
  );

  const { spawn, execSync } = require('child_process');
  const path = require('path');
  let py = 'python3';
  try { execSync('python3 --version', { stdio: 'ignore' }); } catch {
    try { execSync('python --version', { stdio: 'ignore' }); py = 'python'; } catch {}
  }
  const cwd = path.resolve(__dirname, '../..');

  let totalDone = 0;
  let totalErrors = 0;
  let totalSkipped = 0;

  for (let day = 1; day <= 35; day++) {
    // Check if all words in this day already have video_url
    if (!force) {
      const { data: words, error: dbErr } = await supabase
        .from('words')
        .select('id, video_url')
        .eq('day_number', day);

      if (dbErr) {
        await bot.sendMessage(msg.chat.id, `⚠️ Day ${day}: DB error checking existing videos — generating anyway.`);
      } else if (words && words.length > 0 && words.every(w => w.video_url)) {
        totalSkipped++;
        continue;
      }
    }

    // Spawn batch_generate_all.py for this day
    const result = await new Promise((resolve) => {
      const child = spawn(py, ['scripts/batch_generate_all.py', String(day)], {
        cwd, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        console.log('[motion-all stdout]', text);
        stdout += text;
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        console.error('[motion-all stderr]', text);
        stderr += text;
      });

      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.on('error', (err) => resolve({ code: -1, stdout: '', stderr: err.message }));
    });

    if (result.code === 0) {
      // Parse success/error counts from output
      const doneMatch = result.stdout.match(/DONE:\s*(\d+)\/\d+\s*success,\s*(\d+)\s*errors/);
      const dayDone = doneMatch ? parseInt(doneMatch[1]) : 0;
      const dayErrors = doneMatch ? parseInt(doneMatch[2]) : 0;
      totalDone += dayDone;
      totalErrors += dayErrors;
      await bot.sendMessage(msg.chat.id,
        `✅ Day ${day}/35 complete — ${dayDone} cards generated${dayErrors > 0 ? `, ${dayErrors} errors` : ''} (skipped: ${totalSkipped})`
      );
    } else {
      totalErrors++;
      const errTail = result.stderr.slice(-200) || result.stdout.slice(-200) || `exit code ${result.code}`;
      await bot.sendMessage(msg.chat.id, `❌ Day ${day}/35 failed: ${errTail}`);
    }
  }

  await bot.sendMessage(msg.chat.id,
    `🏁 Motion card generation complete!\n✅ ${totalDone} cards generated\n⏭️ ${totalSkipped} days skipped (already had MP4)\n❌ ${totalErrors} errors`
  );
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

// 텔레그램 그룹 rate-limit 회피용 사진 전송 간격 (ms)
const IMAGE_SEND_DELAY_MS = 500;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 사진 한 장을 어드민 채팅에 전송 + 사이 간격 추가
async function sendImagePreview(bot, chatId, ev, tag) {
  const captionTag = tag ? ` ${tag}` : '';
  const caption = `[${ev.sort}/${ev.total}]${captionTag} ${ev.korean} (${ev.meaning_khmer || ''})`;
  if (!ev.url) {
    await bot.sendMessage(chatId, `${caption}\n(no image_url)`);
    await sleep(IMAGE_SEND_DELAY_MS);
    return;
  }
  try {
    await bot.sendPhoto(chatId, ev.url, { caption });
  } catch (e) {
    await bot.sendMessage(chatId, `${caption}\n${ev.url}\n(photo send failed: ${e.message})`);
  }
  // 텔레그램 그룹 rate-limit 회피
  await sleep(IMAGE_SEND_DELAY_MS);
}

async function handleImageEvent(bot, chatId, day, ev, opts = {}) {
  const silent = !!opts.silent;
  const state = imageReviewState.get(day) || {
    chatId, status: 'generating', total: 0, ok: 0, skipped: 0, failed: 0
  };

  switch (ev.type) {
    case 'config_error':
      await bot.sendMessage(chatId, `❌ Config error: ${ev.message}`);
      return;

    case 'no_words':
      if (!silent) await bot.sendMessage(chatId, `⚠️ No words found for Day ${day}.`);
      return;

    case 'start':
      state.total = ev.total || 0;
      state.ok = 0;
      state.skipped = 0;
      state.failed = 0;
      state.status = 'generating';
      imageReviewState.set(day, state);
      if (!silent) {
        await bot.sendMessage(
          chatId,
          `📋 Day ${day}: ${state.total} words total (${ev.to_generate || state.total} to generate)`
        );
      }
      return;

    case 'img': {
      state.ok = (state.ok || 0) + 1;
      imageReviewState.set(day, state);
      if (!silent) await sendImagePreview(bot, chatId, ev, '🆕');
      return;
    }

    case 'skip': {
      state.skipped = (state.skipped || 0) + 1;
      imageReviewState.set(day, state);
      // 기존 image_url을 미리보기로 전송 (어드민이 이전 결과를 함께 검수할 수 있도록)
      if (!silent) await sendImagePreview(bot, chatId, ev, '♻️');
      return;
    }

    case 'fail':
      state.failed = (state.failed || 0) + 1;
      imageReviewState.set(day, state);
      if (!silent) {
        await bot.sendMessage(
          chatId,
          `⚠️ [${ev.sort}/${ev.total}] ${ev.korean}: ${ev.reason}`.slice(0, 400)
        );
      }
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

function spawnImageBatch(bot, chatId, day, koreanFilter, opts = {}) {
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
        await handleImageEvent(bot, chatId, day, ev, opts);
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
    return bot.sendMessage(msg.chat.id, 'Usage: /generate_images <day>');
  }
  const day = parseInt(dayArg, 10);
  if (isNaN(day) || day < 1) {
    return bot.sendMessage(msg.chat.id, '❌ Day must be a positive integer.');
  }

  const chatId = adminChatId(msg.chat.id);
  imageReviewState.set(day, {
    chatId, status: 'generating', total: 0, ok: 0, skipped: 0, failed: 0
  });

  await bot.sendMessage(chatId, `🎨 Starting image generation for Day ${day}...`);

  const code = await spawnImageBatch(bot, chatId, day, null);
  const state = imageReviewState.get(day) || { ok: 0, skipped: 0, failed: 0, total: 0 };

  if (code === 0) {
    state.status = 'awaiting_review';
    imageReviewState.set(day, state);
    const summary =
      `✅ Day ${day} image generation complete (${state.ok + state.skipped}/${state.total})\n` +
      `   Generated: ${state.ok} · Skipped: ${state.skipped} · Failed: ${state.failed}\n\n` +
      `Approve: /approve_images ${day}\n` +
      `Regenerate: /redo_image ${day} <word>`;
    await bot.sendMessage(chatId, summary);
  } else {
    state.status = 'error';
    imageReviewState.set(day, state);
    await bot.sendMessage(chatId, `❌ Day ${day} generation failed (exit ${code})`);
  }
}

// ── /approve_images N ──
async function handleApproveImages(bot, msg, dayArg) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }
  if (!dayArg) {
    return bot.sendMessage(msg.chat.id, 'Usage: /approve_images <day>');
  }
  const day = parseInt(dayArg, 10);
  if (isNaN(day) || day < 1) {
    return bot.sendMessage(msg.chat.id, '❌ Day must be a positive integer.');
  }

  const chatId = adminChatId(msg.chat.id);
  const state = imageReviewState.get(day) || {
    chatId, status: 'approved', total: 0, ok: 0, skipped: 0, failed: 0
  };
  state.status = 'approved';
  imageReviewState.set(day, state);

  await bot.sendMessage(chatId, `✅ Day ${day} approved\n→ Auto-starting Day ${day + 1}`);
  return handleGenerateImages(bot, msg, String(day + 1));
}

// ── /redo_image N 단어명 ──
async function handleRedoImage(bot, msg, dayArg, koreanWord) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }
  if (!dayArg || !koreanWord) {
    return bot.sendMessage(msg.chat.id, 'Usage: /redo_image <day> <word>');
  }
  const day = parseInt(dayArg, 10);
  if (isNaN(day) || day < 1) {
    return bot.sendMessage(msg.chat.id, '❌ Day must be a positive integer.');
  }

  const chatId = adminChatId(msg.chat.id);
  await bot.sendMessage(chatId, `🔄 Regenerating Day ${day} "${koreanWord}"...`);

  const code = await spawnImageBatch(bot, chatId, day, koreanWord);
  if (code === 0) {
    await bot.sendMessage(chatId, `✅ "${koreanWord}" regenerated`);
  } else {
    await bot.sendMessage(chatId, `❌ Regeneration failed (exit ${code})`);
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
    return bot.sendMessage(msg.chat.id, `❌ Query failed: ${error?.message || 'no data'}`);
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
  let report = '📊 Image generation status\n';
  for (const d of sortedDays) {
    const { total, withImg } = byDay.get(d);
    let mark = '⬜';
    if (total > 0 && withImg === total) mark = '✅';
    else if (withImg > 0) mark = '🟡';

    const state = imageReviewState.get(d);
    let suffix = '';
    if (state?.status === 'approved') suffix = ' [approved]';
    else if (state?.status === 'awaiting_review') suffix = ' [awaiting review]';
    else if (state?.status === 'generating') suffix = ' [generating]';
    else if (state?.status === 'error') suffix = ' [error]';

    report += `${mark} Day ${d}: ${withImg}/${total}${suffix}\n`;
  }

  await bot.sendMessage(msg.chat.id, report);
}

// ── /generate_images_all — Day 1~35 자동 연속 생성 ──
//
// 개별 이미지 미리보기는 silent 모드로 생략하고, 각 Day가 끝날 때마다
// 한 줄짜리 요약만 어드민에 전송한다. Day 사이에 5초 대기를 두고,
// 한 Day가 실패해도 다음 Day로 계속 진행한다.
//
const ALL_DAYS_RANGE = { start: 1, end: 35 };
const ALL_DAYS_INTER_DELAY_MS = 5000;

async function handleGenerateImagesAll(bot, msg) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const chatId = adminChatId(msg.chat.id);
  await bot.sendMessage(
    chatId,
    `🚀 Starting bulk image generation for Day ${ALL_DAYS_RANGE.start}~${ALL_DAYS_RANGE.end}\n` +
    `Per-image previews are suppressed; you will get one summary line per Day.\n` +
    `${ALL_DAYS_INTER_DELAY_MS / 1000}s pause between days; failures do not stop the run.`
  );

  let totalOk = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let daysWithError = 0;

  for (let day = ALL_DAYS_RANGE.start; day <= ALL_DAYS_RANGE.end; day++) {
    imageReviewState.set(day, {
      chatId, status: 'generating', total: 0, ok: 0, skipped: 0, failed: 0,
    });

    let exitCode;
    try {
      exitCode = await spawnImageBatch(bot, chatId, day, null, { silent: true });
    } catch (err) {
      exitCode = -1;
      console.error(`/generate_images_all day=${day} spawn error:`, err.message);
    }

    const state = imageReviewState.get(day) || { ok: 0, skipped: 0, failed: 0, total: 0 };
    totalOk += state.ok || 0;
    totalSkipped += state.skipped || 0;
    totalFailed += state.failed || 0;

    if (exitCode === 0) {
      state.status = 'awaiting_review';
      imageReviewState.set(day, state);
      await bot.sendMessage(
        chatId,
        `✅ Day ${day} complete (generated: ${state.ok} / skipped: ${state.skipped} / failed: ${state.failed})`
      );
    } else {
      state.status = 'error';
      imageReviewState.set(day, state);
      daysWithError++;
      await bot.sendMessage(
        chatId,
        `❌ Day ${day} batch exited with code ${exitCode} ` +
        `(generated: ${state.ok} / skipped: ${state.skipped} / failed: ${state.failed}). ` +
        `Continuing to next day.`
      );
    }

    // Day 사이 5초 대기 (마지막 Day 후에는 생략)
    if (day < ALL_DAYS_RANGE.end) {
      await sleep(ALL_DAYS_INTER_DELAY_MS);
    }
  }

  await bot.sendMessage(
    chatId,
    `🎉 Bulk run finished — Days ${ALL_DAYS_RANGE.start}~${ALL_DAYS_RANGE.end}\n` +
    `Total generated: ${totalOk}\n` +
    `Total skipped:   ${totalSkipped}\n` +
    `Total failed:    ${totalFailed}\n` +
    `Days with errors: ${daysWithError}`
  );
}

// ── /trigger_review — Sunday review 수동 실행 ──
async function handleTriggerReview(bot, msg) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }
  await bot.sendMessage(msg.chat.id, '🔄 Manually triggering Sunday review for all active students...');
  try {
    const { sendSundayReview } = require('../services/review');
    await sendSundayReview(bot);
    await bot.sendMessage(msg.chat.id, '✅ Sunday review triggered successfully.');
  } catch (err) {
    await bot.sendMessage(msg.chat.id, `❌ Sunday review failed: ${err.message}`);
  }
}

// ── /run_pipeline — 전체 파이프라인 실행 (일러스트→TTS→모션카드) ──
const pipelineState = { running: false, stage: '', progress: '' };

function spawnPipeline(bot, chatId, scriptName, label) {
  const { spawn } = require('child_process');
  const py = detectPython();
  const cwd = require('path').resolve(__dirname, '../..');

  return new Promise((resolve) => {
    const child = spawn(py, [`scripts/${scriptName}`], { cwd, env: { ...process.env } });
    let buffer = '';
    let lastOk = 0, lastFailed = 0, lastTotal = 0;

    child.stdout.on('data', async (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let ev;
        try { ev = JSON.parse(trimmed); } catch { continue; }

        if (ev.type === 'start') {
          lastTotal = ev.total || 0;
          pipelineState.progress = `0/${lastTotal}`;
        }
        if (ev.type === 'progress' || ev.type === 'done') {
          lastOk = ev.ok || 0;
          lastFailed = ev.failed || 0;
          pipelineState.progress = `${ev.current || lastOk + lastFailed}/${lastTotal} (ok:${lastOk} fail:${lastFailed})`;
        }
        // Report every 50
        if (ev.type === 'progress') {
          try {
            await bot.sendMessage(chatId,
              `📊 ${label}: ${ev.current}/${ev.total} (OK: ${ev.ok}, Failed: ${ev.failed})`
            );
          } catch {}
        }
        if (ev.type === 'done') {
          try {
            await bot.sendMessage(chatId,
              `✅ ${label} complete!\nOK: ${ev.ok} / Failed: ${ev.failed} / Total: ${ev.total}`
            );
          } catch {}
        }
        if (ev.type === 'config_error') {
          try {
            await bot.sendMessage(chatId, `❌ ${label} config error: ${ev.message}`);
          } catch {}
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      console.error(`[${scriptName}]`, chunk.toString().slice(0, 300));
    });

    child.on('close', (code) => resolve(code));
  });
}

async function handleRunPipeline(bot, msg) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }
  if (pipelineState.running) {
    return bot.sendMessage(msg.chat.id, `⚠️ Pipeline already running: ${pipelineState.stage}\n${pipelineState.progress}`);
  }

  const chatId = adminChatId(msg.chat.id);
  pipelineState.running = true;

  await bot.sendMessage(chatId,
    `🚀 Starting full pipeline for 1,207 words\n` +
    `Stage 1: Illustrations (Gemini)\n` +
    `Stage 2: TTS (OpenAI)\n` +
    `Stage 3: Motion Cards (MP4)\n\n` +
    `This will take a while. Progress reports every 50 words.`
  );

  const stages = [
    { script: 'pipeline_generate_all.py', label: '🎨 Stage 1: Illustrations' },
    { script: 'pipeline_generate_tts.py', label: '🔊 Stage 2: TTS' },
    { script: 'pipeline_generate_motion.py', label: '🎬 Stage 3: Motion Cards' },
  ];

  for (const stage of stages) {
    pipelineState.stage = stage.label;
    pipelineState.progress = 'starting...';
    await bot.sendMessage(chatId, `\n${stage.label} — Starting...`);

    const code = await spawnPipeline(bot, chatId, stage.script, stage.label);
    if (code !== 0) {
      await bot.sendMessage(chatId, `❌ ${stage.label} failed with exit code ${code}. Continuing...`);
    }

    // 5s pause between stages
    await new Promise(r => setTimeout(r, 5000));
  }

  pipelineState.running = false;
  pipelineState.stage = '';
  pipelineState.progress = '';

  await bot.sendMessage(chatId,
    `🎉 Full pipeline complete!\n` +
    `1,207 words: Illustrations + TTS + Motion Cards\n` +
    `Use /pipeline_status or /image_status to verify.`
  );
}

// ── /pipeline_status ──
async function handlePipelineStatus(bot, msg) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const { data, error } = await supabase
    .from('words')
    .select('day_number, image_url, audio_url, video_url');

  if (error || !data) {
    return bot.sendMessage(msg.chat.id, `❌ Query failed: ${error?.message || 'no data'}`);
  }

  const total = data.length;
  const withImg = data.filter(w => w.image_url).length;
  const withAudio = data.filter(w => w.audio_url).length;
  const withVideo = data.filter(w => w.video_url).length;

  let status = pipelineState.running
    ? `🔄 Pipeline running: ${pipelineState.stage}\n   ${pipelineState.progress}\n\n`
    : '';

  status +=
    `📊 Pipeline Status (${total} words)\n` +
    `──────────────────\n` +
    `🎨 Illustrations: ${withImg}/${total}\n` +
    `🔊 TTS Audio: ${withAudio}/${total}\n` +
    `🎬 Motion Cards: ${withVideo}/${total}\n` +
    `──────────────────\n` +
    `${withImg === total && withAudio === total && withVideo === total ? '✅ All content ready!' : '⏳ Content generation in progress'}`;

  await bot.sendMessage(msg.chat.id, status);
}

// ── /notify_upgrade — 학생에게 업그레이드 알림 ──
async function handleNotifyUpgrade(bot, msg) {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
  }

  const { data: students } = await supabase
    .from('students').select('id').eq('is_active', true);

  if (!students || students.length === 0) {
    return bot.sendMessage(msg.chat.id, '⚠️ No active students found.');
  }

  const message =
    `🎉 VERI-K បានអាប់ដេតថ្មី!\n\n` +
    `📚 ពាក្យសព្ទបានកើនពី ៧១៩ ដល់ ១,២០៧ ពាក្យ!\n` +
    `🎨 រូបភាពថ្មីៗ + 🔊 សំឡេងថ្មីៗ + 🎬 វីដេអូថ្មីៗ\n\n` +
    `💪 ព្រឹកស្អែកចាប់ផ្តើមរៀនពាក្យថ្មីៗ!\n` +
    `화이팅! 💪`;

  let sent = 0, failed = 0;
  for (const student of students) {
    try {
      await bot.sendMessage(student.id, message);
      sent++;
    } catch {
      failed++;
    }
  }

  await bot.sendMessage(msg.chat.id,
    `✅ Upgrade notification sent\nSent: ${sent} / Failed: ${failed}`
  );
}

module.exports = {
  handleAdminCommand,
  handleBroadcast,
  handleGenerateCards,
  handleGenerateTTS,
  handleGenerateAll,
  handleStudentAsk,
  handleReply,
  handleStats,
  handleGenerateMotion,
  handleGenerateMotionAll,
  handleGenerateImages,
  handleGenerateImagesAll,
  handleApproveImages,
  handleRedoImage,
  handleImageStatus,
  handleTriggerReview,
  handleRunPipeline,
  handlePipelineStatus,
  handleNotifyUpgrade,
  isAdmin,
  ADMIN_IDS
};
