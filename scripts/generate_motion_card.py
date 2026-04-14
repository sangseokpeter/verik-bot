#!/usr/bin/env python3
"""
VERI-K Motion Card Generator - V.02 Gold Premium Design
Generates 5-second MP4 motion cards for vocabulary words.
"""
import os, sys, json, math, struct, wave, subprocess, shutil, tempfile
from PIL import Image, ImageDraw, ImageFont
try:
    import requests
except ImportError:
    import urllib.request as requests

# === DESIGN CONFIG ===
W = 760
BORDER = 8
GOLD_DARK = "#8B7535"
GOLD_LIGHT = "#C5A94E"
GOLD_BADGE = "#B8983F"
CARD_INNER = "#FAF4E4"
ILLUST_BG = "#F0EBD8"
WHITE_BOX = "#FFFFFF"
TEXT_DARK = "#3A3530"
TEXT_KHMER = "#A0522D"
HIGHLIGHT_BG = "#F0C8B0"
TEXT_GRAY = "#888888"
FPS = 30
DURATION = 8.0

# === FONT PATHS ===
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
FONT_DIR = os.path.join(ROOT_DIR, 'fonts')

def find_font(names):
    paths = []
    for name in names:
        paths.append(os.path.join(FONT_DIR, name))
    paths.extend([
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/truetype/noto/NotoSansKhmer-Bold.ttf',
        '/usr/share/fonts/truetype/noto/NotoSansKhmer-Regular.ttf',
    ])
    for p in paths:
        if os.path.exists(p):
            return p
    return None

KR_BOLD = find_font(['NotoSansKR-Bold.ttf', 'NotoSansCJK-Bold.ttc'])
KR_REG = find_font(['NotoSansKR-Regular.ttf', 'NotoSansCJK-Regular.ttc'])
# 크메르어: Battambang 우선 (Bold → Regular), 없으면 NotoSansKhmer 폴백
KH_BOLD = find_font(['Battambang-Bold.ttf', 'Battambang-Regular.ttf', 'NotoSansKhmer-Regular.ttf', 'NotoSansKhmer-Bold.ttf'])
if KH_BOLD:
    print(f"  Khmer font loaded: {KH_BOLD}", file=sys.stderr)
else:
    print("  WARNING: No Khmer font found! Battambang/NotoSansKhmer missing.", file=sys.stderr)

# Check if ImageMagick can find Battambang font
try:
    _im_result = subprocess.run(['convert', '-list', 'font'], capture_output=True, timeout=10)
    _im_fonts = _im_result.stdout.decode('utf-8', 'replace')
    _battambang_lines = [l.strip() for l in _im_fonts.split('\n') if 'battambang' in l.lower() or 'Battambang' in l]
    if _battambang_lines:
        print(f"  ImageMagick Battambang fonts: {_battambang_lines}", file=sys.stderr)
    else:
        print(f"  WARNING: ImageMagick does NOT list any Battambang font! (convert -list font has {len(_im_fonts.split(chr(10)))} lines)", file=sys.stderr)
except Exception as _e:
    print(f"  ImageMagick font list check failed: {_e}", file=sys.stderr)

def load_font(path, size):
    try:
        if path:
            return ImageFont.truetype(path, size)
    except:
        pass
    return ImageFont.load_default()

def _imagemagick_render_khmer(text, font_path, font_size, fill_color, max_width=None):
    """Render Khmer text to a transparent PNG using ImageMagick (Pango/HarfBuzz).
    Returns a Pillow RGBA Image of the rendered text."""
    if not text or not text.strip():
        return Image.new('RGBA', (1, 1), (0,0,0,0))

    # Convert fill color to ImageMagick format
    if isinstance(fill_color, tuple):
        fill_color = '#{:02x}{:02x}{:02x}'.format(*fill_color[:3])

    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
        tmp_path = tmp.name

    try:
        # Use pango: instead of label: for proper Khmer complex script shaping
        # Extract font family name from path for Pango markup
        font_basename = os.path.basename(font_path).replace('.ttf', '').replace('.otf', '')
        # Map known font files to Pango font family names
        font_family_map = {
            'Battambang-Bold': 'Battambang Bold',
            'Battambang-Regular': 'Battambang',
            'Battambang': 'Battambang',
        }
        pango_font = font_family_map.get(font_basename, 'Battambang Bold')

        # Escape XML special chars for Pango markup
        escaped_text = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        pango_markup = f"<span font='{pango_font} {font_size}' foreground='{fill_color}'>{escaped_text}</span>"

        cmd = [
            'convert',
            '-background', 'none',
            '-gravity', 'NorthWest',
        ]
        if max_width:
            cmd.extend(['-size', f'{max_width}x'])
        cmd.extend([f'pango:{pango_markup}', tmp_path])

        result = subprocess.run(cmd, capture_output=True, timeout=10)
        if result.returncode != 0:
            err = result.stderr.decode('utf-8', 'replace')[:300]
            print(f"  ImageMagick error: {err}", file=sys.stderr)
            # Fallback: render with Pillow (may be imperfect for Khmer)
            return None

        if os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 0:
            img = Image.open(tmp_path).convert('RGBA')
            return img
    except Exception as e:
        print(f"  ImageMagick exception: {e}", file=sys.stderr)
    finally:
        try:
            os.unlink(tmp_path)
        except:
            pass
    return None

def draw_khmer_text(target_img, xy, text, fill, font):
    """Draw Khmer text using ImageMagick for proper complex script rendering.
    Falls back to Pillow if ImageMagick fails."""
    font_path = font.path if hasattr(font, 'path') else KH_BOLD
    font_size = font.size if hasattr(font, 'size') else 52

    print(f"  [draw_khmer_text] text={repr(text)}, font={font_path}, size={font_size}, xy={xy}", file=sys.stderr)
    rendered = _imagemagick_render_khmer(text, font_path, font_size, fill)
    if rendered:
        print(f"  [draw_khmer_text] ImageMagick SUCCESS: {rendered.size[0]}x{rendered.size[1]}px", file=sys.stderr)
        target_img.paste(rendered, xy, rendered)
    else:
        print(f"  [draw_khmer_text] ImageMagick FAILED — falling back to Pillow", file=sys.stderr)
        # Fallback to Pillow
        draw = ImageDraw.Draw(target_img)
        draw.text(xy, text, fill=fill, font=font)

def khmer_text_size(text, font):
    """Get Khmer text width and height using ImageMagick.
    Returns (width, height) tuple."""
    font_path = font.path if hasattr(font, 'path') else KH_BOLD
    font_size = font.size if hasattr(font, 'size') else 52

    rendered = _imagemagick_render_khmer(text, font_path, font_size, '#000000')
    if rendered:
        return rendered.size
    # Fallback to Pillow
    tmp_img = Image.new('RGBA', (1, 1))
    draw = ImageDraw.Draw(tmp_img)
    bbox = draw.textbbox((0, 0), text, font=font)
    return (bbox[2] - bbox[0], bbox[3] - bbox[1])

FONTS = {}
def get_fonts():
    global FONTS
    if not FONTS:
        FONTS = {
            'word': load_font(KR_BOLD, 72),
            'pron': load_font(KR_REG, 26),
            'badge': load_font(KR_BOLD, 22),
            'sm': load_font(KR_BOLD, 18),
            'label': load_font(KR_REG, 18),
            'ex': load_font(KR_REG, 36),
            'khmer_big': load_font(KH_BOLD, 52),
            'khmer_ex': load_font(KH_BOLD, 36),
        }
    return FONTS

# === HANGUL JAMO DECOMPOSITION & STROKE ANIMATION ===
CHOSEONG = list('ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ')
JUNGSEONG = list('ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ')
JONGSEONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ']

def decompose_hangul_char(ch):
    """Decompose a Hangul syllable into jamo components."""
    code = ord(ch)
    if 0xAC00 <= code <= 0xD7A3:
        offset = code - 0xAC00
        cho = offset // (21 * 28)
        jung = (offset % (21 * 28)) // 28
        jong = offset % 28
        parts = [CHOSEONG[cho], JUNGSEONG[jung]]
        if jong > 0:
            parts.append(JONGSEONG[jong])
        return parts
    return [ch]

def compose_hangul(cho_idx, jung_idx, jong_idx=0):
    """Compose jamo indices back into a Hangul syllable character."""
    return chr(0xAC00 + (cho_idx * 21 + jung_idx) * 28 + jong_idx)

def get_jamo_steps(korean):
    """Progressive jamo build-up steps for stroke animation.
    '한글' -> ['ㅎ','하','한','한ㄱ','한그','한글']
    """
    steps = []
    completed = ''
    for ch in korean:
        parts = decompose_hangul_char(ch)
        if len(parts) >= 2 and parts[0] in CHOSEONG and parts[1] in JUNGSEONG:
            cho_idx = CHOSEONG.index(parts[0])
            jung_idx = JUNGSEONG.index(parts[1])
            steps.append(completed + parts[0])
            steps.append(completed + compose_hangul(cho_idx, jung_idx))
            if len(parts) == 3 and parts[2] in JONGSEONG:
                jong_idx = JONGSEONG.index(parts[2])
                steps.append(completed + compose_hangul(cho_idx, jung_idx, jong_idx))
        else:
            steps.append(completed + ch)
        completed += ch
    return steps

STROKE_H = 120  # Height for stroke animation area (below illustration)

def prerender_stroke_steps(korean, area_w):
    """Pre-render all jamo construction step images for the stroke animation.
    Renders in a compact strip (area_w x STROKE_H) without dots or labels."""
    steps = get_jamo_steps(korean)
    area_h = STROKE_H
    if not steps:
        img = Image.new('RGBA', (area_w, area_h), (0,0,0,0))
        ImageDraw.Draw(img).rounded_rectangle((0,0,area_w-1,area_h-1), radius=14, fill='#F8F4E8')
        return [img]

    font_stroke = load_font(KR_BOLD, 72)

    # Pre-calculate final word bounding box for ghost outline positioning
    tmp_img = Image.new('RGBA', (area_w, area_h))
    tmp_draw = ImageDraw.Draw(tmp_img)
    ghost_bb = tmp_draw.textbbox((0,0), korean, font=font_stroke)
    ghost_tw = ghost_bb[2] - ghost_bb[0]
    ghost_th = ghost_bb[3] - ghost_bb[1]
    gx = (area_w - ghost_tw) // 2
    gy = (area_h - ghost_th) // 2

    rendered = []
    for idx, step_text in enumerate(steps):
        img = Image.new('RGBA', (area_w, area_h), (0,0,0,0))
        draw = ImageDraw.Draw(img)
        draw.rounded_rectangle((0,0,area_w-1,area_h-1), radius=14, fill='#F8F4E8', outline='#E0D8C8', width=1)

        # Ghost outline of final word (faint)
        draw.text((gx, gy), korean, fill=(210,205,190,80), font=font_stroke)

        # Current construction state (solid)
        draw.text((gx, gy), step_text, fill=(58,53,48,255), font=font_stroke)

        rendered.append(img)
    return rendered

# === TWEMOJI ===
TWEMOJI_CACHE = os.path.join(ROOT_DIR, '.twemoji_cache')

def emoji_to_codepoints(emoji_str):
    cps = []
    for ch in emoji_str:
        cp = ord(ch)
        if cp in (0xFE0F, 0x200D):
            continue
        cps.append(f'{cp:x}')
    return '-'.join(cps)

def get_twemoji_image(emoji_str, size=280):
    os.makedirs(TWEMOJI_CACHE, exist_ok=True)
    fname = emoji_to_codepoints(emoji_str) + '.png'
    cached = os.path.join(TWEMOJI_CACHE, fname)

    if not os.path.exists(cached) or os.path.getsize(cached) < 100:
        # Try multiple CDN sources
        urls = [
            f'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/{fname}',
            f'https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/{fname}',
            f'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/{fname}',
        ]
        for url in urls:
            try:
                if hasattr(requests, 'get'):
                    r = requests.get(url, timeout=8)
                    if r.status_code == 200 and len(r.content) > 100:
                        with open(cached, 'wb') as f:
                            f.write(r.content)
                        break
                else:
                    requests.urlretrieve(url, cached)
                    if os.path.exists(cached) and os.path.getsize(cached) > 100:
                        break
            except:
                continue

    if os.path.exists(cached) and os.path.getsize(cached) > 100:
        try:
            img = Image.open(cached).convert('RGBA').resize((size, size), Image.LANCZOS)
            return img
        except:
            pass
    return None

def get_custom_image(supabase_path, supabase_url, size=280):
    os.makedirs(TWEMOJI_CACHE, exist_ok=True)
    fname = supabase_path.replace('/', '_')
    cached = os.path.join(TWEMOJI_CACHE, fname)

    if not os.path.exists(cached):
        url = f'{supabase_url}/storage/v1/object/public/word-cards/{supabase_path}'
        try:
            if hasattr(requests, 'get'):
                r = requests.get(url, timeout=10)
                if r.status_code == 200:
                    with open(cached, 'wb') as f:
                        f.write(r.content)
            else:
                requests.urlretrieve(url, cached)
        except:
            return None

    if os.path.exists(cached) and os.path.getsize(cached) > 100:
        try:
            img = Image.open(cached).convert('RGBA').resize((size, size), Image.LANCZOS)
            return img
        except:
            pass
    return None

# === CARD COMPONENTS ===

def create_base_card(day_number, card_h, brand_y):
    fonts = get_fonts()
    img = Image.new('RGB', (W, card_h), '#F5EDDA')
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((4, 4, W-4, card_h-4), radius=20, outline="#6B5A28", width=6)
    draw.rounded_rectangle((BORDER, BORDER, W-BORDER, card_h-BORDER), radius=18, fill=CARD_INNER, outline=GOLD_DARK, width=4)
    draw.rounded_rectangle((BORDER+8, BORDER+8, W-BORDER-8, card_h-BORDER-8), radius=14, outline=GOLD_LIGHT, width=1)

    badge_w, badge_h = 120, 42
    bx = (W - badge_w) // 2
    by = BORDER - 4
    draw.rounded_rectangle((bx, by, bx+badge_w, by+badge_h), radius=6, fill=GOLD_BADGE, outline=GOLD_DARK, width=2)
    day_text = f"Day {day_number}"
    bbox = draw.textbbox((0,0), day_text, font=fonts['badge'])
    tw = bbox[2] - bbox[0]
    draw.text((bx + (badge_w-tw)//2, by+8), day_text, fill="#FFFFFF", font=fonts['badge'])

    # VERI-K 브랜드 (균등 분배 위치)
    brand_text = "VERI-K"
    bb = draw.textbbox((0,0), brand_text, font=fonts['sm'])
    brand_tw = bb[2] - bb[0]
    draw.text(((W - brand_tw)//2, brand_y), brand_text, fill=GOLD_LIGHT, font=fonts['sm'])
    return img

def create_illustration(emoji_str, korean, category, custom_path, supabase_url):
    area_w, area_h = W - 60, 320
    img = Image.new('RGBA', (area_w, area_h), (0,0,0,0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((0,0,area_w,area_h), radius=14, fill=ILLUST_BG)

    illustration = None

    if custom_path and supabase_url:
        illustration = get_custom_image(custom_path, supabase_url)

    if not illustration and emoji_str and not emoji_str.startswith('CUSTOM:'):
        illustration = get_twemoji_image(emoji_str)

    if illustration:
        x = (area_w - illustration.size[0]) // 2
        y = (area_h - illustration.size[1]) // 2
        img.paste(illustration, (x, y), illustration)
        return img

    colors = {'명사': ('#FF8A65','#FF5722'), '동사': ('#42A5F5','#1565C0'), '형용사': ('#AB47BC','#7B1FA2')}
    c1, c2 = colors.get(category, ('#78909C','#455A64'))
    for y in range(area_h):
        r = int(int(c1[1:3],16) + (int(c2[1:3],16)-int(c1[1:3],16))*y/area_h)
        g = int(int(c1[3:5],16) + (int(c2[3:5],16)-int(c1[3:5],16))*y/area_h)
        b = int(int(c1[5:7],16) + (int(c2[5:7],16)-int(c1[5:7],16))*y/area_h)
        draw.line([(0,y),(area_w,y)], fill=(r,g,b,255))
    font = load_font(KR_BOLD, 80)
    bbox = draw.textbbox((0,0), korean, font=font)
    tw = bbox[2]-bbox[0]
    draw.text(((area_w-tw)//2, 110), korean, fill=(255,255,255,240), font=font)
    return img

def clean_khmer_text(text):
    """Clean Khmer text: URL-decode, remove stray + signs, and normalize."""
    if not text:
        return text
    # URL-decode (e.g. %E1%9E%80 -> Khmer chars, + -> space)
    try:
        from urllib.parse import unquote_plus
        text = unquote_plus(text)
    except Exception:
        pass
    # Remove any remaining stray + signs
    text = text.replace('+', ' ').strip()
    # Collapse multiple spaces
    while '  ' in text:
        text = text.replace('  ', ' ')
    return text

def create_word_section(korean, pronunciation, khmer):
    fonts = get_fonts()
    khmer = clean_khmer_text(khmer)

    # Explicitly load Battambang for Khmer rendering
    khmer_font_big = fonts['khmer_big']
    print(f"  Khmer font (big): {khmer_font_big.path if hasattr(khmer_font_big, 'path') else 'default'}", file=sys.stderr)

    pron_y = 95
    khmer_y = 160
    section_h = 240

    img = Image.new('RGBA', (W-60, section_h), (0,0,0,0))
    draw = ImageDraw.Draw(img)
    area_w = img.size[0]

    bbox = draw.textbbox((0,0), korean, font=fonts['word'])
    tw = bbox[2]-bbox[0]
    draw.text(((area_w-tw)//2, 0), korean, fill=TEXT_DARK, font=fonts['word'])

    bbox2 = draw.textbbox((0,0), pronunciation, font=fonts['pron'])
    tw2 = bbox2[2]-bbox2[0]
    draw.text(((area_w-tw2)//2, pron_y), pronunciation, fill=TEXT_GRAY, font=fonts['pron'])

    tw3, _ = khmer_text_size(khmer, khmer_font_big)
    draw_khmer_text(img, ((area_w-tw3)//2, khmer_y), khmer, fill=TEXT_KHMER, font=khmer_font_big)
    return img

def find_highlight_span(example_kr, keyword):
    """예문에서 하이라이트할 구간(start, end)을 찾는다.
    1) 정확 일치
    2) 동사/형용사(~다로 끝남): 어간 + 뒤에 붙은 어미까지 매칭
    3) 키워드 첫 음절 매칭 (마지막 폴백)
    """
    if not example_kr or not keyword:
        return None
    # 1) 정확 일치
    idx = example_kr.find(keyword)
    if idx >= 0:
        return (idx, idx + len(keyword))
    # 2) 동사/형용사: '다'로 끝나면 어간으로 검색
    if keyword.endswith('다') and len(keyword) > 1:
        stem = keyword[:-1]  # '가다'→'가', '먹다'→'먹'
        idx = example_kr.find(stem)
        if idx >= 0:
            end = idx + len(stem)
            # 어간 뒤의 활용형(구두점/공백 전까지) 포함
            while end < len(example_kr) and example_kr[end] not in ' .,!?\n。':
                end += 1
            return (idx, end)
    # 3) 첫 음절만 매칭 (최후의 폴백)
    if len(keyword) >= 1:
        idx = example_kr.find(keyword[0])
        if idx >= 0:
            end = idx + 1
            while end < len(example_kr) and example_kr[end] not in ' .,!?\n。':
                end += 1
            return (idx, end)
    return None

def create_example_section(example_kr, example_khmer, keyword):
    fonts = get_fonts()
    box_w, box_h = W-80, 180
    print(f"  [create_example_section] example_kr={repr(example_kr)}", file=sys.stderr)
    print(f"  [create_example_section] example_khmer={repr(example_khmer)}", file=sys.stderr)
    print(f"  [create_example_section] keyword={repr(keyword)}", file=sys.stderr)
    img = Image.new('RGBA', (box_w, box_h), (0,0,0,0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((0,0,box_w,box_h), radius=12, fill=WHITE_BOX, outline="#E0D8C8", width=1)
    draw.text((18,12), "Example", fill="#777777", font=fonts['label'])

    span = find_highlight_span(example_kr, keyword) if example_kr else None

    if span:
        before = example_kr[:span[0]]
        matched = example_kr[span[0]:span[1]]
        after = example_kr[span[1]:]

        # 너비 계산 (원점 기준)
        before_w = draw.textbbox((0,0), before, font=fonts['ex'])[2] if before else 0
        matched_bb = draw.textbbox((0,0), matched, font=fonts['ex'])
        matched_w = matched_bb[2] - matched_bb[0]
        matched_h = matched_bb[3] - matched_bb[1]

        # 앞쪽 텍스트 (키워드 앞) 그리기
        if before:
            draw.text((20, 55), before, fill=TEXT_DARK, font=fonts['ex'])

        # 하이라이트 박스 + 키워드
        hl_x = 20 + before_w
        draw.rounded_rectangle(
            (hl_x - 6, 52, hl_x + matched_w + 6, 52 + matched_h + 10),
            radius=6, fill=HIGHLIGHT_BG
        )
        draw.text((hl_x, 55), matched, fill=TEXT_DARK, font=fonts['ex'])

        # 뒤쪽 텍스트
        if after:
            draw.text((hl_x + matched_w, 55), after, fill=TEXT_DARK, font=fonts['ex'])
    else:
        draw.text((20,55), example_kr or "", fill=TEXT_DARK, font=fonts['ex'])

    cleaned_khmer = clean_khmer_text(example_khmer) or ""
    print(f"  [create_example_section] cleaned_khmer={repr(cleaned_khmer)}, len={len(cleaned_khmer)}", file=sys.stderr)
    if cleaned_khmer:
        print(f"  [create_example_section] codepoints: {' '.join(f'U+{ord(c):04X}' for c in cleaned_khmer)}", file=sys.stderr)
    draw_khmer_text(img, (18,110), cleaned_khmer, fill=TEXT_KHMER, font=fonts['khmer_ex'])
    return img

# === ANIMATION ===

def generate_frames(base, illust, word_sec, example_sec, output_dir, layout=None, stroke_steps=None):
    if layout is None:
        layout = {'illust_y': 60, 'stroke_y': 400, 'word_y': 540, 'ex_y': 790}
    illust_y = layout['illust_y']
    stroke_y = layout['stroke_y']
    word_y = layout['word_y']
    ex_y = layout['ex_y']

    n = int(DURATION * FPS)
    os.makedirs(output_dir, exist_ok=True)
    num_steps = len(stroke_steps) if stroke_steps else 0

    for i in range(n):
        t = i/FPS
        frame = base.copy()

        # Phase 1: Illustration (0s ~ end, fade in 0~0.4s, persist until card ends)
        a = min(1.0, t / 0.4)
        temp = illust.copy()
        if a < 1:
            temp.putalpha(Image.eval(temp.split()[3], lambda x: int(x * a)))
        frame.paste(temp, (30, illust_y), temp)

        # Phase 2: Stroke animation BELOW illustration (1.8~5.2s)
        if stroke_steps and num_steps > 0 and 1.8 <= t <= 5.2:
            stroke_progress = max(0, min(1.0, (t - 2.0) / 2.6))
            step_idx = min(int(stroke_progress * num_steps), num_steps - 1)
            stroke_img = stroke_steps[step_idx].copy()

            sa = 1.0
            if t < 2.2:
                sa = max(0, (t - 1.8) / 0.4)
            if t > 4.8:
                sa *= max(0, 1.0 - (t - 4.8) / 0.4)
            if sa < 1:
                stroke_img.putalpha(Image.eval(stroke_img.split()[3], lambda x: int(x * sa)))
            frame.paste(stroke_img, (30, stroke_y), stroke_img)

        # Phase 3: Word section (5~6s)
        if t >= 5.0:
            a = min(1.0, (t - 5.0) / 0.5)
            temp = word_sec.copy()
            if a < 1:
                temp.putalpha(Image.eval(temp.split()[3], lambda x: int(x * a)))
            frame.paste(temp, (30, word_y), temp)

        # Phase 4: Example section (6.5~7s)
        if t >= 6.5:
            a = min(1.0, (t - 6.5) / 0.5)
            yo = int((1 - a) * 25)
            temp = example_sec.copy()
            if a < 1:
                temp.putalpha(Image.eval(temp.split()[3], lambda x: int(x * a)))
            frame.paste(temp, (40, ex_y + yo), temp)

        frame.save(f'{output_dir}/f_{i:04d}.png')

def find_ffmpeg():
    """Find ffmpeg binary - check system PATH first, then imageio-ffmpeg."""
    for cmd in ['ffmpeg', 'ffmpeg.exe']:
        if shutil.which(cmd):
            return cmd
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except:
        pass
    return 'ffmpeg'

def create_chime_audio(filepath):
    sr = 44100
    n = int(DURATION*sr)
    with wave.open(filepath, 'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        frames = []
        for i in range(n):
            t = i/sr; v = 0
            # Soft chime at stroke animation start (2.0s)
            if 2.0<=t<=2.6:
                e=math.exp(-(t-2.0)*5); v+=int(4000*e*math.sin(2*math.pi*440*t))
            # Word reveal chime (5.0s)
            if 5.0<=t<=5.6:
                e=math.exp(-(t-5.0)*5); v+=int(6000*e*math.sin(2*math.pi*523*t))+int(3000*e*math.sin(2*math.pi*659*t))
            # Example reveal chime (6.5s)
            if 6.5<=t<=7.1:
                e=math.exp(-(t-6.5)*6); v+=int(4000*e*math.sin(2*math.pi*784*t))
            frames.append(struct.pack('<h', max(-32767,min(32767,v))))
        w.writeframes(b''.join(frames))

def download_tts_audio(audio_url, filepath):
    """Download TTS MP3 from Supabase Storage. Returns True on success."""
    try:
        if hasattr(requests, 'get'):
            r = requests.get(audio_url, timeout=10)
            if r.status_code == 200 and len(r.content) > 100:
                with open(filepath, 'wb') as f:
                    f.write(r.content)
                return True
        else:
            requests.urlretrieve(audio_url, filepath)
            return os.path.exists(filepath) and os.path.getsize(filepath) > 100
    except:
        pass
    return False

def create_combined_audio(word_mp3, example_mp3, output_wav):
    """Combine word TTS at 0.6s and example TTS at 3.0s into one audio track."""
    ffmpeg = find_ffmpeg()

    inputs = []
    filters = []

    # Base: 5-second silence
    inputs.extend(['-f', 'lavfi', '-t', str(DURATION), '-i', 'anullsrc=r=44100:cl=mono'])
    base_idx = 0
    next_idx = 1

    has_word = word_mp3 and os.path.exists(word_mp3) and os.path.getsize(word_mp3) > 100
    has_example = example_mp3 and os.path.exists(example_mp3) and os.path.getsize(example_mp3) > 100

    if has_word:
        inputs.extend(['-i', word_mp3])
        word_idx = next_idx
        next_idx += 1
        filters.append(f'[{word_idx}]adelay=5000|5000[word]')

    if has_example:
        inputs.extend(['-i', example_mp3])
        ex_idx = next_idx
        next_idx += 1
        filters.append(f'[{ex_idx}]adelay=6500|6500[ex]')

    # Mix all tracks together (normalize=0 prevents volume division by input count)
    if has_word and has_example:
        filters.append(f'[{base_idx}][word][ex]amix=inputs=3:duration=first:normalize=0[out]')
    elif has_word:
        filters.append(f'[{base_idx}][word]amix=inputs=2:duration=first:normalize=0[out]')
    elif has_example:
        filters.append(f'[{base_idx}][ex]amix=inputs=2:duration=first:normalize=0[out]')
    else:
        filters.append(f'[{base_idx}]acopy[out]')

    cmd = [ffmpeg, '-y'] + inputs + [
        '-filter_complex', ';'.join(filters),
        '-map', '[out]', '-ac', '1', '-ar', '44100', '-t', str(DURATION), output_wav
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=30)
    return os.path.exists(output_wav) and os.path.getsize(output_wav) > 100

def encode_video(frames_dir, audio_path, output_path):
    ffmpeg = find_ffmpeg()
    cmd = [ffmpeg,'-y','-framerate',str(FPS),'-i',f'{frames_dir}/f_%04d.png',
           '-i',audio_path,'-c:v','libx264','-pix_fmt','yuv420p',
           '-c:a','aac','-b:a','128k','-shortest','-movflags','+faststart',output_path]
    print(f"  FFmpeg cmd: {' '.join(cmd[:5])}...", file=sys.stderr)
    result = subprocess.run(cmd, capture_output=True, timeout=120)
    if result.returncode != 0:
        print(f"  FFmpeg error (rc={result.returncode}): {result.stderr[-500:].decode('utf-8','replace')}", file=sys.stderr)

def compute_layout(illust_h=320, word_sec_h=240, example_h=180):
    """레이아웃 위치 자동 계산 (획순 영역 포함)"""
    illust_y = 75

    # Word section directly below illustration
    word_y = illust_y + illust_h + 45
    word_end_y = word_y + word_sec_h

    # Stroke animation overlays on word section position (same y-coordinate)
    # so that the jamo build-up visually matches where the final word appears
    stroke_y = word_y

    # Example + brand
    brand_h = 25
    equal_gap = 40

    ex_y = word_end_y + equal_gap
    ex_end_y = ex_y + example_h
    brand_y = ex_end_y + equal_gap
    card_h = brand_y + brand_h + equal_gap
    # H.264 requires even dimensions
    if card_h % 2 != 0:
        card_h += 1

    return {
        'illust_y': illust_y,
        'stroke_y': stroke_y,
        'word_y': word_y,
        'ex_y': ex_y,
        'brand_y': brand_y,
        'card_h': card_h,
    }

def generate_single_card(word_data, day_number, emoji_str, custom_path, supabase_url, output_path, local_example_mp3=None):
    illust = create_illustration(emoji_str, word_data['korean'], word_data.get('category','명사'), custom_path, supabase_url)
    word_sec = create_word_section(word_data['korean'], word_data.get('pronunciation',''), word_data.get('meaning_khmer',''))
    example_sec = create_example_section(word_data.get('example_kr',''), word_data.get('example_khmer',''), word_data['korean'])

    # Pre-render stroke animation steps (jamo decomposition) — compact strip below illustration
    stroke_steps = prerender_stroke_steps(word_data['korean'], illust.size[0])
    print(f"  Stroke animation: {len(stroke_steps)} jamo steps for '{word_data['korean']}'", file=sys.stderr)

    layout = compute_layout(illust_h=illust.size[1], word_sec_h=word_sec.size[1], example_h=example_sec.size[1])
    print(f"  Layout: card_h={layout['card_h']}, illust_y={layout['illust_y']}, word_y={layout['word_y']}, ex_y={layout['ex_y']}, brand_y={layout['brand_y']}", file=sys.stderr)

    base = create_base_card(day_number, layout['card_h'], layout['brand_y'])

    tmp = tempfile.mkdtemp()
    try:
        generate_frames(base, illust, word_sec, example_sec, tmp, layout, stroke_steps)

        # Verify frames were generated
        frame_count = len([f for f in os.listdir(tmp) if f.startswith('f_') and f.endswith('.png')])
        print(f"  Generated {frame_count} frames in {tmp}", file=sys.stderr)

        audio_path = os.path.join(tmp, 'audio.wav')
        word_mp3 = os.path.join(tmp, 'word.mp3')
        example_mp3 = os.path.join(tmp, 'example.mp3')

        # 단어 TTS 다운로드
        audio_url = word_data.get('audio_url', '')
        if audio_url:
            download_tts_audio(audio_url, word_mp3)

        # 예문 TTS 다운로드 (로컬 파일 우선)
        if local_example_mp3 and os.path.exists(local_example_mp3):
            shutil.copy2(local_example_mp3, example_mp3)
            print(f"  Using local example MP3: {local_example_mp3}", file=sys.stderr)
        else:
            example_audio_url = word_data.get('example_audio_url', '')
            if example_audio_url:
                download_tts_audio(example_audio_url, example_mp3)

        # 두 TTS를 0.6초/3.0초에 합성, 실패 시 chime 폴백
        if not create_combined_audio(word_mp3, example_mp3, audio_path):
            create_chime_audio(audio_path)

        encode_video(tmp, audio_path, output_path)
        return os.path.exists(output_path)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def fetch_word_from_supabase(day, sort_order):
    """Fetch a single word from Supabase by day_number and sort_order."""
    supabase_url = os.environ.get('SUPABASE_URL', '')
    supabase_key = os.environ.get('SUPABASE_KEY', os.environ.get('SUPABASE_SECRET_KEY', ''))
    if not supabase_url or not supabase_key:
        print("  WARNING: SUPABASE_URL or SUPABASE_SECRET_KEY not set", file=sys.stderr)
        return None, supabase_url
    url = (
        f"{supabase_url}/rest/v1/words?"
        f"select=id,day_number,sort_order,korean,pronunciation,meaning_khmer,category,"
        f"example_kr,example_khmer,audio_url,example_audio_url,image_url"
        f"&day_number=eq.{day}&sort_order=eq.{sort_order}&limit=1"
    )
    headers = {'apikey': supabase_key, 'Authorization': f'Bearer {supabase_key}'}
    try:
        if hasattr(requests, 'get'):
            r = requests.get(url, headers=headers, timeout=15)
            if r.status_code == 200:
                rows = r.json()
                if rows:
                    return rows[0], supabase_url
        else:
            import urllib.request
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as resp:
                rows = json.loads(resp.read())
                if rows:
                    return rows[0], supabase_url
    except Exception as e:
        print(f"  Supabase fetch error: {e}", file=sys.stderr)
    return None, supabase_url


def resolve_illustration_path(word_row, day, sort_order):
    """Resolve illustration storage path from image_url or illustration_source_map.
    Returns the path relative to word-cards bucket (e.g. 'illustrations/1_1.png')."""
    # 1) Check image_url from DB (Supabase Storage public URL)
    image_url = word_row.get('image_url', '') if word_row else ''
    if image_url:
        # Extract storage path from full URL: .../word-cards/illustrations/1_1.png
        marker = '/word-cards/'
        idx = image_url.find(marker)
        if idx >= 0:
            return image_url[idx + len(marker):]

    # 2) Fallback: illustration_source_map.json
    map_path = os.path.join(ROOT_DIR, 'data', 'illustration_source_map.json')
    if os.path.exists(map_path):
        with open(map_path, 'r', encoding='utf-8') as f:
            src_map = json.load(f)
        key = f"{day}_{sort_order}"
        if key in src_map:
            return src_map[key]
    return None


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--test', action='store_true')
    parser.add_argument('--test-mp4', action='store_true', help='Generate full MP4 with Supabase data')
    parser.add_argument('--day', type=int, default=1)
    parser.add_argument('--sort_order', type=int, default=1)
    parser.add_argument('--word_index', type=int, default=0)
    parser.add_argument('--output', default='test_motion_result.png')
    parser.add_argument('--example-mp3', default=None, help='Local example TTS MP3 file override')
    args = parser.parse_args()

    if args.test_mp4:
        # Full MP4 test: fetch real data from Supabase
        print(f"=== MP4 Test: Day {args.day}, sort_order {args.sort_order} ===", file=sys.stderr)

        row, supabase_url = fetch_word_from_supabase(args.day, args.sort_order)
        if not row:
            print("  ERROR: Could not fetch word from Supabase", file=sys.stderr)
            sys.exit(1)

        korean = row['korean']
        print(f"  Word: {korean} ({row.get('meaning_khmer','')})", file=sys.stderr)
        print(f"  image_url: {row.get('image_url','')}", file=sys.stderr)
        print(f"  audio_url: {row.get('audio_url','')}", file=sys.stderr)
        print(f"  example_audio_url: {row.get('example_audio_url','')}", file=sys.stderr)

        # Build word_data dict (DB columns: example_kr, example_khmer)
        word_data = {
            'korean': korean,
            'pronunciation': row.get('pronunciation', ''),
            'meaning_khmer': row.get('meaning_khmer', ''),
            'example_kr': row.get('example_kr', ''),
            'example_khmer': row.get('example_khmer', ''),
            'category': row.get('category', '명사'),
            'audio_url': row.get('audio_url', ''),
            'example_audio_url': row.get('example_audio_url', ''),
        }

        # Resolve illustration
        custom_path = resolve_illustration_path(row, args.day, args.sort_order)
        print(f"  illustration path: {custom_path}", file=sys.stderr)

        # Load emoji fallback
        emoji_str = None
        emoji_path = os.path.join(ROOT_DIR, 'data', 'emoji_mapping_by_row.json')
        if os.path.exists(emoji_path):
            with open(emoji_path, 'r', encoding='utf-8') as f:
                emoji_map = json.load(f)
            key = f"{args.day}_{args.sort_order}"
            emoji_str = emoji_map.get(key)

        output_path = os.path.join(ROOT_DIR, args.output)
        local_ex = os.path.abspath(args.example_mp3) if args.example_mp3 else None
        success = generate_single_card(word_data, args.day, emoji_str, custom_path, supabase_url, output_path, local_example_mp3=local_ex)
        if success:
            sz = os.path.getsize(output_path) / 1024
            print(f"  SUCCESS: {output_path} ({sz:.0f}KB)", file=sys.stderr)
        else:
            print(f"  FAILED to generate MP4", file=sys.stderr)
            sys.exit(1)

    elif args.test:
        # Static PNG test (legacy)
        test_words = {
            0: {"korean": "아이", "pronunciation": "[아이]", "meaning_khmer": "ក្មេង",
                "example_kr": "아이가 웃어요.", "example_khmer": "ក្មេងកំពុងសើច។", "category": "명사"},
        }
        word_data = test_words.get(args.word_index, test_words[0])
        print(f"=== Test: Day {args.day}, word '{word_data['korean']}' ===", file=sys.stderr)

        # Try fetching illustration from Supabase for PNG test too
        row, supabase_url = fetch_word_from_supabase(args.day, args.sort_order)
        custom_path = resolve_illustration_path(row, args.day, args.sort_order) if row else None
        emoji_str = None
        emoji_path = os.path.join(ROOT_DIR, 'data', 'emoji_mapping_by_row.json')
        if os.path.exists(emoji_path):
            with open(emoji_path, 'r', encoding='utf-8') as f:
                emoji_map = json.load(f)
            emoji_str = emoji_map.get(f"{args.day}_{args.sort_order}")

        get_fonts()
        illust = create_illustration(emoji_str, word_data['korean'], word_data.get('category','명사'), custom_path, supabase_url)
        word_sec = create_word_section(word_data['korean'], word_data['pronunciation'], word_data['meaning_khmer'])
        example_sec = create_example_section(word_data['example_kr'], word_data['example_khmer'], word_data['korean'])

        # Stroke animation test
        stroke_steps = prerender_stroke_steps(word_data['korean'], illust.size[0])
        jamo_steps = get_jamo_steps(word_data['korean'])
        print(f"  Stroke steps ({len(stroke_steps)}): {jamo_steps}", file=sys.stderr)

        layout = compute_layout(illust_h=illust.size[1], word_sec_h=word_sec.size[1], example_h=example_sec.size[1])
        print(f"  Layout: {layout}", file=sys.stderr)

        base = create_base_card(args.day, layout['card_h'], layout['brand_y'])

        # Save stroke animation mid-frame (shows jamo construction below illustration)
        if stroke_steps and len(stroke_steps) > 1:
            mid_idx = len(stroke_steps) // 2
            stroke_frame = base.copy()
            stroke_frame.paste(illust, (30, layout['illust_y']), illust)
            stroke_frame.paste(stroke_steps[mid_idx], (30, layout['stroke_y']), stroke_steps[mid_idx])
            stroke_out = os.path.join(ROOT_DIR, args.output.replace('.png', '_stroke.png'))
            stroke_frame.save(stroke_out, 'PNG')
            print(f"  Stroke frame saved: {stroke_out}", file=sys.stderr)

        # 최종 프레임 (모든 요소 표시)
        frame = base.copy()
        frame.paste(illust, (30, layout['illust_y']), illust)
        frame.paste(word_sec, (30, layout['word_y']), word_sec)
        frame.paste(example_sec, (40, layout['ex_y']), example_sec)

        out = os.path.join(ROOT_DIR, args.output)
        frame.save(out, 'PNG')
        print(f"  Saved: {out}", file=sys.stderr)
