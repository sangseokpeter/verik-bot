#!/usr/bin/env python3
"""
Generate a single Korean vocabulary illustration via Gemini.

SDK:
  Uses google-genai (the current official Google GenAI SDK).
  The older google-generativeai package was deprecated upstream.

Model:
  Text-only Flash variants (1.5 Flash, 2.0 Flash, etc.) cannot
  produce images. We use gemini-2.5-flash-image, the current stable
  Gemini image-generation model (free tier: ~500 images/day).
  Override with the GEMINI_IMAGE_MODEL env var if needed.

Required env vars:
  GEMINI_API_KEY        - Google AI Studio API key
  SUPABASE_URL          - Supabase project URL
  SUPABASE_KEY (or SUPABASE_SECRET_KEY) - service role key for upload+update
  SUPABASE_BUCKET       - optional, defaults to 'word-cards'

CLI usage:
  python generate_gemini_image.py <word_id> <day> <sort_order> <korean> [meaning_khmer] [category]

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

# google-genai (new official SDK) — lazy import so the module can still
# be imported (for storage helpers / build_prompt) even when the SDK
# isn't installed locally.
_genai_client = None
_genai_types = None

def _get_genai_client():
    """Return (client, types) for the google-genai SDK, lazily initialized."""
    global _genai_client, _genai_types
    if _genai_client is None:
        from google import genai  # noqa: WPS433
        from google.genai import types as genai_types  # noqa: WPS433
        if not GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY is not set")
        _genai_client = genai.Client(api_key=GEMINI_API_KEY)
        _genai_types = genai_types
    return _genai_client, _genai_types


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
    """google-genai SDK로 이미지 생성. PNG bytes 반환."""
    client, types = _get_genai_client()

    response = client.models.generate_content(
        model=GEMINI_IMAGE_MODEL,
        contents=[prompt],
        config=types.GenerateContentConfig(
            response_modalities=['IMAGE'],
        ),
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

    # 이미지 part가 없을 때 응답 구조를 stderr로 덤프해서 진단 가능하게 한다
    diag_parts = []
    try:
        pf = getattr(response, 'prompt_feedback', None)
        if pf is not None:
            diag_parts.append(f"prompt_feedback={pf}")
    except Exception:
        pass
    try:
        cands = getattr(response, 'candidates', None) or []
        diag_parts.append(f"candidates={len(cands)}")
        for i, c in enumerate(cands):
            fr = getattr(c, 'finish_reason', None)
            sr = getattr(c, 'safety_ratings', None)
            diag_parts.append(f"cand[{i}].finish_reason={fr}")
            if sr:
                diag_parts.append(f"cand[{i}].safety_ratings={sr}")
            try:
                content = getattr(c, 'content', None)
                if content is not None:
                    parts = getattr(content, 'parts', None) or []
                    diag_parts.append(f"cand[{i}].parts={len(parts)}")
                    for j, p in enumerate(parts):
                        text = getattr(p, 'text', None)
                        if text:
                            diag_parts.append(f"cand[{i}].part[{j}].text={str(text)[:120]!r}")
                        keys = [k for k in dir(p) if not k.startswith('_')]
                        diag_parts.append(f"cand[{i}].part[{j}].attrs={keys[:8]}")
            except Exception:
                pass
    except Exception as e:
        diag_parts.append(f"diag_error={e}")

    diag = ' | '.join(str(d) for d in diag_parts)[:600]
    sys.stderr.write(f"  GEMINI no-image response diagnostics: {diag}\n")
    raise RuntimeError(
        f"No image part in Gemini response (model={GEMINI_IMAGE_MODEL}). {diag}"[:500]
    )


# ─────────────────────────────────────────────────────────────────────
# Supabase Storage / DB
# ─────────────────────────────────────────────────────────────────────
_SAFE_CHARS = re.compile(r'[^0-9A-Za-z._\-]')

def sanitize_path_segment(s: str) -> str:
    """Supabase Storage 경로에 안전한 ASCII 문자만 남김.
    Supabase Storage는 한글/유니코드 파일명을 허용하지 않으므로
    영문/숫자/언더스코어/하이픈/점 외 문자는 모두 _로 치환한다."""
    cleaned = _SAFE_CHARS.sub('_', s)
    return cleaned or 'word'


def storage_path_for(day_number: int, sort_order: int, korean: str = '') -> str:
    """Storage 파일 경로. Supabase가 한글 파일명을 거부하므로 day/sort_order만 사용.
    korean 인자는 호환을 위해 남겨두지만 경로에는 포함하지 않는다."""
    return f"illustrations/{day_number}_{sort_order}.png"


def public_url_for(storage_path: str) -> str:
    return f"{SUPABASE_URL}/storage/v1/object/public/word-cards/{storage_path}"


SUPABASE_BUCKET = os.environ.get('SUPABASE_BUCKET', 'word-cards')


def upload_to_storage(png_bytes: bytes, storage_path: str) -> bool:
    """Storage 버킷에 PNG 업로드 (upsert).
    실패 시 bucket / path / status / body를 stderr에 자세히 로그한다."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL or SUPABASE_KEY is missing")

    bucket = SUPABASE_BUCKET
    url = f"{SUPABASE_URL}/storage/v1/object/{bucket}/{storage_path}"
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'image/png',
        'x-upsert': 'true',
    }

    sys.stderr.write(
        f"  STORAGE upload bucket={bucket} path={storage_path} "
        f"bytes={len(png_bytes)}\n"
    )

    try:
        r = requests.post(url, headers=headers, data=png_bytes, timeout=60)
    except requests.exceptions.RequestException as e:
        sys.stderr.write(
            f"  STORAGE upload network error bucket={bucket} path={storage_path} "
            f"err={type(e).__name__}: {str(e)[:200]}\n"
        )
        return False

    if r.status_code in (200, 201):
        sys.stderr.write(f"  STORAGE upload OK status={r.status_code}\n")
        return True

    body = (r.text or '')[:300]
    sys.stderr.write(
        f"  STORAGE upload FAILED bucket={bucket} path={storage_path} "
        f"status={r.status_code} body={body}\n"
    )
    return False


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
