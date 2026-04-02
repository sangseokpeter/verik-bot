#!/usr/bin/env python3
"""
Batch generate ALL 35 days of motion card videos.
Reads from Supabase DB, generates MP4s, uploads to Supabase Storage.
"""
import os, sys, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_motion_card import generate_single_card

import requests

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Supabase config - try env vars first, fallback to hardcoded
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://rtaltczlzccupsuzemcj.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', os.environ.get('SUPABASE_SECRET_KEY', ''))

def load_json(filename):
    path = os.path.join(ROOT_DIR, 'data', filename)
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def fetch_words(day_number=None):
    url = f'{SUPABASE_URL}/rest/v1/words'
    params = 'select=*&order=day_number,sort_order'
    if day_number:
        params += f'&day_number=eq.{day_number}'
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Range': '0-9999'
    }
    r = requests.get(f'{url}?{params}', headers=headers, timeout=30)
    return r.json()

def upload_to_storage(filepath, storage_path):
    url = f'{SUPABASE_URL}/storage/v1/object/word-cards/{storage_path}'
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'video/mp4',
        'x-upsert': 'true'
    }
    with open(filepath, 'rb') as f:
        r = requests.post(url, headers=headers, data=f.read(), timeout=60)
    return r.status_code in (200, 201)

def update_video_url(word_id, video_url):
    url = f'{SUPABASE_URL}/rest/v1/words?id=eq.{word_id}'
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    }
    requests.patch(url, headers=headers, json={'video_url': video_url}, timeout=10)

def main():
    target_day = int(sys.argv[1]) if len(sys.argv) > 1 else None

    emoji_map = load_json('emoji_mapping_by_row.json')
    illust_map = load_json('illustration_source_map.json')

    if target_day:
        words = fetch_words(target_day)
        days = [target_day]
    else:
        words = fetch_words()
        days = sorted(set(w['day_number'] for w in words))

    total = len(words)
    done = 0
    errors = 0

    print(f"=== Generating {total} motion cards for Day {days[0]}~{days[-1]} ===")
    print(f"SUPABASE_URL: {SUPABASE_URL}")
    print(f"SUPABASE_KEY: {'set' if SUPABASE_KEY else 'MISSING!'}")
    print()

    for word in words:
        day = word['day_number']
        sort = word.get('sort_order', 0)
        korean = word['korean']
        wid = word['id']
        key = f"{day}_{sort}"

        emoji_str = emoji_map.get(key, '')
        custom_path = illust_map.get(key, None)

        tmp_dir = os.path.join(ROOT_DIR, '.tmp_motion')
        os.makedirs(tmp_dir, exist_ok=True)
        output_path = os.path.join(tmp_dir, f'motion_{key}.mp4')
        storage_path = f'videos/day{day}/{wid}.mp4'

        word_data = {
            'korean': korean,
            'pronunciation': word.get('pronunciation', f'[{korean}]'),
            'meaning_khmer': word.get('meaning_khmer', ''),
            'example_kr': word.get('example_kr', ''),
            'example_khmer': word.get('example_khmer', ''),
            'category': word.get('category', ''),
            'audio_url': word.get('audio_url', ''),
            'example_audio_url': word.get('example_audio_url', ''),
        }

        ok = False
        for attempt in range(3):
            try:
                success = generate_single_card(word_data, day, emoji_str, custom_path, SUPABASE_URL, output_path)

                if success and os.path.exists(output_path):
                    uploaded = upload_to_storage(output_path, storage_path)
                    if uploaded:
                        public_url = f'{SUPABASE_URL}/storage/v1/object/public/word-cards/{storage_path}'
                        update_video_url(wid, public_url)
                        done += 1
                        ok = True
                    else:
                        print(f"  UPLOAD FAIL: {key} {korean} (attempt {attempt+1})")
                    try:
                        os.remove(output_path)
                    except:
                        pass
                else:
                    print(f"  GENERATE FAIL: {key} {korean} (attempt {attempt+1})")

                if ok:
                    break
            except Exception as e:
                print(f"  RETRY {attempt+1}/3 {key} {korean}: {str(e)[:60]}")
                time.sleep(2)

        if not ok:
            errors += 1
            print(f"  FAILED: {key} {korean}")

        if (done + errors) % 10 == 0:
            print(f"  Progress: {done+errors}/{total} (ok={done} err={errors})")

    print(f"\n=== DONE: {done}/{total} success, {errors} errors ===")

if __name__ == '__main__':
    main()
