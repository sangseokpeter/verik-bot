// ============================================
// Word Card Navigation Handler
// ============================================
const { supabase } = require('../config/supabase');

/**
 * 단어 카드 전송 (Next/이전 버튼 포함)
 */
async function sendWordCard(bot, chatId, day, index) {
  try {
    // DB에서 해당 Day의 단어 목록 가져오기
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
    
    // 인덱스 범위 체크
    if (index < 0 || index >= total) {
      await bot.sendMessage(chatId, '카드 범위를 벗어났습니다.');
      return;
    }

    const word = words[index];

    // 카드 이미지 URL 체크
    if (!word.image_url) {
      await bot.sendMessage(chatId, `❌ 카드 이미지가 없습니다: ${word.korean}`);
      return;
    }

    // 캡션
    const caption = `${word.korean} (${index + 1}/${total})`;

    // Inline Keyboard 버튼
    const keyboard = [];
    const buttons = [];

    // 이전 버튼 (첫 카드가 아닐 때만)
    if (index > 0) {
      buttons.push({
        text: '◀ 이전',
        callback_data: `card_prev_${day}_${index}`
      });
    }

    // 다음 버튼 (마지막 카드가 아닐 때만)
    if (index < total - 1) {
      buttons.push({
        text: '다음 ▶',
        callback_data: `card_next_${day}_${index}`
      });
    }

    if (buttons.length > 0) {
      keyboard.push(buttons);
    }

    // 카드 전송
    await bot.sendPhoto(chatId, word.image_url, {
      caption: caption,
      reply_markup: keyboard.length > 0 ? {
        inline_keyboard: keyboard
      } : undefined
    });

  } catch (error) {
    console.error('Error sending word card:', error);
    await bot.sendMessage(chatId, '❌ 카드 전송 중 오류가 발생했습니다.');
  }
}

/**
 * Word Card Callback 핸들러 (버튼 클릭)
 */
async function handleWordCardCallback(bot, query) {
  try {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data.startsWith('card_')) {
      const parts = data.split('_');
      const action = parts[1]; // prev 또는 next
      const day = parseInt(parts[2]);
      const currentIndex = parseInt(parts[3]);

      let newIndex = currentIndex;

      if (action === 'next') {
        newIndex = currentIndex + 1;
      } else if (action === 'prev') {
        newIndex = currentIndex - 1;
      }

      // 새 카드 전송
      await sendWordCard(bot, chatId, day, newIndex);

      // 버튼 클릭 응답 (로딩 표시 제거)
      await bot.answerCallbackQuery(query.id);
    }

  } catch (error) {
    console.error('Error handling word card callback:', error);
    await bot.answerCallbackQuery(query.id, {
      text: '오류가 발생했습니다.',
      show_alert: true
    });
  }
}

module.exports = {
  handleWordCardCallback,
  sendWordCard
};
