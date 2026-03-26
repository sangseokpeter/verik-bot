const OpenAI = require('openai');
const { supabase } = require('../config/supabase');
const puppeteer = require('puppeteer');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── DALL-E 일러스트 생성 (글자 없이, 정사각형) ──
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

// ── HTML 카드 템플릿 (VERI-K 네이비+골드 브랜드) ──
function generateCardHTML(word, illustrationUrl, index, total, dayNumber) {
  const pron = word.pronunciation ? word.pronunciation.replace('[', '').replace(']', '') : word.korean;
  const exampleKr = word.example_kr
    ? word.example_kr.replace(word.korean, `<span style="color:#1B2A4A;background:#E8EDF4;padding:2px 12px;border-radius:8px;">${word.korean}</span>`)
    : '';

  const fontDir = require('path').resolve(__dirname, '../../fonts');
  
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
@font-face {
  font-family: 'NotoSansKR';
  src: url('file://${fontDir}/NotoSansKR-Regular.woff2') format('woff2');
  font-weight: 400;
}
@font-face {
  font-family: 'NotoSansKR';
  src: url('file://${fontDir}/NotoSansKR-Bold.woff2') format('woff2');
  font-weight: 700;
}
*{margin:0;padding:0;box-sizing:border-box}
body{width:760px;background:transparent;font-family:'NotoSansKR',sans-serif}
</style>
</head>
<body>
<div style="width:760px;border-radius:40px;overflow:hidden;background:#fff;border:5px solid #1B2A4A">
  <div style="height:8px;background:linear-gradient(90deg,#D4A843 0%,#F0D68A 50%,#D4A843 100%)"></div>
  <div style="display:flex;justify-content:space-between;align-items:center;padding:28px 40px 0">
    <div style="display:flex;align-items:center;gap:12px">
      <div style="width:56px;height:56px;background:#1B2A4A;border-radius:50%;display:flex;align-items:center;justify-content:center">
        <svg width="20" height="20" viewBox="0 0 10 10"><path d="M7 5L3 2v6z" fill="#D4A843"/></svg>
      </div>
      <span style="font-size:30px;font-weight:800;color:#1B2A4A">${index + 1} / ${total}</span>
    </div>
    <div style="background:#1B2A4A;color:#D4A843;font-size:26px;font-weight:800;padding:10px 32px;border-radius:20px;letter-spacing:1px">DAY ${dayNumber}</div>
  </div>
  <div style="margin:28px 40px 0;position:relative">
    <div style="background:linear-gradient(160deg,#E8F5E9 0%,#C8E6C9 100%);border-radius:32px;height:440px;display:flex;align-items:center;justify-content:center;overflow:hidden">
      ${illustrationUrl ? `<img src="${illustrationUrl}" style="width:380px;height:380px;object-fit:contain">` : `<div style="width:380px;height:380px;background:#E0E0E0;border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:100px;color:#999">?</div>`}
    </div>
    <div style="position:absolute;top:24px;right:24px;width:84px;height:84px;background:rgba(27,42,74,0.8);border-radius:50%;display:flex;align-items:center;justify-content:center">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D4A843" stroke-width="2.2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
    </div>
  </div>
  <div style="padding:36px 48px 12px">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:baseline;gap:20px">
        <span style="font-size:72px;font-weight:700;color:#1B2A4A;font-family:'NotoSansKR',sans-serif">${word.korean}</span>
        <span style="font-size:30px;font-weight:400;color:#B0B0B0;font-family:'NotoSansKR',sans-serif">[${pron}]</span>
      </div>
      <div style="background:#EEF2F7;color:#1B2A4A;font-size:22px;font-weight:700;padding:8px 24px;border-radius:16px;font-family:'NotoSansKR',sans-serif">${word.category}</div>
    </div>
  </div>
  <div style="padding:0 48px 16px">
    <div style="background:#F0F7ED;border:3px solid #4CAF50;border-radius:20px;padding:16px 28px;text-align:center">
      <span style="font-size:36px;font-weight:700;color:#2E7D32">${word.meaning_khmer}</span>
    </div>
  </div>
  <div style="padding:0 48px 40px">
    <p style="font-size:22px;font-weight:700;color:#C0C0C0;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px">EXAMPLE</p>
    <div style="background:#F9F9F9;border-radius:24px;padding:28px 32px">
      <p style="font-size:30px;font-weight:700;color:#555;margin-bottom:8px;font-family:'NotoSansKR',sans-serif">${exampleKr}</p>
      <p style="font-size:20px;font-weight:400;color:#AAA">${word.example_khmer || ''}</p>
    </div>
  </div>
  <div style="height:8px;background:linear-gradient(90deg,#D4A843 0%,#F0D68A 50%,#D4A843 100%)"></div>
</div>
</body>
</html>`;
}

// ── HTML → PNG 변환 ──
async function htmlToPng(html) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none', '--disable-gpu', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 780, height: 1200 });
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
  
  // 폰트 로딩 대기
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 2000));
  
  const element = await page.$('body > div');
  const imageBuffer = await element.screenshot({ type: 'png', omitBackground: true });
  await browser.close();
  return imageBuffer;
}

// ── 단어카드 이미지 생성 ──
async function generateCardImage(word, index, total, dayNumber) {
  const illustrationUrl = await generateWordImage(word.korean, word.meaning_khmer, word.category);
  const html = generateCardHTML(word, illustrationUrl, index, total, dayNumber);
  const imageBuffer = await htmlToPng(html);

  const fileName = `cards/day${dayNumber}/${word.id}_card.png`;
  const { error: uploadError } = await supabase.storage
    .from('word-cards')
    .upload(fileName, imageBuffer, { contentType: 'image/png', upsert: true });

  if (uploadError) {
    console.error(`Upload error for ${word.korean}:`, uploadError.message);
    return null;
  }

  const { data: urlData } = supabase.storage.from('word-cards').getPublicUrl(fileName);
  await supabase.from('words').update({ image_url: urlData.publicUrl }).eq('id', word.id);
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

  const { data: config } = await supabase.from('admin_config').select('value').eq('key', 'admin_chat_id').single();
  const adminId = config?.value;

  if (adminId) {
    await bot.sendMessage(adminId, `🎨 Day ${dayNumber} 단어카드 생성 시작\n총 ${words.length}개 카드를 생성합니다...`);
  }

  let success = 0, failed = 0;

  for (let i = 0; i < words.length; i++) {
    try {
      const imageUrl = await generateCardImage(words[i], i, words.length, dayNumber);
      if (imageUrl) {
        success++;
        if (adminId && (i + 1) % 5 === 0) {
          await bot.sendMessage(adminId, `🎨 진행: ${i + 1}/${words.length} (${words[i].korean})`);
        }
      } else { failed++; }
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`Card failed for ${words[i].korean}:`, err.message);
      failed++;
    }
  }

  if (adminId) {
    await bot.sendMessage(adminId, `✅ Day ${dayNumber} 카드 생성 완료!\n성공: ${success}개 / 실패: ${failed}개`);
    const { data: firstCard } = await supabase.from('words').select('*').eq('day_number', dayNumber).not('image_url', 'is', null).order('sort_order').limit(1).single();
    if (firstCard?.image_url) {
      await bot.sendPhoto(adminId, firstCard.image_url, {
        reply_markup: { inline_keyboard: [[{ text: '✅ OK', callback_data: `admin_cards_ok_${dayNumber}` }, { text: '🔄 다시', callback_data: `admin_cards_redo_${dayNumber}` }]] }
      });
    }
  }
}

// ── TTS 음성 생성 ──
async function generateTTSForWord(word) {
  try {
    const response = await openai.audio.speech.create({ model: 'tts-1', voice: 'nova', input: word.korean, speed: 0.9 });
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const fileName = `audio/day${word.day_number}/${word.id}.mp3`;
    const { error } = await supabase.storage.from('word-cards').upload(fileName, audioBuffer, { contentType: 'audio/mpeg', upsert: true });
    if (error) { console.error(`TTS upload error for ${word.korean}:`, error.message); return null; }
    const { data: urlData } = supabase.storage.from('word-cards').getPublicUrl(fileName);
    await supabase.from('words').update({ audio_url: urlData.publicUrl }).eq('id', word.id);
    return urlData.publicUrl;
  } catch (err) { console.error(`TTS error for ${word.korean}:`, err.message); return null; }
}

// ── 하루치 TTS 일괄 생성 ──
async function generateTTSForDay(bot, dayNumber) {
  const { data: words } = await supabase.from('words').select('*').eq('day_number', dayNumber).is('audio_url', null).order('sort_order');
  if (!words || words.length === 0) { console.log(`Day ${dayNumber}: No TTS to generate`); return; }
  console.log(`Day ${dayNumber}: Generating ${words.length} TTS files...`);
  const { data: config } = await supabase.from('admin_config').select('value').eq('key', 'admin_chat_id').single();
  const adminId = config?.value;
  let success = 0;
  for (const word of words) {
    const url = await generateTTSForWord(word);
    if (url) success++;
    await new Promise(r => setTimeout(r, 500));
  }
  if (adminId) { await bot.sendMessage(adminId, `🔊 Day ${dayNumber} TTS 생성 완료!\n${success}/${words.length}개 음성 파일 생성됨`); }
}

module.exports = { generateCardsForDay, generateTTSForDay, generateWordImage, generateTTSForWord };
