const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
const { supabase } = require('../config/supabase');
const { notifyAdmins } = require('../services/notifier');

// Constant-time token compare. Returns false (no throw) for any shape mismatch.
function tokenMatches(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Dedicated log channel if set, else fan out to all admin surfaces.
async function logDashboardAction(bot, text) {
  const raw = (process.env.ADMIN_LOG_CHAT_ID || '').trim();
  const logId = raw ? Number(raw) : null;
  if (logId && Number.isFinite(logId)) {
    try {
      await bot.sendMessage(logId, text);
      return;
    } catch (err) {
      console.error('logDashboardAction: dedicated log failed, falling back:', err.message);
    }
  }
  try { await notifyAdmins(bot, text); } catch (err) {
    console.error('logDashboardAction: notifyAdmins also failed:', err.message);
  }
}

function buildDashboardRouter(bot) {
  const router = express.Router();
  const expectedToken = (process.env.STAFF_DASHBOARD_TOKEN || '').trim();

  if (!expectedToken) {
    console.warn('⚠️ STAFF_DASHBOARD_TOKEN is not set — dashboard routes will always 404.');
  }

  // Token guard: 404 on mismatch for both HTML and API paths.
  function tokenGuard(req, res, next) {
    if (!tokenMatches(req.params.token, expectedToken)) {
      return res.status(404).send('Not Found');
    }
    next();
  }

  // ── Serve dashboard HTML ──
  router.get('/dashboard/:token', tokenGuard, (_req, res) => {
    res.sendFile(path.resolve(__dirname, '..', '..', 'public', 'dashboard.html'));
  });

  // ── Student list with computed status/score/streak ──
  router.get('/api/dashboard/:token/students', tokenGuard, async (_req, res) => {
    try {
      const { data: students, error } = await supabase
        .from('students')
        .select('id, first_name, last_name, username, current_day, last_active, is_active')
        .eq('is_active', true)
        .gt('id', 0)
        .order('current_day', { ascending: false });

      if (error) throw error;

      const ids = students.map(s => s.id);
      if (ids.length === 0) {
        return res.json({
          students: [],
          summary: { weekly_avg: null, last_week_avg: null, weekly_delta: null }
        });
      }

      // Recent quiz scores: last 10 completed sessions per student
      const { data: sessions } = await supabase
        .from('quiz_sessions')
        .select('student_id, total_questions, correct_answers, completed_at')
        .in('student_id', ids)
        .eq('is_completed', true)
        .order('completed_at', { ascending: false })
        .limit(ids.length * 10);

      // Week-over-week: last 7d avg vs 8-14d avg (all students)
      const nowMs = Date.now();
      const weekAgoMs = nowMs - 7 * 24 * 3600 * 1000;
      const twoWeeksAgoMs = nowMs - 14 * 24 * 3600 * 1000;
      let thisTotalQ = 0, thisTotalC = 0, lastTotalQ = 0, lastTotalC = 0;
      for (const s of sessions || []) {
        if (!s.total_questions || !s.completed_at) continue;
        const t = new Date(s.completed_at).getTime();
        if (t >= weekAgoMs) { thisTotalQ += s.total_questions; thisTotalC += s.correct_answers; }
        else if (t >= twoWeeksAgoMs) { lastTotalQ += s.total_questions; lastTotalC += s.correct_answers; }
      }
      const weeklyAvg = thisTotalQ ? Math.round((thisTotalC / thisTotalQ) * 100) : null;
      const lastWeekAvg = lastTotalQ ? Math.round((lastTotalC / lastTotalQ) * 100) : null;
      const weeklyDelta = (weeklyAvg != null && lastWeekAvg != null)
        ? weeklyAvg - lastWeekAvg
        : null;

      const scoresBy = new Map();
      for (const s of sessions || []) {
        if (!s.total_questions) continue;
        const pct = Math.round((s.correct_answers / s.total_questions) * 100);
        const arr = scoresBy.get(s.student_id) || [];
        if (arr.length < 10) arr.push(pct);
        scoresBy.set(s.student_id, arr);
      }

      // Streak: consecutive days ending today (or yesterday) with quiz_completed
      const { data: activity } = await supabase
        .from('daily_activity')
        .select('student_id, activity_date, quiz_completed')
        .in('student_id', ids)
        .eq('quiz_completed', true)
        .order('activity_date', { ascending: false });

      const streakBy = new Map();
      const daysBy = new Map();
      for (const a of activity || []) {
        const set = daysBy.get(a.student_id) || new Set();
        set.add(a.activity_date);
        daysBy.set(a.student_id, set);
      }
      const todayStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().split('T')[0];
      for (const id of ids) {
        const set = daysBy.get(id) || new Set();
        let streak = 0;
        let cursor = new Date(todayStr + 'T00:00:00');
        // allow yesterday-start if today not yet done
        if (!set.has(todayStr)) {
          cursor.setDate(cursor.getDate() - 1);
        }
        while (true) {
          const ds = cursor.toISOString().split('T')[0];
          if (set.has(ds)) { streak++; cursor.setDate(cursor.getDate() - 1); }
          else break;
        }
        streakBy.set(id, streak);
      }

      const now = Date.now();
      const out = students.map(s => {
        const scores = scoresBy.get(s.id) || [];
        const recent = scores.length
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : null;

        const lastActiveMs = s.last_active ? new Date(s.last_active).getTime() : 0;
        const daysSinceActive = lastActiveMs
          ? Math.floor((now - lastActiveMs) / (1000 * 60 * 60 * 24))
          : 999;

        let status = 'active';
        if (daysSinceActive >= 3) status = 'risk';
        else if (daysSinceActive >= 1) status = 'warning';

        const tags = [];
        if (recent !== null && recent >= 80) tags.push('top');
        if (recent !== null && recent < 60) tags.push('low');
        if (status !== 'active') tags.push('attention');

        return {
          id: s.id,
          chat_id: s.id,
          name: [s.first_name, s.last_name].filter(Boolean).join(' ') || 'Unknown',
          telegram_username: s.username || null,
          current_day: s.current_day || 1,
          last_active_at: s.last_active,
          days_since_active: daysSinceActive,
          streak: streakBy.get(s.id) || 0,
          recent_quiz_score: recent,
          status,
          tags
        };
      });

      res.json({
        students: out,
        summary: { weekly_avg: weeklyAvg, last_week_avg: lastWeekAvg, weekly_delta: weeklyDelta }
      });
    } catch (err) {
      console.error('[dashboard] students error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Student detail: last 7 days quizzes, wrong words top 10, progress line ──
  router.get('/api/dashboard/:token/student/:id', tokenGuard, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: 'invalid id' });
      }

      const { data: student } = await supabase
        .from('students')
        .select('id, first_name, last_name, username, current_day, start_date, last_active')
        .eq('id', id)
        .single();

      if (!student) return res.status(404).json({ error: 'student not found' });

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const { data: sessions } = await supabase
        .from('quiz_sessions')
        .select('id, day_number, quiz_type, total_questions, correct_answers, completed_at')
        .eq('student_id', id)
        .eq('is_completed', true)
        .gte('completed_at', sevenDaysAgo)
        .order('completed_at', { ascending: false });

      const { data: wrongRows } = await supabase
        .from('wrong_word_tracker')
        .select('word_id, wrong_count, last_wrong_at, is_mastered, words:word_id(korean, meaning_khmer, day_number)')
        .eq('student_id', id)
        .eq('is_mastered', false)
        .order('wrong_count', { ascending: false })
        .limit(10);

      const wrongTop = (wrongRows || []).map(r => ({
        korean: r.words?.korean || '',
        meaning_khmer: r.words?.meaning_khmer || '',
        day_number: r.words?.day_number || null,
        wrong_count: r.wrong_count,
        last_wrong_at: r.last_wrong_at
      }));

      res.json({
        student: {
          id: student.id,
          chat_id: student.id,
          name: [student.first_name, student.last_name].filter(Boolean).join(' '),
          telegram_username: student.username,
          current_day: student.current_day,
          start_date: student.start_date,
          last_active_at: student.last_active
        },
        recent_quizzes: (sessions || []).map(s => ({
          session_id: s.id,
          day_number: s.day_number,
          quiz_type: s.quiz_type,
          score: s.total_questions ? Math.round((s.correct_answers / s.total_questions) * 100) : null,
          total: s.total_questions,
          correct: s.correct_answers,
          completed_at: s.completed_at
        })),
        wrong_words_top: wrongTop
      });
    } catch (err) {
      console.error('[dashboard] student detail error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Send message to a single student ──
  const sendLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited', detail: 'Max 10 messages per minute.' }
  });

  router.post('/api/dashboard/:token/send_message', tokenGuard, sendLimiter, async (req, res) => {
    try {
      const chatId = Number(req.body?.chat_id);
      const message = String(req.body?.message || '').trim();
      if (!Number.isFinite(chatId) || chatId <= 0) {
        return res.status(400).json({ error: 'invalid chat_id' });
      }
      if (!message) {
        return res.status(400).json({ error: 'empty message' });
      }
      if (message.length > 4000) {
        return res.status(400).json({ error: 'message too long (max 4000)' });
      }

      const { data: student } = await supabase
        .from('students')
        .select('first_name, last_name')
        .eq('id', chatId)
        .single();

      await bot.sendMessage(chatId, message);

      const name = student
        ? [student.first_name, student.last_name].filter(Boolean).join(' ') || 'Unknown'
        : 'Unknown';
      const ts = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
      await logDashboardAction(bot,
        `[Dashboard] ${ts}\n${name}(${chatId})에게 발송:\n${message}`
      );

      res.json({ ok: true });
    } catch (err) {
      console.error('[dashboard] send_message error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Bulk send to students inactive 2+ days ──
  router.post('/api/dashboard/:token/broadcast_inactive', tokenGuard, sendLimiter, async (req, res) => {
    try {
      const message = String(req.body?.message || '').trim();
      if (!message) return res.status(400).json({ error: 'empty message' });
      if (message.length > 4000) return res.status(400).json({ error: 'message too long' });

      const cutoff = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
      const { data: students } = await supabase
        .from('students')
        .select('id, first_name, last_name, last_active')
        .eq('is_active', true)
        .gt('id', 0)
        .or(`last_active.lt.${cutoff},last_active.is.null`);

      let sent = 0, failed = 0;
      const names = [];
      for (const s of students || []) {
        try {
          await bot.sendMessage(s.id, message);
          sent++;
          names.push([s.first_name, s.last_name].filter(Boolean).join(' ') || `${s.id}`);
        } catch (err) {
          failed++;
          console.error(`broadcast_inactive: ${s.id} failed:`, err.message);
        }
      }

      const ts = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
      await logDashboardAction(bot,
        `[Dashboard] ${ts}\n미참여자 일괄 알림 ${sent}명 발송 (실패 ${failed}):\n` +
        `${names.slice(0, 30).join(', ')}${names.length > 30 ? ', ...' : ''}\n\n${message}`
      );

      res.json({ ok: true, sent, failed, targets: sent + failed });
    } catch (err) {
      console.error('[dashboard] broadcast_inactive error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Trigger weekly report to admin Telegram ──
  router.post('/api/dashboard/:token/weekly_report', tokenGuard, async (_req, res) => {
    try {
      const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

      const { count: activeCount } = await supabase
        .from('students').select('id', { count: 'exact', head: true }).eq('is_active', true).gt('id', 0);

      const { data: recent } = await supabase
        .from('quiz_sessions')
        .select('student_id, total_questions, correct_answers')
        .eq('is_completed', true)
        .gte('completed_at', weekAgo);

      const participants = new Set((recent || []).map(r => r.student_id)).size;
      const totalQ = (recent || []).reduce((a, r) => a + (r.total_questions || 0), 0);
      const totalC = (recent || []).reduce((a, r) => a + (r.correct_answers || 0), 0);
      const avgScore = totalQ ? Math.round((totalC / totalQ) * 100) : 0;

      const ts = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
      const report =
        `📊 Weekly report (${ts})\n` +
        `Active students: ${activeCount ?? 0}\n` +
        `Participated (last 7d): ${participants}\n` +
        `Quiz sessions: ${recent?.length || 0}\n` +
        `Avg score: ${avgScore}%`;

      await logDashboardAction(bot, report);
      res.json({ ok: true, report });
    } catch (err) {
      console.error('[dashboard] weekly_report error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { buildDashboardRouter };
