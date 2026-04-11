#!/usr/bin/env python3
"""
Batch generate Gemini illustrations for one Day.

Behavior:
  - Fetches all words for the given day from Supabase
  - Skips words that already have image_url set (unless --force)
  - For each remaining word: generate via Gemini → upload → DB update
  - Emits JSON-line events on stdout for the Node.js parent to consume
  - Optionally restricts to a single Korean word (for /redo_image)

Event protocol (each line is one JSON object):
  {"type":"start","day":N,"total":M,"to_generate":K}
  {"type":"img","sort":S,"total":M,"korean":"...","meaning_khmer":"...","url":"..."}
  {"type":"skip","sort":S,"total":M,"korean":"...","reason":"already_exists"}
  {"type":"fail","sort":S,"total":M,"korean":"...","reason":"..."}
  {"type":"done","ok":K,"skipped":S,"failed":F,"total":M}
  {"type":"no_words","day":N}
  {"type":"config_error","message":"..."}

CLI usage:
  python batch_generate_images.py <day> [korean_filter] [--force]
"""
import os
import sys
import json
import time
import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_gemini_image import (
    build_prompt,
    generate_image_bytes,
    upload_to_storage,
    update_word_image_url,
    storage_path_for,
    public_url_for,
    GEMINI_API_KEY,
)

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', os.environ.get('SUPABASE_SECRET_KEY', ''))


def emit(event: dict):
    print(json.dumps(event, ensure_ascii=False), flush=True)


def fetch_words(day_number: int):
    url = (
        f'{SUPABASE_URL}/rest/v1/words'
        f'?day_number=eq.{day_number}&order=sort_order'
    )
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Range': '0-9999',
    }
    r = requests.get(url, headers=headers, timeout=30)
    if not r.ok:
        return []
    return r.json()


def has_existing_image(w: dict) -> bool:
    url = w.get('image_url')
    return bool(url) and url != 'skip'


def main():
    args = sys.argv[1:]
    if not args:
        emit({'type': 'config_error', 'message': 'missing day argument'})
        sys.exit(1)

    if not GEMINI_API_KEY:
        emit({'type': 'config_error', 'message': 'GEMINI_API_KEY not set'})
        sys.exit(1)
    if not SUPABASE_URL or not SUPABASE_KEY:
        emit({'type': 'config_error', 'message': 'SUPABASE_URL or SUPABASE_KEY not set'})
        sys.exit(1)

    force = '--force' in args
    args = [a for a in args if a != '--force']

    try:
        day = int(args[0])
    except ValueError:
        emit({'type': 'config_error', 'message': f'invalid day: {args[0]!r}'})
        sys.exit(1)

    korean_filter = args[1] if len(args) > 1 else None

    words = fetch_words(day)
    if korean_filter:
        words = [w for w in words if w.get('korean') == korean_filter]

    if not words:
        emit({'type': 'no_words', 'day': day})
        sys.exit(0)

    total = len(words)
    to_generate = words if (force or korean_filter) else [w for w in words if not has_existing_image(w)]

    emit({
        'type': 'start',
        'day': day,
        'total': total,
        'to_generate': len(to_generate),
    })

    ok = 0
    skipped = 0
    failed = 0

    for w in words:
        sort_order = w.get('sort_order', 0)
        korean = w.get('korean', '?')
        meaning_khmer = w.get('meaning_khmer', '')
        category = w.get('category', '')
        wid = w.get('id')

        # Skip if already has image (and not forced/filtered)
        if not force and not korean_filter and has_existing_image(w):
            skipped += 1
            emit({
                'type': 'skip',
                'sort': sort_order,
                'total': total,
                'korean': korean,
                'meaning_khmer': meaning_khmer,
                'reason': 'already_exists',
                'url': w.get('image_url', ''),
            })
            continue

        if not wid:
            failed += 1
            emit({
                'type': 'fail',
                'sort': sort_order,
                'total': total,
                'korean': korean,
                'reason': 'missing word id',
            })
            continue

        prompt = build_prompt(korean, meaning_khmer, category)

        try:
            png = generate_image_bytes(prompt)
        except Exception as e:
            failed += 1
            emit({
                'type': 'fail',
                'sort': sort_order,
                'total': total,
                'korean': korean,
                'meaning_khmer': meaning_khmer,
                'reason': f'gemini: {str(e)[:200]}',
            })
            time.sleep(1)
            continue

        sp = storage_path_for(day, sort_order, korean)
        if not upload_to_storage(png, sp):
            failed += 1
            emit({
                'type': 'fail',
                'sort': sort_order,
                'total': total,
                'korean': korean,
                'meaning_khmer': meaning_khmer,
                'reason': 'storage upload failed',
            })
            continue

        public_url = public_url_for(sp)
        if not update_word_image_url(wid, public_url):
            failed += 1
            emit({
                'type': 'fail',
                'sort': sort_order,
                'total': total,
                'korean': korean,
                'meaning_khmer': meaning_khmer,
                'reason': 'DB image_url update failed',
            })
            continue

        ok += 1
        emit({
            'type': 'img',
            'sort': sort_order,
            'total': total,
            'korean': korean,
            'meaning_khmer': meaning_khmer,
            'url': public_url,
        })
        # 짧은 대기로 rate-limit 회피
        time.sleep(0.3)

    emit({
        'type': 'done',
        'ok': ok,
        'skipped': skipped,
        'failed': failed,
        'total': total,
    })


if __name__ == '__main__':
    main()
