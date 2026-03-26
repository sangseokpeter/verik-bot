const { supabase } = require('../config/supabase');

// ── 단어카드 전송 (한 장씩) ──
async function sendWordCards(bot, chatId, dayNumber) {
  const { data: words } = await supabase
    .from('words')
    .select('*')
    .eq('day_number', dayNumber)
    .order('sort_order');

  if (!words || words.length === 0) return;

  // 첫 번째 카드 전송
  await sendSingleCard(bot, chatId, words[0], 0, words.length);
}

// ── 단일 카드 전송 ──
async function sendSingleCard(bot, chatId, word, index, total) {
  const cardText =
    `📚 단어 ${index + 1}/${total}\n\n` +
    `🇰🇷 ${word.korean}\n` +
    `🔊 ${word.pronunciation}\n\n` +
    `📂 ${word.category} | ${word.topic}\n\n` +
    `💡 크메르어 뜻을 맞혀보세요!\n` +
    `   សាកទាយអត្ថន័យជាភាសាខ្មែរ!`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '👁 뜻 보기 / មើលអត្ថន័យ', callback_data: `card_reveal_${word.id}_${index}_${total}` }
      ],
      [
        { text: '🔊 발음 듣기', callback_data: `card_audio_${word.id}` }
      ],
      ...(index < total - 1 ? [[
        { text: `➡️ 다음 단어 (${index + 2}/${total})`, callback_data: `card_next_${word.day_number}_${index + 1}` }
      ]] : [[
        { text: '✅ 오늘 단어 완료!', callback_data: `card_done_${word.day_number}` }
      ]])
    ]
  };

  if (word.image_url) {
    await bot.sendPhoto(chatId, word.image_url, {
      caption: cardText,
      reply_markup: keyboard
    });
  } else {
    await bot.sendMessage(chatId, cardText, { reply_markup: keyboard });
  }
}

// ── 콜백 처리 ──
async function handleWordCardCallback(bot, query) {
  const chatId = query.message.chat.id;
  const msgId = query.message.message_id;
  const data = query.data;

  try {
    // 뜻 공개
    if (data.startsWith('card_reveal_')) {
      const parts = data.split('_');
      const wordId = parseInt(parts[2]);
      const index = parseInt(parts[3]);
      const total = parseInt(parts[4]);

      const { data: word } = await supabase
        .from('words')
        .select('*')
        .eq('id', wordId)
        .single();

      if (!word) return;

      const revealText =
        `📚 단어 ${index + 1}/${total}\n\n` +
        `🇰🇷 ${word.korean}\n` +
        `🔊 ${word.pronunciation}\n\n` +
        `🇰🇭 ${word.meaning_khmer}\n\n` +
        `📝 예문:\n` +
        `  ${word.example_kr}\n` +
        `  ${word.example_khmer}`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🔊 발음 듣기', callback_data: `card_audio_${word.id}` }
          ],
          ...(index < total - 1 ? [[
            { text: `➡️ 다음 단어 (${index + 2}/${total})`, callback_data: `card_next_${word.day_number}_${index + 1}` }
          ]] : [[
            { text: '✅ 오늘 단어 완료!', callback_data: `card_done_${word.day_number}` }
          ]])
        ]
      };

      await bot.editMessageText(revealText, {
        chat_id: chatId,
        message_id: msgId,
        reply_markup: keyboard
      });
    }

    // 다음 카드
    else if (data.startsWith('card_next_')) {
      const parts = data.split('_');
      const dayNumber = parseInt(parts[2]);
      const nextIndex = parseInt(parts[3]);

      const { data: words } = await supabase
        .from('words')
        .select('*')
        .eq('day_number', dayNumber)
        .order('sort_order');

      if (words && words[nextIndex]) {
        await sendSingleCard(bot, chatId, words[nextIndex], nextIndex, words.length);
      }

      await bot.answerCallbackQuery(query.id);
    }

    // 발음 듣기
    else if (data.startsWith('card_audio_')) {
      const wordId = parseInt(data.split('_')[2]);
      
      const { data: word } = await supabase
        .from('words')
        .select('audio_url, korean')
        .eq('id', wordId)
        .single();

      if (word?.audio_url) {
        await bot.sendVoice(chatId, word.audio_url);
      } else {
        await bot.answerCallbackQuery(query.id, {
          text: '🔊 음성 파일 준비 중입니다 / កំពុងរៀបចំ',
          show_alert: false
        });
      }
    }

    // 완료
    else if (data.startsWith('card_done_')) {
      await bot.answerCallbackQuery(query.id, {
        text: '👏 잘했어요! 저녁 7시에 퀴즈가 시작됩니다! / ល្អណាស់! ល្ងាចម៉ោង 7 នឹងមានកម្រងសំណួរ!',
        show_alert: true
      });
    }

    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error('Word card callback error:', err);
    await bot.answerCallbackQuery(query.id);
  }
}

module.exports = { sendWordCards, handleWordCardCallback };
