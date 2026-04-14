/**
 * Upload listening audio files to Supabase Storage & insert questions into DB
 *
 * Usage: SUPABASE_SECRET_KEY=xxx node scripts/upload_listening_audio.js
 *
 * This script:
 * 1. Reads all MP3 files from the 4 audio folders
 * 2. Uploads them to Supabase Storage (word-cards/listening-audio/)
 * 3. Reads listening_questions.json
 * 4. Inserts questions into the listening_questions table with audio URLs
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://rtaltczlzccupsuzemcj.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_KEY) {
  console.error('ERROR: SUPABASE_SECRET_KEY environment variable required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const AUDIO_BASE = 'E:/VERI_K/Learning_Contents';
const AUDIO_FOLDERS = {
  'Listening_Sejong_Korean_1': 'sejong1_main',
  'Listening_Sejong_Korean_1_Practice': 'sejong1_practice',
  'Listening_Sejong_Korean_2': 'sejong2_main',
  'Listening_Sejong_Korean_2_Practice': 'sejong2_practice'
};

const STORAGE_BUCKET = 'word-cards';
const STORAGE_PREFIX = 'listening-audio';

// Map original filename → storage-safe English filename
function sanitizeFilename(originalName, folder) {
  // Remove Korean characters and special chars, keep track numbers
  const prefix = AUDIO_FOLDERS[folder];

  // For main textbook tracks: "세종한국어 1 TRACK 01.mp3" → "sejong1_main_track_01.mp3"
  const trackMatch = originalName.match(/TRACK\s*(\d+)\.mp3$/i);
  if (trackMatch) {
    return `${prefix}_track_${trackMatch[1].padStart(2, '0')}.mp3`;
  }

  // For practice tracks: "01. 1-1-(1).mp3" → "sejong1_practice_01_1-1-1.mp3"
  const practiceMatch = originalName.match(/^(\d+)\.\s*(.+)\.mp3$/);
  if (practiceMatch) {
    const num = practiceMatch[1].padStart(2, '0');
    const desc = practiceMatch[2].replace(/[()]/g, '').replace(/\s+/g, '_');
    return `${prefix}_${num}_${desc}.mp3`;
  }

  // Fallback
  return `${prefix}_${originalName.replace(/[^\w.-]/g, '_')}.mp3`;
}

async function uploadAllAudio() {
  console.log('📤 Starting audio upload to Supabase Storage...\n');

  const audioMap = {}; // originalFolder/originalFilename → public URL
  let totalUploaded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const [folder, prefix] of Object.entries(AUDIO_FOLDERS)) {
    const folderPath = path.join(AUDIO_BASE, folder);
    if (!fs.existsSync(folderPath)) {
      console.log(`⚠️  Folder not found: ${folderPath}`);
      continue;
    }

    const files = fs.readdirSync(folderPath)
      .filter(f => f.endsWith('.mp3'))
      .sort();

    console.log(`\n📁 ${folder} (${files.length} files)`);

    for (const file of files) {
      const filePath = path.join(folderPath, file);
      const storageName = sanitizeFilename(file, folder);
      const storagePath = `${STORAGE_PREFIX}/${prefix}/${storageName}`;
      const mapKey = `${folder}/${file}`;

      try {
        const fileBuffer = fs.readFileSync(filePath);

        const { error } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, fileBuffer, {
            contentType: 'audio/mpeg',
            upsert: true
          });

        if (error) {
          console.log(`  ❌ ${file}: ${error.message}`);
          totalErrors++;
          continue;
        }

        const { data: urlData } = supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(storagePath);

        audioMap[mapKey] = urlData.publicUrl;
        totalUploaded++;

        if (totalUploaded % 10 === 0) {
          console.log(`  ✅ ${totalUploaded} uploaded... (latest: ${storageName})`);
        }
      } catch (err) {
        console.log(`  ❌ ${file}: ${err.message}`);
        totalErrors++;
      }
    }
  }

  console.log(`\n📊 Upload summary: ${totalUploaded} uploaded, ${totalSkipped} skipped, ${totalErrors} errors`);

  // Save audio map for reference
  const mapPath = path.join(__dirname, '..', 'data', 'audio_url_map.json');
  fs.writeFileSync(mapPath, JSON.stringify(audioMap, null, 2));
  console.log(`\n💾 Audio URL map saved to ${mapPath}`);

  return audioMap;
}

async function insertQuestions(audioMap) {
  console.log('\n📝 Inserting listening questions into database...');

  const questionsPath = path.join(__dirname, '..', 'data', 'listening_questions.json');
  if (!fs.existsSync(questionsPath)) {
    console.error('❌ listening_questions.json not found!');
    return;
  }

  const questions = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));
  console.log(`  📋 Loaded ${questions.length} questions`);

  // Clear existing data
  const { error: delError } = await supabase
    .from('listening_questions')
    .delete()
    .gte('id', 0);

  if (delError) {
    console.log(`  ⚠️  Could not clear table: ${delError.message}`);
    // Try with neq approach
    await supabase
      .from('listening_questions')
      .delete()
      .neq('id', -1);
  }

  let inserted = 0;
  let errors = 0;

  // Insert in batches of 20
  for (let i = 0; i < questions.length; i += 20) {
    const batch = questions.slice(i, i + 20).map(q => {
      // Find audio URL from map
      const mapKey = `${q.audio_source}/${q.audio_filename}`;
      const audioUrl = audioMap[mapKey] || null;

      // Map to existing table schema:
      // day_number → day_assignment
      // question_type → book
      // transcript_kr → metadata JSON
      return {
        day_number: q.day_assignment,
        question_type: q.book,
        audio_url: audioUrl,
        transcript_kr: JSON.stringify({
          unit: q.unit,
          question_number: q.question_number,
          audio_filename: q.audio_filename,
          audio_source: q.audio_source
        }),
        question_text: q.question_text,
        option_a: q.option_a,
        option_b: q.option_b,
        option_c: q.option_c,
        option_d: q.option_d,
        correct_answer: q.correct_answer,
        is_approved: true
      };
    });

    const { data, error } = await supabase
      .from('listening_questions')
      .insert(batch)
      .select('id');

    if (error) {
      console.log(`  ❌ Batch ${i}-${i + batch.length}: ${error.message}`);
      errors += batch.length;
    } else {
      inserted += data.length;
    }
  }

  console.log(`\n✅ Inserted ${inserted} questions (${errors} errors)`);

  // Verify day distribution
  for (let day = 1; day <= 33; day++) {
    const { count } = await supabase
      .from('listening_questions')
      .select('id', { count: 'exact', head: true })
      .eq('day_number', day);

    if (day <= 5 || day >= 30) {
      console.log(`  Day ${day}: ${count} questions`);
    }
  }
}

async function main() {
  console.log('🎧 VERI-K Listening Quiz System Setup\n');
  console.log('=' .repeat(50));

  // Step 1: Upload audio files
  const audioMap = await uploadAllAudio();

  // Step 2: Insert questions
  await insertQuestions(audioMap);

  console.log('\n✅ Setup complete!');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
