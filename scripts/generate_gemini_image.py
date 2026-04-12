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
    '부사', 'adverb', 'Adverb',
}

# ── 안전 필터 우회를 위한 특수 단어 분류 ──
# Gemini가 FinishReason.NO_IMAGE로 거부하는 단어를 간접 표현으로 변환.
#
# 신체 부위: 눈, 코, 입, 배, 다리, 손, 발, 귀, 머리, 어깨, 목, 허리 등
_BODY_PART_WORDS = {
    '눈', '코', '입', '배', '다리', '손', '발', '귀', '머리',
    '어깨', '목', '허리', '무릎', '팔', '손가락', '발가락',
    '이', '이빨', '혀', '등', '가슴', '엉덩이', '얼굴',
}

# 감정/추상 개념
_EMOTION_WORDS = {
    '슬프다', '아프다', '기쁘다', '화나다', '무섭다', '외롭다',
    '행복하다', '걱정하다', '피곤하다', '졸리다', '부끄럽다',
    '심심하다', '놀라다', '사랑', '우울하다', '고통', '아픔',
    '슬픔', '기쁨', '화', '두려움', '외로움',
}

# 폭력/위험 연상 동사
_DANGER_VERBS = {
    '자르다', '싸우다', '때리다', '죽다', '죽이다', '부수다',
    '찌르다', '던지다', '넘어지다', '떨어지다', '다치다',
    '태우다', '폭발하다', '깨다', '깨뜨리다', '밀다',
    '쏘다', '치다', '물다', '잡다',
}

# 안전한 맥락을 제공하는 매핑 (특정 단어에 대해 명시적 장면 지정)
_SAFE_CONTEXT = {
    '자르다': 'cutting paper with scissors in a craft class',
    '싸우다': 'two cartoon characters having a friendly debate',
    '때리다': 'a child tapping a drum with drumsticks',
    '죽다':   'a wilting flower losing its petals',
    '태우다': 'roasting marshmallows at a campfire',
    '던지다': 'throwing a ball during a sports game',
    '깨다':   'an alarm clock ringing to wake someone up',
    '치다':   'playing a piano keyboard',
    '쏘다':   'shooting a basketball into a hoop',
    '물다':   'a puppy gently holding a toy in its mouth',
}


def _meaning_slot(korean: str, meaning_khmer: str) -> str:
    """동음이의어 구분을 위한 meaning 표현 (korean + Khmer)."""
    if meaning_khmer:
        return f'"{korean}" (Khmer meaning: {meaning_khmer})'
    return f'"{korean}"'


# 모든 프롬프트의 공통 prefix와 suffix
_EDU_PREFIX = (
    "Educational children's illustration for a Korean language learning app. "
)

_BASE_TAIL = (
    "Simple flat vector style, white background, Duolingo-style. "
    "No text, no letters, no words in the image. "
    "Clean minimal design, 512x512, child-friendly and safe."
)


def _detect_special_type(korean: str) -> str:
    """특수 카테고리를 감지: 'body_part', 'emotion', 'danger', 또는 None."""
    # 정확 일치 먼저
    if korean in _BODY_PART_WORDS:
        return 'body_part'
    if korean in _EMOTION_WORDS:
        return 'emotion'
    if korean in _DANGER_VERBS:
        return 'danger'
    # 형용사/동사의 어간 매칭 (다 제거)
    stem = korean.rstrip('다') if korean.endswith('다') else korean
    if stem and any(stem == w.rstrip('다') for w in _EMOTION_WORDS):
        return 'emotion'
    if stem and any(stem == w.rstrip('다') for w in _DANGER_VERBS):
        return 'danger'
    return ''


def build_prompt(korean: str, meaning_khmer: str, category: str = '') -> str:
    """카테고리(명사/동사/형용사)와 안전 필터 감지를 결합한 프롬프트 생성.
    동음이의어 처리는 korean + meaning_khmer 조합으로 수행 (DB에 영어 컬럼 없음).
    """
    meaning = _meaning_slot(korean, meaning_khmer)
    cat = (category or '').strip()
    special = _detect_special_type(korean)

    # ── 특수 처리가 필요한 단어 ──

    if special == 'body_part':
        return (
            f"{_EDU_PREFIX}"
            f"A friendly cartoon character cheerfully pointing to their "
            f"{meaning} (the body part). The character is simple, cute, "
            f"and child-friendly. {_BASE_TAIL} "
            f"Draw ONLY the body part that matches the Khmer meaning above."
        )

    if special == 'emotion':
        return (
            f"{_EDU_PREFIX}"
            f"A scene depicting the emotion or feeling of {meaning} "
            f"in a child-friendly educational context. Show a cute cartoon "
            f"character expressing this emotion with exaggerated facial "
            f"expressions. {_BASE_TAIL} "
            f"Draw ONLY the feeling that matches the Khmer meaning above."
        )

    if special == 'danger':
        safe_ctx = _SAFE_CONTEXT.get(korean, '')
        if safe_ctx:
            return (
                f"{_EDU_PREFIX}"
                f"A safe, child-friendly depiction of the action {meaning}, "
                f"shown as: {safe_ctx}. Cheerful, non-violent, educational "
                f"context. {_BASE_TAIL} "
                f"Draw ONLY the safe action that matches the Khmer meaning above."
            )
        return (
            f"{_EDU_PREFIX}"
            f"A safe, child-friendly depiction of the action {meaning}. "
            f"Show the action in a harmless, playful educational context "
            f"(e.g. classroom, playground, kitchen). {_BASE_TAIL} "
            f"Draw ONLY the action that matches the Khmer meaning above."
        )

    # ── 일반 카테고리별 분기 ──

    if cat in _VERB_CATEGORIES:
        return (
            f"{_EDU_PREFIX}"
            f"A simple flat vector illustration showing a person performing "
            f"the action of {meaning}, action-focused scene. {_BASE_TAIL} "
            f"Draw ONLY the action that matches the Khmer meaning above."
        )

    if cat in _ADJ_CATEGORIES:
        return (
            f"{_EDU_PREFIX}"
            f"A simple flat vector illustration visually demonstrating "
            f"the concept of {meaning}, using comparison or visual metaphor "
            f"to convey the state or quality. {_BASE_TAIL} "
            f"Draw ONLY the concept that matches the Khmer meaning above."
        )

    # 기본값: 명사
    return (
        f"{_EDU_PREFIX}"
        f"A simple flat vector illustration of {meaning}, centered. "
        f"{_BASE_TAIL} "
        f"Draw ONLY the object/place/person that matches the Khmer meaning above."
    )


# ─────────────────────────────────────────────────────────────────────
# Gemini 호출
# ─────────────────────────────────────────────────────────────────────
def _extract_image_from_response(response) -> bytes | None:
    """Gemini 응답에서 이미지 bytes를 추출. 없으면 None."""
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
            if isinstance(data, bytes):
                return data
            if isinstance(data, str):
                import base64
                return base64.b64decode(data)
    return None


def _diagnose_response(response) -> str:
    """이미지 없는 응답의 진단 정보를 문자열로."""
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
            diag_parts.append(f"cand[{i}].finish_reason={fr}")
            sr = getattr(c, 'safety_ratings', None)
            if sr:
                diag_parts.append(f"cand[{i}].safety={sr}")
            try:
                content = getattr(c, 'content', None)
                if content is not None:
                    parts = getattr(content, 'parts', None) or []
                    for j, p in enumerate(parts):
                        text = getattr(p, 'text', None)
                        if text:
                            diag_parts.append(f"cand[{i}].part[{j}].text={str(text)[:100]!r}")
            except Exception:
                pass
    except Exception as e:
        diag_parts.append(f"diag_error={e}")
    return ' | '.join(str(d) for d in diag_parts)[:600]


def _call_gemini(client, types, prompt: str):
    """Gemini API 단일 호출."""
    return client.models.generate_content(
        model=GEMINI_IMAGE_MODEL,
        contents=[prompt],
        config=types.GenerateContentConfig(
            response_modalities=['IMAGE'],
        ),
    )


# NO_IMAGE 안전 필터 거부 시 사용하는 ultra-safe 폴백 프롬프트
_FALLBACK_PROMPT = (
    "{edu_prefix}"
    "A very simple, cute, child-friendly icon representing the concept "
    "used in a Korean vocabulary flashcard for children aged 6-12. "
    "The concept is: {meaning}. "
    "Draw a cheerful, harmless, cartoon-style icon. "
    "Absolutely NO violence, NO scary elements, NO realistic anatomy. "
    "{base_tail}"
)


def generate_image_bytes(prompt: str, korean: str = '',
                         meaning_khmer: str = '') -> bytes:
    """google-genai SDK로 이미지 생성. NO_IMAGE 거부 시 safe 프롬프트로 1회 재시도."""
    client, types = _get_genai_client()

    # 1차 시도: 원래 프롬프트
    response = _call_gemini(client, types, prompt)
    img = _extract_image_from_response(response)
    if img:
        return img

    # 진단 로그
    diag = _diagnose_response(response)
    sys.stderr.write(
        f"  GEMINI attempt 1 failed ({korean}): {diag}\n"
    )

    # 2차 시도: ultra-safe 폴백 프롬프트
    meaning = _meaning_slot(korean, meaning_khmer) if korean else '(unknown)'
    safe_prompt = _FALLBACK_PROMPT.format(
        edu_prefix=_EDU_PREFIX, meaning=meaning, base_tail=_BASE_TAIL,
    )
    sys.stderr.write(f"  GEMINI retrying with safe fallback prompt ({korean})\n")

    import time
    time.sleep(1)  # rate-limit 대기
    response2 = _call_gemini(client, types, safe_prompt)
    img2 = _extract_image_from_response(response2)
    if img2:
        sys.stderr.write(f"  GEMINI fallback succeeded ({korean})\n")
        return img2

    diag2 = _diagnose_response(response2)
    sys.stderr.write(f"  GEMINI attempt 2 also failed ({korean}): {diag2}\n")
    raise RuntimeError(
        f"No image after 2 attempts (model={GEMINI_IMAGE_MODEL}). "
        f"attempt1: {diag[:200]} | attempt2: {diag2[:200]}"
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
    png = generate_image_bytes(prompt, korean=korean, meaning_khmer=meaning_khmer)

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
