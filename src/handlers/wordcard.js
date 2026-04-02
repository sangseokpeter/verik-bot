// ============================================
// Word Card Navigation Handler
// ============================================
const { supabase } = require('../config/supabase');

/**
 * 단어 카드 전송 — 비디오 우선, 이미지 폴백
 */
async function sendWordCard(bot, chatId, day, index) {
  try {
    const { data: words, error } = await supabase
      .from('words')
      .select('*')
      .eq('day_number', day)
      .order('id');

    if (error || !words || words.length === 0) {
      await bot.sendMessage(chatId, `❌ Day ${day} 단어를 찾을 수 없습니다.`);
      return;
    }

    const total = words.length;

    if (index < 0 || index >= total) {
      await bot.sendMessage(chatId, '카드 범위를 벗어났습니다.');
      return;
    }

    const word = words[index];
    const caption = `${word.korean} (${index + 1}/${total})`;

    // Inline Keyboard: 이전 / 🔊 / 다음
    const buttons = [];

    if (index > 0) {
      buttons.push({
        text: '◀ 이전',
        callback_data: `card_prev_${day}_${index}`
      });
    }

    if (word.audio_url) {
      buttons.push({ text: '🔊', callback_data: `tts_${word.id}` });
    }

    if (index < total - 1) {
      buttons.push({
        text: '다음 ▶',
        callback_data: `card_next_${day}_${index}`
      });
    }

    const replyMarkup = buttons.length > 0 ? {
      inline_keyboard: [buttons]
    } : undefined;

    // 비디오 우선 전송, 없으면 이미지 폴백
    let sent = false;
    if (word.video_url) {
      try {
        await bot.sendVideo(chatId, word.video_url, {
          caption: caption,
          supports_streaming: true,
          reply_markup: replyMarkup
        });
        sent = true;
      } catch (err) {
        console.error(`Video send failed for ${word.korean}, falling back to image`);
      }
    }

    if (!sent) {
      if (!word.image_url) {
        await bot.sendMessage(chatId, `❌ 카드가 없습니다: ${word.korean}`);
        return;
      }
      await bot.sendPhoto(chatId, word.image_url, {
        caption: caption,
        reply_markup: replyMarkup
      });
    }

  } catch (error) {
    console.error('Error sending word card:', error);
    await bot.sendMessage(chatId, '❌ 카드 전송 중 오류가 발생했습니다.');
  }
}

/**
 * Word Card Callback 핸들러 (이전/다음 버튼)
 */
async function handleWordCardCallback(bot, query) {
  try {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data.startsWith('card_')) {
      const parts = data.split('_');
      const action = parts[1];
      const day = parseInt(parts[2]);
      const currentIndex = parseInt(parts[3]);

      let newIndex = currentIndex;
      if (action === 'next') newIndex = currentIndex + 1;
      else if (action === 'prev') newIndex = currentIndex - 1;

      await sendWordCard(bot, chatId, day, newIndex);
      await bot.answerCallbackQuery(query.id);
    }

  } catch (error) {
    console.error('Error handling word card callback:', error);
    await bot.answerCallbackQuery(query.id, { text: '오류가 발생했습니다.', show_alert: true });
  }
}

/**
 * TTS Callback — 음성 전송 후 5초 뒤 자동 삭제 (연쇄 재생 방지)
 */
async function handleTTSCallback(bot, query) {
  try {
    const chatId = query.message.chat.id;
    const wordId = parseInt(query.data.split('_')[1]);

    const { data: word } = await supabase
      .from('words')
      .select('korean, pronunciation, audio_url')
      .eq('id', wordId)
      .single();

    if (!word?.audio_url) {
      await bot.answerCallbackQuery(query.id, { text: '음성 파일이 없습니다.' });
      return;
    }

    const sent = await bot.sendAudio(chatId, word.audio_url, {
      caption: `🔊 ${word.korean} ${word.pronunciation || ''}`
    });

    await bot.answerCallbackQuery(query.id);

    setTimeout(() => {
      bot.deleteMessage(chatId, sent.message_id).catch(() => {});
    }, 5000);

  } catch (err) {
    console.error('TTS callback error:', err);
    await bot.answerCallbackQuery(query.id, { text: '오류가 발생했습니다.' });
  }
}

async function sendWordCards(bot, chatId, day) {
  await sendWordCard(bot, chatId, day, 0);
}

module.exports = { handleWordCardCallback, sendWordCard, sendWordCards, handleTTSCallback };
