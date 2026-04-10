const OpenAI = require('openai');
const { supabase } = require('../config/supabase');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// python3 또는 python 자동 탐지
let _pythonCmd = null;
function getPython() {
  if (_pythonCmd) return _pythonCmd;
  for (const cmd of ['python3', 'python']) {
    try {
      execSync(`${cmd} --version`, { stdio: 'ignore' });
      _pythonCmd = cmd;
      return cmd;
    } catch {}
  }
  _pythonCmd = 'python3';
  return _pythonCmd;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

// ── DALL-E 이미지 다운로드 ──
async function downloadImage(url, savePath) {
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(savePath, buffer);
  return savePath;
}

// ── Python으로 카드 이미지 생성 ──
function generateCardWithPython(wordData, illustrationPath, outputPath) {
  const wordJson = JSON.stringify(wordData).replace(/'/g, "\\'");
  const illPath = illustrationPath || 'none';
  
  try {
    // Python 실행 (stdout/stderr 모두 캡처)
    execSync(
      `${getPython()} scripts/generate_card.py '${wordJson}' '${illPath}' '${outputPath}'`,
      { timeout: 30000, cwd: process.cwd(), stdio: 'inherit' }
    );
    
    // 파일이 실제로 생성되었는지 확인
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      if (stats.size > 0) {
        return true;
      }
    }
    
    console.error('Python card error: Output file not created or empty');
    return false;
  } catch (err) {
    console.error('Python exec error:', err.message);
    return false;
  }
}

// ── 단어카드 이미지 생성 ──
async function generateCardImage(word, index, total, dayNumber) {
  const tmpDir = '/tmp/verik-cards';
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  // 1. DALL-E 일러스트 생성 + 다운로드
  let illustrationPath = null;
  const illustrationUrl = await generateWordImage(word.korean, word.meaning_khmer, word.category);
  if (illustrationUrl) {
    illustrationPath = path.join(tmpDir, `illust_${word.id}.png`);
    await downloadImage(illustrationUrl, illustrationPath);
  }

  // 2. Python으로 카드 생성
  const outputPath = path.join(tmpDir, `card_${word.id}.png`);
  const wordData = {
    ...word,
    index: index,
    total: total,
    day_number: dayNumber
  };

  const success = generateCardWithPython(wordData, illustrationPath, outputPath);
  if (!success || !fs.existsSync(outputPath)) {
    console.error(`Card generation failed for ${word.korean}`);
    return null;
  }

  // 3. Supabase Storage 업로드
  const imageBuffer = fs.readFileSync(outputPath);
  const fileName = `cards/day${dayNumber}/${word.id}_card.png`;
  
  const { error: uploadError } = await supabase.storage
    .from('word-cards')
    .upload(fileName, imageBuffer, { contentType: 'image/png', upsert: true });

  if (uploadError) {
    console.error(`Upload error for ${word.korean}:`, uploadError.message);
    return null;
  }

  const { data: urlData } = supabase.storage.from('word-cards').getPublicUrl(fileName);
  // Telegram 캐시 방지: timestamp 추가
  const urlWithTimestamp = `${urlData.publicUrl}?t=${Date.now()}`;
  await supabase.from('words').update({ image_url: urlWithTimestamp }).eq('id', word.id);

  // 임시 파일 정리
  try {
    if (illustrationPath) fs.unlinkSync(illustrationPath);
    fs.unlinkSync(outputPath);
  } catch (e) {}

  return urlWithTimestamp;
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
    const { data: firstCard } = await supabase.from('words').select('*').eq('day_number', dayNumber).not('image_url', 'is', null).neq('image_url', 'skip').order('sort_order').limit(1).single();
    if (firstCard?.image_url && firstCard.image_url !== 'skip') {
      await bot.sendPhoto(adminId, firstCard.image_url, {
        reply_markup: { inline_keyboard: [[{ text: '✅ OK', callback_data: `admin_cards_ok_${dayNumber}` }, { text: '🔄 다시', callback_data: `admin_cards_redo_${dayNumber}` }]] }
      });
    }
  }
}

// ── TTS 음성 생성 ──
async function generateTTSForWord(word) {
  try {
    const response = await openai.audio.speech.create({ model: 'tts-1', voice: 'nova', input: word.korean, speed: 0.75 });
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
