const OpenAI = require('openai');
const { supabase } = require('../config/supabase');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── DALL-E로 단어 일러스트 생성 ──
async function generateWordImage(korean, meaningKhmer, category) {
  try {
    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: `Simple cute flat illustration of the concept: ${meaningKhmer}. Clean white background, minimal cartoon style, colorful, child-friendly. ABSOLUTELY NO TEXT, NO LETTERS, NO WORDS, NO CHARACTERS of any language anywhere in the image. Pure illustration only.`,
      n: 1,
      size: '1024x1024',
      quality: 'standard'
    });

    return response.data[0].url;
  } catch (err) {
    console.error(`DALL-E error for ${korean}:`, err.message);
    return null;
  }
}

// ── 단어카드 이미지 생성 (HTML → PNG) ──
async function generateCardImage(word, index, total, dayNumber) {
  // DALL-E로 일러스트 생성
  const illustrationUrl = await generateWordImage(
    word.korean, 
    word.meaning_khmer, 
    word.category
  );

  if (!illustrationUrl) {
    console.log(`Skipping card image for ${word.korean} - DALL-E failed`);
    return null;
  }

  // 일러스트 이미지 다운로드 → Supabase Storage에 저장
  const response = await fetch(illustrationUrl);
  const imageBuffer = Buffer.from(await response.arrayBuffer());

  const fileName = `cards/day${dayNumber}/${word.id}_illustration.png`;
  
  const { error: uploadError } = await supabase.storage
    .from('word-cards')
    .upload(fileName, imageBuffer, {
      contentType: 'image/png',
      upsert: true
    });

  if (uploadError) {
    console.error(`Upload error for ${word.korean}:`, uploadError.message);
    return null;
  }

  // Public URL 가져오기
  const { data: urlData } = supabase.storage
    .from('word-cards')
    .getPublicUrl(fileName);

  // words 테이블에 이미지 URL 업데이트
  await supabase
    .from('words')
    .update({ image_url: urlData.publicUrl })
    .eq('id', word.id);

  return urlData.publicUrl;
}

// ── 하루치 카드 일괄 생성 ──
async function generateCardsForDay(bot, dayNumber) {
  const { data: words } = await supabase
    .from('words')
    .select('*')
    .eq('day_number', dayNumber)
    .is('image_url', null)
    .order('sort_order');

  if (!words || words.length === 0) {
    console.log(`Day ${dayNumber}: No cards to generate`);
    return;
  }

  console.log(`Day ${dayNumber}: Generating ${words.length} card images...`);

  // 관리자에게 시작 알림
  const { data: config } = await supabase
    .from('admin_config')
    .select('value')
    .eq('key', 'admin_chat_id')
    .single();

  const adminId = config?.value;

  if (adminId) {
    await bot.sendMessage(adminId,
      `🎨 Day ${dayNumber} 단어카드 생성 시작\n` +
      `총 ${words.length}개 카드를 생성합니다...`
    );
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    
    try {
      const imageUrl = await generateCardImage(word, i, words.length, dayNumber);
      
      if (imageUrl) {
        success++;
        
        // 5개마다 관리자에게 진행 상황 알림
        if (adminId && (i + 1) % 5 === 0) {
          await bot.sendMessage(adminId,
            `🎨 진행: ${i + 1}/${words.length} (${word.korean})`
          );
        }
      } else {
        failed++;
      }

      // DALL-E rate limit 방지 (1초 대기)
      await new Promise(resolve => setTimeout(resolve, 1500));
    } catch (err) {
      console.error(`Card generation failed for ${word.korean}:`, err.message);
      failed++;
    }
  }

  // 완료 알림 + 샘플 미리보기
  if (adminId) {
    await bot.sendMessage(adminId,
      `✅ Day ${dayNumber} 카드 생성 완료!\n` +
      `성공: ${success}개 / 실패: ${failed}개\n\n` +
      `첫 번째 카드를 미리보기로 보내드릴게요.`
    );

    // 첫 번째 생성된 카드 미리보기
    const { data: firstCard } = await supabase
      .from('words')
      .select('*')
      .eq('day_number', dayNumber)
      .not('image_url', 'is', null)
      .order('sort_order')
      .limit(1)
      .single();

    if (firstCard?.image_url) {
      await bot.sendPhoto(adminId, firstCard.image_url, {
        caption: `📚 ${firstCard.korean} ${firstCard.pronunciation}\n🇰🇭 ${firstCard.meaning_khmer}\n\n이 스타일로 생성됐습니다. OK?`,
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ OK', callback_data: `admin_cards_ok_${dayNumber}` },
            { text: '🔄 다시 생성', callback_data: `admin_cards_redo_${dayNumber}` }
          ]]
        }
      });
    }
  }

  console.log(`Day ${dayNumber}: ${success} cards generated, ${failed} failed`);
}

// ── TTS 음성 생성 ──
async function generateTTSForWord(word) {
  try {
    const response = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: word.korean,
      speed: 0.9
    });

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const fileName = `audio/day${word.day_number}/${word.id}.mp3`;

    const { error } = await supabase.storage
      .from('word-cards')
      .upload(fileName, audioBuffer, {
        contentType: 'audio/mpeg',
        upsert: true
      });

    if (error) {
      console.error(`TTS upload error for ${word.korean}:`, error.message);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from('word-cards')
      .getPublicUrl(fileName);

    // words 테이블에 음성 URL 업데이트
    await supabase
      .from('words')
      .update({ audio_url: urlData.publicUrl })
      .eq('id', word.id);

    return urlData.publicUrl;
  } catch (err) {
    console.error(`TTS error for ${word.korean}:`, err.message);
    return null;
  }
}

// ── 하루치 TTS 일괄 생성 ──
async function generateTTSForDay(bot, dayNumber) {
  const { data: words } = await supabase
    .from('words')
    .select('*')
    .eq('day_number', dayNumber)
    .is('audio_url', null)
    .order('sort_order');

  if (!words || words.length === 0) {
    console.log(`Day ${dayNumber}: No TTS to generate`);
    return;
  }

  console.log(`Day ${dayNumber}: Generating ${words.length} TTS files...`);

  const { data: config } = await supabase
    .from('admin_config')
    .select('value')
    .eq('key', 'admin_chat_id')
    .single();

  const adminId = config?.value;

  let success = 0;

  for (const word of words) {
    const url = await generateTTSForWord(word);
    if (url) success++;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  if (adminId) {
    await bot.sendMessage(adminId,
      `🔊 Day ${dayNumber} TTS 생성 완료!\n` +
      `${success}/${words.length}개 음성 파일 생성됨`
    );
  }
}

module.exports = { 
  generateCardsForDay, 
  generateTTSForDay, 
  generateWordImage, 
  generateTTSForWord 
};
