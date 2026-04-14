/**
 * Setup listening_questions table in Supabase
 * Drops existing table and recreates with new schema
 *
 * Usage: node scripts/setup_listening_table.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function setupTable() {
  console.log('🔧 Setting up listening_questions table...');

  // Drop existing tables (listening_answers depends on listening_questions)
  const { error: dropAnswers } = await supabase.rpc('exec_sql', {
    sql: 'DROP TABLE IF EXISTS listening_answers CASCADE;'
  }).single();

  const { error: dropQuestions } = await supabase.rpc('exec_sql', {
    sql: 'DROP TABLE IF EXISTS listening_questions CASCADE;'
  }).single();

  // Create new listening_questions table
  const createSQL = `
    CREATE TABLE listening_questions (
      id SERIAL PRIMARY KEY,
      book TEXT NOT NULL,
      unit INT NOT NULL,
      question_number INT NOT NULL,
      audio_filename TEXT NOT NULL,
      audio_url TEXT,
      question_text TEXT NOT NULL,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      option_d TEXT NOT NULL,
      correct_answer TEXT NOT NULL CHECK (correct_answer IN ('A', 'B', 'C', 'D')),
      day_assignment INT NOT NULL CHECK (day_assignment BETWEEN 1 AND 33),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX idx_listening_day ON listening_questions(day_assignment);
    CREATE INDEX idx_listening_book_unit ON listening_questions(book, unit);
  `;

  const { error: createError } = await supabase.rpc('exec_sql', {
    sql: createSQL
  }).single();

  if (createError) {
    console.log('⚠️  RPC not available, using REST API approach...');
    // Fallback: use direct table operations
    await setupViaRest();
    return;
  }

  // Recreate listening_answers table
  const createAnswersSQL = `
    CREATE TABLE listening_answers (
      id SERIAL PRIMARY KEY,
      student_id BIGINT REFERENCES students(id),
      question_id INT REFERENCES listening_questions(id),
      student_answer TEXT NOT NULL,
      is_correct BOOLEAN NOT NULL,
      answered_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  await supabase.rpc('exec_sql', { sql: createAnswersSQL }).single();

  console.log('✅ Tables created successfully!');
}

async function setupViaRest() {
  // Since we can't run raw SQL via Supabase JS client,
  // we'll use the REST API directly
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  const sql = `
    DROP TABLE IF EXISTS listening_answers CASCADE;
    DROP TABLE IF EXISTS listening_questions CASCADE;

    CREATE TABLE listening_questions (
      id SERIAL PRIMARY KEY,
      book TEXT NOT NULL,
      unit INT NOT NULL,
      question_number INT NOT NULL,
      audio_filename TEXT NOT NULL,
      audio_url TEXT,
      question_text TEXT NOT NULL,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      option_d TEXT NOT NULL,
      correct_answer TEXT NOT NULL,
      day_assignment INT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX idx_listening_day ON listening_questions(day_assignment);
    CREATE INDEX idx_listening_book_unit ON listening_questions(book, unit);

    CREATE TABLE listening_answers (
      id SERIAL PRIMARY KEY,
      student_id BIGINT REFERENCES students(id),
      question_id INT REFERENCES listening_questions(id),
      student_answer TEXT NOT NULL,
      is_correct BOOLEAN NOT NULL,
      answered_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  const response = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql })
  });

  if (!response.ok) {
    console.log('⚠️  Direct SQL not available. Please run the following SQL in Supabase Dashboard:');
    console.log(sql);
    console.log('\n📋 Copy the SQL above and run it at:');
    console.log(`${url.replace('.supabase.co', '')}/project/rtaltczlzccupsuzemcj/sql`);

    // Try alternative: insert a test row to see if table exists with right schema
    const { error: testError } = await supabase
      .from('listening_questions')
      .select('id')
      .limit(1);

    if (testError && testError.message.includes('does not exist')) {
      console.log('\n❌ Table does not exist. Please create it via Supabase Dashboard SQL editor.');
      process.exit(1);
    } else if (!testError) {
      console.log('\n✅ listening_questions table already exists. Checking schema...');
      // Check if it has the right columns by trying a dummy query
      const { error: schemaError } = await supabase
        .from('listening_questions')
        .select('id, book, unit, question_number, audio_filename, audio_url, question_text, option_a, option_b, option_c, option_d, correct_answer, day_assignment')
        .limit(0);

      if (schemaError) {
        console.log('⚠️  Table exists but schema mismatch. Please run the SQL above to recreate.');
        process.exit(1);
      } else {
        console.log('✅ Table schema looks correct!');
      }
    }
  } else {
    console.log('✅ Tables created successfully via SQL!');
  }
}

setupTable().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
