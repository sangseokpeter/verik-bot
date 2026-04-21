// ── Unified admin notification ──
// Routes auto notifications to every admin surface at once:
//   • ADMIN_IDS   : comma-separated personal chat_ids (e.g. Peter, Socheata)
//   • ADMIN_GROUP_CHAT_ID : single group chat_id (e.g. -1002383763959)
//
// Student-facing messages MUST NOT go through here — this is admin-only.

const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .map(Number)
  .filter(n => Number.isFinite(n) && n !== 0);

const ADMIN_GROUP_CHAT_ID = (() => {
  const raw = (process.env.ADMIN_GROUP_CHAT_ID || '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
})();

function adminRecipients() {
  const set = new Set();
  for (const id of ADMIN_IDS) set.add(id);
  if (ADMIN_GROUP_CHAT_ID !== null) set.add(ADMIN_GROUP_CHAT_ID);
  return [...set];
}

async function notifyAdmins(bot, message, options = {}) {
  const recipients = adminRecipients();
  if (recipients.length === 0) {
    console.warn('notifyAdmins: no recipients configured (ADMIN_IDS + ADMIN_GROUP_CHAT_ID both empty)');
    return { sent: 0, failed: 0 };
  }
  let sent = 0, failed = 0;
  for (const chatId of recipients) {
    try {
      await bot.sendMessage(chatId, message, options);
      sent++;
    } catch (err) {
      failed++;
      console.error(`notifyAdmins: send to ${chatId} failed:`, err.message);
    }
  }
  return { sent, failed };
}

async function notifyAdminsPhoto(bot, photo, options = {}) {
  const recipients = adminRecipients();
  if (recipients.length === 0) {
    console.warn('notifyAdminsPhoto: no recipients configured');
    return { sent: 0, failed: 0 };
  }
  let sent = 0, failed = 0;
  for (const chatId of recipients) {
    try {
      await bot.sendPhoto(chatId, photo, options);
      sent++;
    } catch (err) {
      failed++;
      console.error(`notifyAdminsPhoto: send to ${chatId} failed:`, err.message);
    }
  }
  return { sent, failed };
}

module.exports = {
  notifyAdmins,
  notifyAdminsPhoto,
  adminRecipients,
  ADMIN_IDS,
  ADMIN_GROUP_CHAT_ID
};
