const OpenAI = require('openai');
const { supabase } = require('../config/supabase');
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── 폰트 등록 (여러 경로 시도) ──
const possibleFontDirs = [
  path.resolve(__dirname, '../../fonts'),
  path.resolve(process.cwd(), 'fonts'),
  '/app/fonts',
  path.resolve(__dirname, '../../../fonts')
];

let fontsLoaded = false;
for (const fontDir of possibleFontDirs) {
  const regularPath = path.join(fontDir, 'NotoSansKR-Regular.ttf');
  const boldPath = path.join(fontDir, 'NotoSansKR-Bold.ttf');
  
  console.log(`🔍 Trying font dir: ${fontDir}`);
  console.log(`   Regular exists: ${fs.existsSync(regularPath)}`);
  console.log(`   Bold exists: ${fs.existsSync(boldPath)}`);
  
  if (fs.existsSync(regularPath) && fs.existsSync(boldPath)) {
    try {
      GlobalFonts.registerFromPath(regularPath, 'NotoSansKR');
      GlobalFonts.registerFromPath(boldPath, 'NotoSansKRBold');
      console.log(`✅ Korean fonts registered from: ${fontDir}`);
      fontsLoaded = true;
      break;
    } catch (err) {
      console.error(`Font registration error at ${fontDir}:`, err.message);
    }
  }
}

if (!fontsLoaded) {
  console.error('❌ Korean fonts NOT found in any path!');
  console.log('Available fonts:', GlobalFonts.families);
}

// ── DALL-E 일러스트 생성 ──
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

// ── 둥근 모서리 사각형 그리기 ──
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── 카드 이미지 그리기 (Canvas) ──
async function drawCard(word, illustrationUrl, index, total, dayNumber) {
  const W = 760;
  const H = 980;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── 배경: 흰색 + 네이비 테두리 ──
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, 0, 0, W, H, 32);
  ctx.fill();

  // 네이비 테두리
  ctx.strokeStyle = '#1B2A4A';
  ctx.lineWidth = 5;
  roundRect(ctx, 2, 2, W - 4, H - 4, 32);
  ctx.stroke();

  // ── 골드 라인 (상단) ──
  const goldGrad = ctx.createLinearGradient(0, 0, W, 0);
  goldGrad.addColorStop(0, '#D4A843');
  goldGrad.addColorStop(0.5, '#F0D68A');
  goldGrad.addColorStop(1, '#D4A843');
  ctx.fillStyle = goldGrad;
  ctx.fillRect(5, 5, W - 10, 8);

  // ── 헤더: 카드 번호 + DAY ──
  // 카드 번호 (원형 배경)
  ctx.fillStyle = '#1B2A4A';
  ctx.beginPath();
  ctx.arc(56, 52, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#D4A843';
  ctx.beginPath();
  ctx.moveTo(62, 52);
  ctx.lineTo(50, 44);
  ctx.lineTo(50, 60);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#1B2A4A';
  ctx.font = '26px NotoSansKRBold';
  ctx.fillText(`${index + 1} / ${total}`, 86, 60);

  // DAY 배지
  roundRect(ctx, W - 180, 32, 150, 42, 16);
  ctx.fillStyle = '#1B2A4A';
  ctx.fill();
  ctx.fillStyle = '#D4A843';
  ctx.font = '22px NotoSansKRBold';
  ctx.textAlign = 'center';
  ctx.fillText(`DAY ${dayNumber}`, W - 105, 60);
  ctx.textAlign = 'left';

  // ── 이미지 영역 ──
  const imgX = 36;
  const imgY = 88;
  const imgW = W - 72;
  const imgH = 380;

  // 연초록 배경
  roundRect(ctx, imgX, imgY, imgW, imgH, 24);
  const greenGrad = ctx.createLinearGradient(imgX, imgY, imgX + imgW, imgY + imgH);
  greenGrad.addColorStop(0, '#E8F5E9');
  greenGrad.addColorStop(1, '#C8E6C9');
  ctx.fillStyle = greenGrad;
  ctx.fill();

  // DALL-E 일러스트 로드
  if (illustrationUrl) {
    try {
      const response = await fetch(illustrationUrl);
      const buffer = Buffer.from(await response.arrayBuffer());
      const img = await loadImage(buffer);
      const size = 320;
      const ix = imgX + (imgW - size) / 2;
      const iy = imgY + (imgH - size) / 2;
      ctx.drawImage(img, ix, iy, size, size);
    } catch (err) {
      console.error('Image load error:', err.message);
    }
  }

  // 스피커 아이콘 (원형)
  ctx.fillStyle = 'rgba(27, 42, 74, 0.8)';
  ctx.beginPath();
  ctx.arc(imgX + imgW - 40, imgY + 40, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#D4A843';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(imgX + imgW - 48, imgY + 36);
  ctx.lineTo(imgX + imgW - 48, imgY + 44);
  ctx.lineTo(imgX + imgW - 42, imgY + 44);
  ctx.lineTo(imgX + imgW - 36, imgY + 48);
  ctx.lineTo(imgX + imgW - 36, imgY + 32);
  ctx.lineTo(imgX + imgW - 42, imgY + 36);
  ctx.closePath();
  ctx.stroke();

  // ── 한국어 단어 ──
  const textY = imgY + imgH + 50;
  ctx.fillStyle = '#1B2A4A';
  ctx.font = '64px NotoSansKRBold';
  ctx.fillText(word.korean, 48, textY);

  // 발음
  const korWidth = ctx.measureText(word.korean).width;
  const pron = word.pronunciation ? word.pronunciation.replace('[', '').replace(']', '') : word.korean;
  ctx.fillStyle = '#B0B0B0';
  ctx.font = '26px NotoSansKR';
  ctx.fillText(`[${pron}]`, 48 + korWidth + 16, textY);

  // 카테고리 배지
  ctx.font = '20px NotoSansKRBold';
  const catWidth = ctx.measureText(word.category).width;
  const catX = W - 48 - catWidth - 32;
  roundRect(ctx, catX, textY - 28, catWidth + 32, 36, 12);
  ctx.fillStyle = '#EEF2F7';
  ctx.fill();
  ctx.fillStyle = '#1B2A4A';
  ctx.fillText(word.category, catX + 16, textY - 2);

  // ── 크메르어 뜻 (초록 상자) ──
  const khmerY = textY + 30;
  roundRect(ctx, 48, khmerY, W - 96, 60, 16);
  ctx.fillStyle = '#F0F7ED';
  ctx.fill();
  ctx.strokeStyle = '#4CAF50';
  ctx.lineWidth = 3;
  roundRect(ctx, 48, khmerY, W - 96, 60, 16);
  ctx.stroke();

  ctx.fillStyle = '#2E7D32';
  ctx.font = '32px NotoSansKRBold';
  ctx.textAlign = 'center';
  ctx.fillText(word.meaning_khmer, W / 2, khmerY + 42);
  ctx.textAlign = 'left';

  // ── EXAMPLE ──
  const exY = khmerY + 80;
  ctx.fillStyle = '#C0C0C0';
  ctx.font = '18px NotoSansKRBold';
  ctx.fillText('EXAMPLE', 48, exY);

  // 예문 배경
  roundRect(ctx, 48, exY + 12, W - 96, 80, 16);
  ctx.fillStyle = '#F9F9F9';
  ctx.fill();

  // 한국어 예문
  if (word.example_kr) {
    ctx.fillStyle = '#555555';
    ctx.font = '24px NotoSansKRBold';
    ctx.fillText(word.example_kr, 68, exY + 42);
  }

  // 크메르어 예문
  if (word.example_khmer) {
    ctx.fillStyle = '#AAAAAA';
    ctx.font = '18px NotoSansKR';
    ctx.fillText(word.example_khmer, 68, exY + 72);
  }

  // ── 골드 라인 (하단) ──
  ctx.fillStyle = goldGrad;
  ctx.fillRect(5, H - 13, W - 10, 8);

  return canvas.encode('png');
}

// ── 단어카드 이미지 생성 ──
async function generateCardImage(word, index, total, dayNumber) {
  const illustrationUrl = await generateWordImage(word.korean, word.meaning_khmer, word.category);
  const imageBuffer = await drawCard(word, illustrationUrl, index, total, dayNumber);

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
    .from('words').select('*').eq('day_number', dayNumber)
    .is('image_url', null).order('sort_order');

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
      await new Promise(r => setTimeout(r, 1500));
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
