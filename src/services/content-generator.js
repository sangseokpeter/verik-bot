const OpenAI = require('openai');
const { supabase } = require('../config/supabase');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── 폰트를 base64로 로드 (SVG 내장용) ──
let fontBase64Regular = '';
let fontBase64Bold = '';
const fontDir = path.resolve(__dirname, '../../fonts');

try {
  const regularPath = path.join(fontDir, 'NotoSansKR-Regular.ttf');
  const boldPath = path.join(fontDir, 'NotoSansKR-Bold.ttf');
  
  if (fs.existsSync(regularPath)) {
    fontBase64Regular = fs.readFileSync(regularPath).toString('base64');
    console.log('✅ Regular font loaded:', regularPath);
  }
  if (fs.existsSync(boldPath)) {
    fontBase64Bold = fs.readFileSync(boldPath).toString('base64');
    console.log('✅ Bold font loaded:', boldPath);
  }
} catch (err) {
  console.error('Font load error:', err.message);
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

// ── SVG 카드 생성 ──
function generateCardSVG(word, illustrationBase64, index, total, dayNumber) {
  const W = 760;
  const H = 980;
  const pron = word.pronunciation ? word.pronunciation.replace('[', '').replace(']', '') : word.korean;
  
  // XML escape
  const esc = (s) => s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

  const imgSection = illustrationBase64 
    ? `<image href="data:image/png;base64,${illustrationBase64}" x="185" y="108" width="390" height="390" preserveAspectRatio="xMidYMid meet"/>`
    : `<rect x="185" y="108" width="390" height="390" rx="20" fill="#E0E0E0"/><text x="380" y="320" text-anchor="middle" font-size="80" fill="#999">?</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs>
  <style>
    @font-face {
      font-family: 'KR';
      src: url('data:font/ttf;base64,${fontBase64Regular}') format('truetype');
      font-weight: 400;
    }
    @font-face {
      font-family: 'KR';
      src: url('data:font/ttf;base64,${fontBase64Bold}') format('truetype');
      font-weight: 700;
    }
  </style>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="#D4A843"/>
    <stop offset="50%" stop-color="#F0D68A"/>
    <stop offset="100%" stop-color="#D4A843"/>
  </linearGradient>
  <linearGradient id="green" x1="0" y1="0" x2="0.5" y2="1">
    <stop offset="0%" stop-color="#E8F5E9"/>
    <stop offset="100%" stop-color="#C8E6C9"/>
  </linearGradient>
</defs>

<!-- 배경 + 테두리 -->
<rect x="2" y="2" width="${W-4}" height="${H-4}" rx="32" fill="white" stroke="#1B2A4A" stroke-width="5"/>

<!-- 골드 라인 상단 -->
<rect x="5" y="5" width="${W-10}" height="8" fill="url(#gold)"/>

<!-- 카드 번호 -->
<circle cx="56" cy="52" r="22" fill="#1B2A4A"/>
<polygon points="62,52 50,44 50,60" fill="#D4A843"/>
<text x="86" y="60" font-family="KR" font-weight="700" font-size="26" fill="#1B2A4A">${index + 1} / ${total}</text>

<!-- DAY 배지 -->
<rect x="${W-180}" y="32" width="150" height="42" rx="16" fill="#1B2A4A"/>
<text x="${W-105}" y="60" text-anchor="middle" font-family="KR" font-weight="700" font-size="22" fill="#D4A843">DAY ${dayNumber}</text>

<!-- 이미지 영역 -->
<rect x="36" y="88" width="${W-72}" height="420" rx="24" fill="url(#green)"/>
${imgSection}

<!-- 스피커 아이콘 -->
<circle cx="${W-76}" cy="128" r="30" fill="rgba(27,42,74,0.8)"/>
<text x="${W-76}" y="136" text-anchor="middle" font-size="24" fill="#D4A843">🔊</text>

<!-- 한국어 단어 -->
<text x="48" y="568" font-family="KR" font-weight="700" font-size="64" fill="#1B2A4A">${esc(word.korean)}</text>
<text x="${48 + word.korean.length * 64 + 16}" y="568" font-family="KR" font-weight="400" font-size="26" fill="#B0B0B0">[${esc(pron)}]</text>

<!-- 카테고리 배지 -->
<rect x="${W-160}" y="540" width="112" height="36" rx="12" fill="#EEF2F7"/>
<text x="${W-104}" y="564" text-anchor="middle" font-family="KR" font-weight="700" font-size="20" fill="#1B2A4A">${esc(word.category)}</text>

<!-- 크메르어 뜻 -->
<rect x="48" y="590" width="${W-96}" height="60" rx="16" fill="#F0F7ED" stroke="#4CAF50" stroke-width="3"/>
<text x="${W/2}" y="630" text-anchor="middle" font-family="KR" font-weight="700" font-size="32" fill="#2E7D32">${esc(word.meaning_khmer)}</text>

<!-- EXAMPLE -->
<text x="48" y="688" font-family="KR" font-weight="700" font-size="18" fill="#C0C0C0">EXAMPLE</text>
<rect x="48" y="700" width="${W-96}" height="80" rx="16" fill="#F9F9F9"/>
<text x="68" y="732" font-family="KR" font-weight="700" font-size="24" fill="#555555">${esc(word.example_kr || '')}</text>
<text x="68" y="762" font-family="KR" font-weight="400" font-size="18" fill="#AAAAAA">${esc(word.example_khmer || '')}</text>

<!-- 골드 라인 하단 -->
<rect x="5" y="${H-13}" width="${W-10}" height="8" fill="url(#gold)"/>
</svg>`;
}

// ── SVG → PNG 변환 ──
async function svgToPng(svgString) {
  return sharp(Buffer.from(svgString)).png().toBuffer();
}

// ── 단어카드 이미지 생성 ──
async function generateCardImage(word, index, total, dayNumber) {
  // 1. DALL-E 일러스트
  const illustrationUrl = await generateWordImage(word.korean, word.meaning_khmer, word.category);
  
  // 2. 일러스트를 base64로 변환
  let illustrationBase64 = null;
  if (illustrationUrl) {
    try {
      const response = await fetch(illustrationUrl);
      const buffer = Buffer.from(await response.arrayBuffer());
      illustrationBase64 = buffer.toString('base64');
    } catch (err) {
      console.error('Image fetch error:', err.message);
    }
  }

  // 3. SVG 생성
  const svg = generateCardSVG(word, illustrationBase64, index, total, dayNumber);

  // 4. PNG 변환
  const imageBuffer = await svgToPng(svg);

  // 5. Supabase 업로드
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
