#!/usr/bin/env python3
"""
Generate a single Korean vocabulary illustration via Gemini.

NOTE on the model:
  Text-only Flash variants (1.5 Flash, 2.0 Flash, etc.) cannot
  produce images. We use gemini-2.5-flash-image, the current stable
  Gemini image-generation model (free tier: ~500 images/day).
  The earlier preview alias gemini-2.0-flash-exp-image-generation
  has been retired and now returns 404.
  Override with the GEMINI_IMAGE_MODEL env var if needed.

Required env vars:
  GEMINI_API_KEY        - Google AI Studio API key
  SUPABASE_URL          - Supabase project URL
  SUPABASE_KEY (or SUPABASE_SECRET_KEY) - service role key for upload+update

CLI usage:
  python generate_gemini_image.py <word_id> <day> <sort_order> <korean> <meaning_khmer> <category>

This script also exposes functions used by batch_generate_images.py.
"""
import os
import sys
import json
import re
import requests

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
GEMINI_IMAGE_MODEL = os.environ.get(
    'GEMINI_IMAGE_MODEL',
    'gemini-2.5-flash-image'
)

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', os.environ.get('SUPABASE_SECRET_KEY', ''))

# google-generativeai는 lazy import — SDK가 없어도 모듈 import는 가능해야
# storage 함수와 build_prompt를 다른 곳에서 재사용할 수 있다.
_genai = None

def _get_genai():
    global _genai
    if _genai is None:
        import google.generativeai as genai  # noqa: WPS433
        if GEMINI_API_KEY:
            genai.configure(api_key=GEMINI_API_KEY)
        _genai = genai
    return _genai


# ─────────────────────────────────────────────────────────────────────
# 프롬프트
# ─────────────────────────────────────────────────────────────────────
_NOUN_CATEGORIES = {'명사', 'noun', 'Noun', 'NOUN'}
_VERB_CATEGORIES = {'동사', 'verb', 'Verb', 'VERB'}
_ADJ_CATEGORIES = {
    '형용사', 'adjective', 'Adjective', 'ADJECTIVE',
    '부사', 'adverb', 'Adverb',  # adverbs use the same visual-metaphor approach
}

# 단어의 영어 의미를 표현하기 위한 슬롯. DB에 영어 컬럼이 없으므로
# Korean + Khmer를 함께 넣어 Gemini가 의미를 추론하게 한다. 동음이의어
# (배=ship/stomach/pear, 눈=eye/snow 등)는 Khmer 뜻이 결정 기준이 된다.
def _meaning_slot(korean: str, meaning_khmer: str) -> str:
    if meaning_khmer:
        return f'"{korean}" (Khmer meaning: {meaning_khmer})'
    return f'"{korean}"'


_BASE_TAIL = (
    "on white background, Duolingo style, no text, no labels, "
    "clean minimal design, 512x512"
)


def build_prompt(korean: str, meaning_khmer: str, category: str = '') -> str:
    """카테고리(명사/동사/형용사)에 따라 다른 프롬프트 템플릿을 적용한다.
    동음이의어 처리는 korean + meaning_khmer 조합으로 수행 (DB에 영어 컬럼 없음).
    """
    meaning = _meaning_slot(korean, meaning_khmer)
    cat = (category or '').strip()

    if cat in _VERB_CATEGORIES:
        # 동사: 사람이 그 행동을 하고 있는 장면
        return (
            f"A simple flat vector illustration showing a person performing "
            f"the action of {meaning}, action-focused scene, {_BASE_TAIL}. "
            f"Draw ONLY the action that matches the Khmer meaning above."
        )

    if cat in _ADJ_CATEGORIES:
        # 형용사/부사: 상태나 비교를 시각적 메타포로
        return (
            f"A simple flat vector illustration visually demonstrating "
            f"the concept of {meaning}, using comparison or visual metaphor "
            f"to convey the state or quality, {_BASE_TAIL}. "
            f"Draw ONLY the concept that matches the Khmer meaning above."
        )

    # 기본값: 명사 (사물/장소/사람 자체를 명확하게)
    return (
        f"A simple flat vector illustration of {meaning}, centered "
        f"{_BASE_TAIL}. Draw ONLY the object/place/person that matches "
        f"the Khmer meaning above."
    )


# ─────────────────────────────────────────────────────────────────────
# Gemini 호출
# ─────────────────────────────────────────────────────────────────────
def generate_image_bytes(prompt: str) -> bytes:
    """Gemini SDK로 이미지 생성. PNG bytes 반환."""
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not set")

    genai = _get_genai()
    model = genai.GenerativeModel(GEMINI_IMAGE_MODEL)
    response = model.generate_content(
        contents=prompt,
        generation_config={'response_modalities': ['TEXT', 'IMAGE']}
    )

    # 응답에서 inline_data(이미지 part)를 찾는다
    for cand in getattr(response, 'candidates', []) or []:
        content = getattr(cand, 'content', None)
        if not content:
            continue
        for part in getattr(content, 'parts', []) or []:
            inline = getattr(part, 'inline_data', None)
            if inline is None:
                continue
            data = getattr(inline, 'data', None)
            if not data:
                continue
            # SDK는 보통 bytes를 반환하지만 일부 버전은 base64 string을 반환할 수 있음
            if isinstance(data, bytes):
                return data
            if isinstance(data, str):
                import base64
                return base64.b64decode(data)
    raise RuntimeError(
        "No image part in Gemini response (model may not support image output)"
    )


# ─────────────────────────────────────────────────────────────────────
# Supabase Storage / DB
# ─────────────────────────────────────────────────────────────────────
_SAFE_CHARS = re.compile(r'[^0-9A-Za-z._\-가-힣]')

def sanitize_path_segment(s: str) -> str:
    """Supabase Storage 경로에 안전한 문자만 남김 (한글은 보존)."""
    cleaned = _SAFE_CHARS.sub('_', s)
    return cleaned or 'word'


def storage_path_for(day_number: int, sort_order: int, korean: str) -> str:
    safe = sanitize_path_segment(korean)
    return f"illustrations/{day_number}_{sort_order}_{safe}.png"


def public_url_for(storage_path: str) -> str:
    return f"{SUPABASE_URL}/storage/v1/object/public/word-cards/{storage_path}"


def upload_to_storage(png_bytes: bytes, storage_path: str) -> bool:
    """word-cards 버킷에 PNG 업로드 (upsert)."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL or SUPABASE_KEY is missing")

    url = f"{SUPABASE_URL}/storage/v1/object/word-cards/{storage_path}"
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'image/png',
        'x-upsert': 'true',
    }
    r = requests.post(url, headers=headers, data=png_bytes, timeout=60)
    return r.status_code in (200, 201)


def update_word_image_url(word_id: str, image_url: str) -> bool:
    """words.image_url 업데이트. RLS/0-row 차단을 검증."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False

    url = f"{SUPABASE_URL}/rest/v1/words?id=eq.{word_id}&select=id,image_url"
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
    }
    try:
        r = requests.patch(
            url, headers=headers, json={'image_url': image_url}, timeout=10
        )
        if r.status_code not in (200, 201):
            return False
        rows = r.json()
        return isinstance(rows, list) and len(rows) > 0
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────────────
# 한 단어 처리
# ─────────────────────────────────────────────────────────────────────
def generate_one(word_id: str, day_number: int, sort_order: int,
                 korean: str, meaning_khmer: str = '', category: str = '') -> str:
    """한 단어 → 생성 → 업로드 → DB 갱신. 성공 시 public URL 반환."""
    prompt = build_prompt(korean, meaning_khmer, category)
    png = generate_image_bytes(prompt)

    storage_path = storage_path_for(day_number, sort_order, korean)
    if not upload_to_storage(png, storage_path):
        raise RuntimeError("storage upload failed")

    public_url = public_url_for(storage_path)
    if not update_word_image_url(word_id, public_url):
        raise RuntimeError("DB image_url update failed")

    return public_url


# ─────────────────────────────────────────────────────────────────────
# CLI (단일 단어)
# ─────────────────────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 5:
        print(
            "Usage: generate_gemini_image.py <word_id> <day> <sort_order> "
            "<korean> [meaning_khmer] [category]",
            file=sys.stderr
        )
        sys.exit(1)

    word_id = sys.argv[1]
    day = int(sys.argv[2])
    sort_order = int(sys.argv[3])
    korean = sys.argv[4]
    meaning_khmer = sys.argv[5] if len(sys.argv) > 5 else ''
    category = sys.argv[6] if len(sys.argv) > 6 else ''

    try:
        url = generate_one(word_id, day, sort_order, korean, meaning_khmer, category)
        print(json.dumps({'ok': True, 'korean': korean, 'url': url}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'ok': False, 'korean': korean, 'error': str(e)[:300]}, ensure_ascii=False))
        sys.exit(2)


if __name__ == '__main__':
    main()
