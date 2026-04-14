#!/usr/bin/env python3
"""
VERI-K Pipeline: Generate illustrations for all 1,207 words.
- Reads prompts from data/prompts_1207.json (matched by korean)
- prompt_type "illustration": Gemini API image generation
- prompt_type "typography": Colored typography card
- Uploads to Supabase Storage illustrations/{day}_{sortOrder}.png
- Reports progress every 50 words to stdout (JSON events for Node.js)

Usage:
  python pipeline_generate_all.py [--start-day N] [--end-day N]

Env vars:
  GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY
"""
import os, sys, json, time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)

from generate_gemini_image import (
    generate_image_bytes, upload_to_storage, storage_path_for,
    public_url_for, update_word_image_url, _EDU_PREFIX, _BASE_TAIL,
    _FALLBACK_PROMPT, _meaning_slot
)

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', os.environ.get('SUPABASE_SECRET_KEY', ''))

# ── Typography card generation (for abstract/grammar words) ──
CATEGORY_COLORS = {
    '명사': '#3B82F6',
    '동사': '#EF4444',
    '형용사': '#F59E0B',
    '부사': '#8B5CF6',
    '대명사': '#06B6D4',
    '수사': '#10B981',
    '접속사': '#EC4899',
    '문법': '#6366F1',
    '인사': '#14B8A6',
    '어미': '#A855F7',
    '의존명사': '#0EA5E9',
    '관형사': '#F97316',
    '문장': '#64748B',
}

def generate_typography_card(korean, category, meaning_khmer):
    """Generate a simple typography-based card image."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        sys.stderr.write("  PIL not available, skipping typography card\n")
        return None

    W, H = 512, 512
    bg_color = CATEGORY_COLORS.get(category, '#6366F1')
    img = Image.new('RGB', (W, H), bg_color)
    draw = ImageDraw.Draw(img)

    # Try to load fonts
    font_dir = os.path.join(ROOT_DIR, 'fonts')
    kr_bold = None
    kh_font = None
    for name in ['NotoSansKR-Bold.ttf', 'NotoSansCJK-Bold.ttc']:
        path = os.path.join(font_dir, name)
        if os.path.exists(path):
            try:
                kr_bold = ImageFont.truetype(path, 80)
                break
            except:
                pass
    for name in ['Battambang-Bold.ttf', 'NotoSansKhmer-Regular.ttf']:
        path = os.path.join(font_dir, name)
        if os.path.exists(path):
            try:
                kh_font = ImageFont.truetype(path, 28)
                break
            except:
                pass

    if not kr_bold:
        kr_bold = ImageFont.load_default()
    if not kh_font:
        kh_font = ImageFont.load_default()

    # Category badge
    cat_font = kr_bold.font_variant(size=22) if hasattr(kr_bold, 'font_variant') else kr_bold
    try:
        cat_font = ImageFont.truetype(kr_bold.path, 22)
    except:
        cat_font = ImageFont.load_default()

    # Draw white rounded area
    margin = 40
    draw.rounded_rectangle(
        (margin, margin, W - margin, H - margin),
        radius=24, fill='#FFFFFF'
    )

    # Korean text centered
    bbox = draw.textbbox((0, 0), korean, font=kr_bold)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = (W - tw) // 2
    y = 160
    draw.text((x, y), korean, fill=bg_color, font=kr_bold)

    # Khmer meaning below
    bbox2 = draw.textbbox((0, 0), meaning_khmer, font=kh_font)
    tw2 = bbox2[2] - bbox2[0]
    x2 = (W - tw2) // 2
    draw.text((x2, y + th + 30), meaning_khmer, fill='#666666', font=kh_font)

    # Category tag at top
    draw.text((W // 2 - 30, margin + 20), category, fill='#999999', font=cat_font)

    # Export as PNG bytes
    import io
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    return buf.getvalue()


def emit(event):
    """Emit JSON event to stdout for Node.js consumption."""
    print(json.dumps(event, ensure_ascii=False), flush=True)


def fetch_words():
    """Fetch all words from Supabase, paginating to bypass 1000-row PostgREST limit."""
    import requests as req
    base_url = f"{SUPABASE_URL}/rest/v1/words?select=id,day_number,sort_order,korean,meaning_khmer,category&order=day_number.asc,sort_order.asc"
    all_rows = []
    page_size = 500
    offset = 0
    while True:
        headers = {
            'apikey': SUPABASE_KEY,
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'Range': f'{offset}-{offset + page_size - 1}'
        }
        r = req.get(base_url, headers=headers, timeout=30)
        if r.status_code not in (200, 206):
            raise RuntimeError(f"Supabase fetch failed: {r.status_code} {r.text[:200]}")
        rows = r.json()
        if not isinstance(rows, list) or len(rows) == 0:
            break
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    return all_rows


def load_prompts():
    """Load prompts from data/prompts_1207.json, keyed by korean."""
    path = os.path.join(ROOT_DIR, 'data', 'prompts_1207.json')
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return {w['korean']: w for w in data}


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--start-day', type=int, default=1)
    parser.add_argument('--end-day', type=int, default=35)
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        emit({'type': 'config_error', 'message': 'SUPABASE_URL or KEY not set'})
        sys.exit(1)

    # Fetch words and prompts
    words = fetch_words()
    prompts = load_prompts()

    # Filter by day range
    words = [w for w in words if args.start_day <= w['day_number'] <= args.end_day]

    if not words:
        emit({'type': 'no_words'})
        sys.exit(0)

    total = len(words)
    ok = 0
    failed = 0
    skipped = 0

    emit({'type': 'start', 'total': total, 'day_range': f'{args.start_day}-{args.end_day}'})

    for i, w in enumerate(words):
        word_id = w['id']
        day = w['day_number']
        sort = w['sort_order']
        korean = w['korean']
        meaning = w.get('meaning_khmer', '')
        category = w.get('category', '')
        prompt_data = prompts.get(korean, {})
        prompt_type = prompt_data.get('prompt_type', 'illustration')
        prompt_text = prompt_data.get('prompt', '')

        storage_path = storage_path_for(day, sort)

        try:
            if prompt_type == 'typography':
                png_bytes = generate_typography_card(korean, category, meaning)
                if not png_bytes:
                    raise RuntimeError("Typography generation failed (no PIL)")
            else:
                # Use custom prompt from prompts_1207.json if available
                if prompt_text:
                    png_bytes = generate_image_bytes(prompt_text, korean=korean, meaning_khmer=meaning)
                else:
                    # Fallback to auto-generated prompt
                    from generate_gemini_image import build_prompt
                    auto_prompt = build_prompt(korean, meaning, category)
                    png_bytes = generate_image_bytes(auto_prompt, korean=korean, meaning_khmer=meaning)

            # Upload to storage
            if not upload_to_storage(png_bytes, storage_path):
                raise RuntimeError("Storage upload failed")

            # Update DB
            pub_url = public_url_for(storage_path)
            update_word_image_url(str(word_id), pub_url)

            ok += 1
            emit({
                'type': 'img', 'sort': i + 1, 'total': total,
                'korean': korean, 'meaning_khmer': meaning,
                'url': pub_url, 'prompt_type': prompt_type
            })

        except Exception as e:
            failed += 1
            emit({
                'type': 'fail', 'sort': i + 1, 'total': total,
                'korean': korean, 'reason': str(e)[:200]
            })

        # Progress report every 50
        if (i + 1) % 50 == 0:
            emit({
                'type': 'progress', 'current': i + 1, 'total': total,
                'ok': ok, 'failed': failed
            })

        # Rate limit: 1 second between Gemini calls
        if prompt_type != 'typography' and i < len(words) - 1:
            time.sleep(1)

    emit({
        'type': 'done', 'total': total,
        'ok': ok, 'failed': failed, 'skipped': skipped
    })


if __name__ == '__main__':
    main()
