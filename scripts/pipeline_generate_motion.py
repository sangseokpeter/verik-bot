#!/usr/bin/env python3
"""
VERI-K Pipeline: Generate motion card MP4s for all 1,207 words.
- Reuses V.02 Premium Gold design from generate_motion_card.py
- Downloads illustration from Supabase Storage
- Generates MP4 with animation sequence:
    0.0s: illustration fade-in
    0.6s: korean word + pronunciation (+ TTS audio)
    1.8s: khmer meaning
    3.0s: example sentence with highlight
- Target: ~85KB per MP4
- Uploads to Supabase Storage videos/day{N}/{id}.mp4

Usage:
  python pipeline_generate_motion.py [--start-day N] [--end-day N]

Env vars:
  SUPABASE_URL, SUPABASE_SECRET_KEY
"""
import os, sys, json, time, tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', os.environ.get('SUPABASE_SECRET_KEY', ''))
SUPABASE_BUCKET = os.environ.get('SUPABASE_BUCKET', 'word-cards')


def emit(event):
    print(json.dumps(event, ensure_ascii=False), flush=True)


def fetch_words():
    import requests
    url = (
        f"{SUPABASE_URL}/rest/v1/words?"
        f"select=id,day_number,sort_order,korean,pronunciation,meaning_khmer,category,example_kr,example_khmer,audio_url,example_audio_url,image_url"
        f"&order=day_number.asc,sort_order.asc&limit=2000"
    )
    headers = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
    r = requests.get(url, headers=headers, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"Fetch failed: {r.status_code}")
    return r.json()


def upload_video(mp4_bytes, storage_path):
    import requests
    url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{storage_path}"
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'video/mp4',
        'x-upsert': 'true',
    }
    r = requests.post(url, headers=headers, data=mp4_bytes, timeout=120)
    return r.status_code in (200, 201)


def update_video_url(word_id, video_url):
    import requests
    url = f"{SUPABASE_URL}/rest/v1/words?id=eq.{word_id}"
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
    }
    requests.patch(url, headers=headers, json={'video_url': video_url}, timeout=10)


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--start-day', type=int, default=1)
    parser.add_argument('--end-day', type=int, default=35)
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        emit({'type': 'config_error', 'message': 'SUPABASE_URL or KEY not set'})
        sys.exit(1)

    # Import motion card generator (reuse existing V.02 design)
    try:
        from generate_motion_card import generate_single_card
    except ImportError as e:
        emit({'type': 'config_error', 'message': f'Cannot import generate_motion_card: {e}'})
        sys.exit(1)

    words = fetch_words()
    words = [w for w in words if args.start_day <= w['day_number'] <= args.end_day]

    if not words:
        emit({'type': 'no_words'})
        sys.exit(0)

    total = len(words)
    ok = 0
    failed = 0
    emit({'type': 'start', 'total': total, 'task': 'motion'})

    for i, w in enumerate(words):
        word_id = w['id']
        day = w['day_number']
        sort = w['sort_order']
        korean = w['korean']

        try:
            # Build word_data dict matching generate_single_card expectations
            word_data = {
                'korean': korean,
                'pronunciation': w.get('pronunciation', f'[{korean}]'),
                'meaning_khmer': w.get('meaning_khmer', ''),
                'example_kr': w.get('example_kr', ''),
                'example_khmer': w.get('example_khmer', ''),
                'category': w.get('category', ''),
                'audio_url': w.get('audio_url', ''),
                'example_audio_url': w.get('example_audio_url', ''),
            }

            # Load emoji/illustration maps
            emoji_map_path = os.path.join(ROOT_DIR, 'data', 'emoji_mapping_by_row.json')
            illust_map_path = os.path.join(ROOT_DIR, 'data', 'illustration_source_map.json')
            with open(emoji_map_path, 'r', encoding='utf-8') as f:
                emoji_map = json.load(f)
            with open(illust_map_path, 'r', encoding='utf-8') as f:
                illust_map = json.load(f)

            key = f"{day}_{sort}"
            emoji_str = emoji_map.get(key, '')
            custom_path = illust_map.get(key, None)

            output_path = os.path.join(tempfile.gettempdir(), f'motion_{word_id}.mp4')
            success = generate_single_card(word_data, day, emoji_str, custom_path, SUPABASE_URL, output_path)

            if not success or not os.path.exists(output_path):
                raise RuntimeError("Motion card generation returned empty")

            with open(output_path, 'rb') as f:
                mp4_bytes = f.read()
            try:
                os.remove(output_path)
            except:
                pass

            # Upload
            video_path = f"videos/day{day}/{word_id}.mp4"
            if not upload_video(mp4_bytes, video_path):
                raise RuntimeError("Video upload failed")

            video_url = f"{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_BUCKET}/{video_path}"
            update_video_url(word_id, video_url)

            ok += 1
            size_kb = len(mp4_bytes) / 1024
            emit({
                'type': 'motion_ok', 'sort': i + 1, 'total': total,
                'korean': korean, 'size_kb': round(size_kb, 1)
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

    emit({'type': 'done', 'total': total, 'ok': ok, 'failed': failed, 'task': 'motion'})


if __name__ == '__main__':
    main()
