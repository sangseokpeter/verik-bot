/**
 * Insert listening questions into Supabase DB
 * Reads listening_questions.json + audio_url_map.json
 * Maps audio URLs and inserts into listening_questions table
 *
 * Usage: SUPABASE_SECRET_KEY=xxx node scripts/insert_listening_questions.js
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

async function main() {
  console.log('📝 Inserting listening questions into database...\n');

  // Load questions
  const questionsPath = path.join(__dirname, '..', 'data', 'listening_questions.json');
  const questions = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));
  console.log(`Loaded ${questions.length} questions`);

  // Load audio URL map
  const audioMapPath = path.join(__dirname, '..', 'data', 'audio_url_map.json');
  let audioMap = {};
  if (fs.existsSync(audioMapPath)) {
    audioMap = JSON.parse(fs.readFileSync(audioMapPath, 'utf8'));
    console.log(`Loaded ${Object.keys(audioMap).length} audio URLs`);
  } else {
    console.log('⚠️  audio_url_map.json not found. Inserting without audio URLs.');
  }

  // Clear existing questions
  const { error: delError } = await supabase
    .from('listening_questions')
    .delete()
    .neq('id', -1);

  if (delError) {
    console.log(`Warning: Could not clear table: ${delError.message}`);
  } else {
    console.log('Cleared existing data');
  }

  // Map questions to DB schema
  let withAudio = 0;
  let withoutAudio = 0;

  const dbRows = questions.map(q => {
    // Find audio URL from map
    const mapKey = `${q.audio_source}/${q.audio_filename}`;
    const audioUrl = audioMap[mapKey] || null;

    if (audioUrl) withAudio++;
    else withoutAudio++;

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

  console.log(`\nAudio mapping: ${withAudio} with URL, ${withoutAudio} without`);

  // Insert in batches of 25
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < dbRows.length; i += 25) {
    const batch = dbRows.slice(i, i + 25);

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

  console.log(`\n✅ Inserted: ${inserted}, Errors: ${errors}`);

  // Verify
  const { count } = await supabase
    .from('listening_questions')
    .select('id', { count: 'exact', head: true });

  console.log(`\n📊 Total questions in DB: ${count}`);

  // Show day distribution
  for (let day = 1; day <= 33; day++) {
    const { count: dayCount } = await supabase
      .from('listening_questions')
      .select('id', { count: 'exact', head: true })
      .eq('day_number', day);

    if (dayCount !== 5) {
      console.log(`  ⚠️  Day ${day}: ${dayCount} questions (expected 5)`);
    }
  }

  console.log('\n✅ Done!');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
