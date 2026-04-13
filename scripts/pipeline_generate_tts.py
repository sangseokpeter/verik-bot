#!/usr/bin/env python3
"""
VERI-K Pipeline: Generate TTS audio for all 1,207 words.
- Word pronunciation TTS (OpenAI tts-1, nova, speed 0.75)
- Example sentence TTS
- Uploads to Supabase Storage audio/day{N}/{id}.mp3 and audio/example/day{N}/{id}.mp3
- Updates words.audio_url and words.example_audio_url

Usage:
  python pipeline_generate_tts.py [--start-day N] [--end-day N]

Env vars:
  OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY
"""
import os, sys, json, time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', os.environ.get('SUPABASE_SECRET_KEY', ''))
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY', '')
SUPABASE_BUCKET = os.environ.get('SUPABASE_BUCKET', 'word-cards')


def emit(event):
    print(json.dumps(event, ensure_ascii=False), flush=True)


def fetch_words():
    import requests
    url = f"{SUPABASE_URL}/rest/v1/words?select=id,day_number,sort_order,korean,example_kr&order=day_number.asc,sort_order.asc&limit=2000"
    headers = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
    r = requests.get(url, headers=headers, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"Fetch failed: {r.status_code}")
    return r.json()


def generate_tts(text, speed=0.75):
    """Generate TTS audio bytes using OpenAI API."""
    import requests
    r = requests.post(
        'https://api.openai.com/v1/audio/speech',
        headers={
            'Authorization': f'Bearer {OPENAI_API_KEY}',
            'Content-Type': 'application/json',
        },
        json={
            'model': 'tts-1',
            'voice': 'nova',
            'input': text,
            'speed': speed,
            'response_format': 'mp3',
        },
        timeout=30,
    )
    if r.status_code != 200:
        raise RuntimeError(f"TTS API error: {r.status_code} {r.text[:200]}")
    return r.content


def upload_audio(mp3_bytes, storage_path):
    """Upload MP3 to Supabase Storage."""
    import requests
    url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{storage_path}"
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'audio/mpeg',
        'x-upsert': 'true',
    }
    r = requests.post(url, headers=headers, data=mp3_bytes, timeout=60)
    return r.status_code in (200, 201)


def update_word_urls(word_id, audio_url=None, example_audio_url=None):
    """Update audio URLs in words table."""
    import requests
    updates = {}
    if audio_url:
        updates['audio_url'] = audio_url
    if example_audio_url:
        updates['example_audio_url'] = example_audio_url
    if not updates:
        return

    url = f"{SUPABASE_URL}/rest/v1/words?id=eq.{word_id}"
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
    }
    requests.patch(url, headers=headers, json=updates, timeout=10)


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--start-day', type=int, default=1)
    parser.add_argument('--end-day', type=int, default=35)
    args = parser.parse_args()

    if not OPENAI_API_KEY:
        emit({'type': 'config_error', 'message': 'OPENAI_API_KEY not set'})
        sys.exit(1)
    if not SUPABASE_URL or not SUPABASE_KEY:
        emit({'type': 'config_error', 'message': 'SUPABASE_URL or KEY not set'})
        sys.exit(1)

    words = fetch_words()
    words = [w for w in words if args.start_day <= w['day_number'] <= args.end_day]

    if not words:
        emit({'type': 'no_words'})
        sys.exit(0)

    total = len(words)
    ok = 0
    failed = 0
    emit({'type': 'start', 'total': total, 'task': 'tts'})

    for i, w in enumerate(words):
        word_id = w['id']
        day = w['day_number']
        korean = w['korean']
        example = w.get('example_kr', '')

        try:
            # Word TTS
            word_mp3 = generate_tts(korean, speed=0.75)
            word_path = f"audio/day{day}/{word_id}.mp3"
            if not upload_audio(word_mp3, word_path):
                raise RuntimeError("Word audio upload failed")
            word_url = f"{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_BUCKET}/{word_path}"

            # Example TTS
            example_url = None
            if example:
                ex_mp3 = generate_tts(example, speed=0.6)
                ex_path = f"audio/example/day{day}/{word_id}.mp3"
                if upload_audio(ex_mp3, ex_path):
                    example_url = f"{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_BUCKET}/{ex_path}"

            # Update DB
            update_word_urls(word_id, audio_url=word_url, example_audio_url=example_url)

            ok += 1
            emit({
                'type': 'tts_ok', 'sort': i + 1, 'total': total,
                'korean': korean, 'has_example': bool(example_url)
            })

        except Exception as e:
            failed += 1
            emit({
                'type': 'fail', 'sort': i + 1, 'total': total,
                'korean': korean, 'reason': str(e)[:200]
            })

        # Progress report every 50
        if (i + 1) % 50 == 0:
            emit({'type': 'progress', 'current': i + 1, 'total': total, 'ok': ok, 'failed': failed})

        # Small delay to avoid rate limits
        time.sleep(0.2)

    emit({'type': 'done', 'total': total, 'ok': ok, 'failed': failed, 'task': 'tts'})


if __name__ == '__main__':
    main()
