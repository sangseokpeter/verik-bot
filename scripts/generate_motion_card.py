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
DURATION = 5.0

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
# 크메르어: Battambang-Bold 우선, 없으면 기존 NotoSansKhmer로 폴백
KH_BOLD = find_font(['Battambang-Bold.ttf', 'Battambang-Regular.ttf', 'NotoSansKhmer-Regular.ttf', 'NotoSansKhmer-Bold.ttf'])

def load_font(path, size):
    try:
        if path:
            return ImageFont.truetype(path, size)
    except:
        pass
    return ImageFont.load_default()

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

def create_word_section(korean, pronunciation, khmer):
    fonts = get_fonts()

    # [간격3] 한국어 끝 ↔ 발음: +15px (80→95)
    # [간격4] 발음 끝 ↔ 크메르어: +15px (130→160)
    pron_y = 95    # was 80
    khmer_y = 160  # was 130
    section_h = 240  # was 220, expanded to fit

    img = Image.new('RGBA', (W-60, section_h), (0,0,0,0))
    draw = ImageDraw.Draw(img)
    area_w = img.size[0]

    bbox = draw.textbbox((0,0), korean, font=fonts['word'])
    tw = bbox[2]-bbox[0]
    draw.text(((area_w-tw)//2, 0), korean, fill=TEXT_DARK, font=fonts['word'])

    bbox2 = draw.textbbox((0,0), pronunciation, font=fonts['pron'])
    tw2 = bbox2[2]-bbox2[0]
    draw.text(((area_w-tw2)//2, pron_y), pronunciation, fill=TEXT_GRAY, font=fonts['pron'])

    bbox3 = draw.textbbox((0,0), khmer, font=fonts['khmer_big'])
    tw3 = bbox3[2]-bbox3[0]
    draw.text(((area_w-tw3)//2, khmer_y), khmer, fill=TEXT_KHMER, font=fonts['khmer_big'])
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

    draw.text((18,110), example_khmer or "", fill=TEXT_KHMER, font=fonts['khmer_ex'])
    return img

# === ANIMATION ===

def generate_frames(base, illust, word_sec, example_sec, output_dir, layout=None):
    if layout is None:
        layout = {'illust_y': 60, 'word_y': 390, 'ex_y': 590}
    illust_y = layout['illust_y']
    word_y = layout['word_y']
    ex_y = layout['ex_y']

    n = int(DURATION * FPS)
    os.makedirs(output_dir, exist_ok=True)
    for i in range(n):
        t = i/FPS
        frame = base.copy()

        if t >= 0:
            a = min(1.0, t/0.4)
            temp = illust.copy()
            if a < 1: temp.putalpha(Image.eval(temp.split()[3], lambda x: int(x*a)))
            frame.paste(temp, (30, illust_y), temp)

        if t >= 0.6 and t < 1.8:
            a = min(1.0, (t-0.6)/0.4)
            temp = word_sec.copy()
            mask = Image.new('L', temp.size, 0)
            ImageDraw.Draw(mask).rectangle((0,0,temp.size[0],110), fill=int(255*a))
            tm = Image.new('RGBA', temp.size, (0,0,0,0))
            tm.paste(temp, (0,0), mask)
            frame.paste(tm, (30, word_y), tm)

        if t >= 1.8:
            a = min(1.0, (t-1.8)/0.3)
            temp = word_sec.copy()
            if a < 1: temp.putalpha(Image.eval(temp.split()[3], lambda x: int(x*a)))
            frame.paste(temp, (30, word_y), temp)

        if t >= 3.0:
            a = min(1.0, (t-3.0)/0.5)
            yo = int((1-a)*25)
            temp = example_sec.copy()
            if a < 1: temp.putalpha(Image.eval(temp.split()[3], lambda x: int(x*a)))
            frame.paste(temp, (40, ex_y+yo), temp)

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
            if 0.6<=t<=1.2:
                e=math.exp(-(t-0.6)*5); v+=int(6000*e*math.sin(2*math.pi*523*t))+int(3000*e*math.sin(2*math.pi*659*t))
            if 1.8<=t<=2.4:
                e=math.exp(-(t-1.8)*5); v+=int(5000*e*math.sin(2*math.pi*659*t))
            if 3.0<=t<=3.6:
                e=math.exp(-(t-3.0)*6); v+=int(4000*e*math.sin(2*math.pi*784*t))
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
        filters.append(f'[{word_idx}]adelay=600|600[word]')

    if has_example:
        inputs.extend(['-i', example_mp3])
        ex_idx = next_idx
        next_idx += 1
        filters.append(f'[{ex_idx}]adelay=3000|3000[ex]')

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
    subprocess.run(cmd, capture_output=True, timeout=60)

def compute_layout(illust_h=320, word_sec_h=240, example_h=180):
    """레이아웃 위치 자동 계산 (간격 수정 5곳 반영)"""
    # [간격1] 골드 테두리 끝 ↔ 일러스트: +15px (60→75)
    illust_y = 75  # was 60

    # [간격2] 일러스트 끝 ↔ 한국어 단어: +30px
    word_y = illust_y + illust_h + 40  # was +10 gap, now +40 (+30 more)

    # 한국어/발음/크메르어 끝 (word_sec 내부 간격은 create_word_section에서 처리)
    word_end_y = word_y + word_sec_h

    # [간격5] 크메르어 뜻 ~ 예문 박스 ~ VERI-K 브랜드: 균등 분배
    brand_h = 25
    equal_gap = 50

    ex_y = word_end_y + equal_gap
    ex_end_y = ex_y + example_h
    brand_y = ex_end_y + equal_gap
    card_h = brand_y + brand_h + equal_gap

    return {
        'illust_y': illust_y,
        'word_y': word_y,
        'ex_y': ex_y,
        'brand_y': brand_y,
        'card_h': card_h,
    }

def generate_single_card(word_data, day_number, emoji_str, custom_path, supabase_url, output_path):
    illust = create_illustration(emoji_str, word_data['korean'], word_data.get('category','명사'), custom_path, supabase_url)
    word_sec = create_word_section(word_data['korean'], word_data.get('pronunciation',''), word_data.get('meaning_khmer',''))
    example_sec = create_example_section(word_data.get('example_kr',''), word_data.get('example_khmer',''), word_data['korean'])

    layout = compute_layout(illust_h=illust.size[1], word_sec_h=word_sec.size[1], example_h=example_sec.size[1])
    print(f"  Layout: card_h={layout['card_h']}, illust_y={layout['illust_y']}, word_y={layout['word_y']}, ex_y={layout['ex_y']}, brand_y={layout['brand_y']}", file=sys.stderr)

    base = create_base_card(day_number, layout['card_h'], layout['brand_y'])

    tmp = tempfile.mkdtemp()
    try:
        generate_frames(base, illust, word_sec, example_sec, tmp, layout)

        audio_path = os.path.join(tmp, 'audio.wav')
        word_mp3 = os.path.join(tmp, 'word.mp3')
        example_mp3 = os.path.join(tmp, 'example.mp3')

        # 단어 TTS 다운로드
        audio_url = word_data.get('audio_url', '')
        if audio_url:
            download_tts_audio(audio_url, word_mp3)

        # 예문 TTS 다운로드
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


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--test', action='store_true')
    parser.add_argument('--day', type=int, default=1)
    parser.add_argument('--word_index', type=int, default=0)
    parser.add_argument('--output', default='test_motion_result.png')
    args = parser.parse_args()

    if args.test:
        # Day 1 첫 번째 단어 테스트 데이터
        test_words = {
            0: {"korean": "아이", "pronunciation": "[아이]", "meaning_khmer": "ក្មេង",
                "example_kr": "아이가 웃어요.", "example_khmer": "ក្មេងកំពុងសើច។", "category": "명사"},
        }
        word_data = test_words.get(args.word_index, test_words[0])
        print(f"=== Test: Day {args.day}, word '{word_data['korean']}' ===", file=sys.stderr)

        get_fonts()
        illust = create_illustration(None, word_data['korean'], word_data.get('category','명사'), None, None)
        word_sec = create_word_section(word_data['korean'], word_data['pronunciation'], word_data['meaning_khmer'])
        example_sec = create_example_section(word_data['example_kr'], word_data['example_khmer'], word_data['korean'])

        layout = compute_layout(illust_h=illust.size[1], word_sec_h=word_sec.size[1], example_h=example_sec.size[1])
        print(f"  Layout: {layout}", file=sys.stderr)

        base = create_base_card(args.day, layout['card_h'], layout['brand_y'])

        # 최종 프레임 (모든 요소 표시)
        frame = base.copy()
        frame.paste(illust, (30, layout['illust_y']), illust)
        frame.paste(word_sec, (30, layout['word_y']), word_sec)
        frame.paste(example_sec, (40, layout['ex_y']), example_sec)

        out = os.path.join(ROOT_DIR, args.output)
        frame.save(out, 'PNG')
        print(f"  Saved: {out}", file=sys.stderr)
