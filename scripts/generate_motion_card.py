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
W, H = 760, 950
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
KH_BOLD = find_font(['NotoSansKhmer-Regular.ttf', 'NotoSansKhmer-Bold.ttf'])

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

def create_base_card(day_number):
    fonts = get_fonts()
    img = Image.new('RGB', (W, H), '#F5EDDA')
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((4, 4, W-4, H-4), radius=20, outline="#6B5A28", width=6)
    draw.rounded_rectangle((BORDER, BORDER, W-BORDER, H-BORDER), radius=18, fill=CARD_INNER, outline=GOLD_DARK, width=4)
    draw.rounded_rectangle((BORDER+8, BORDER+8, W-BORDER-8, H-BORDER-8), radius=14, outline=GOLD_LIGHT, width=1)

    badge_w, badge_h = 120, 42
    bx = (W - badge_w) // 2
    by = BORDER - 4
    draw.rounded_rectangle((bx, by, bx+badge_w, by+badge_h), radius=6, fill=GOLD_BADGE, outline=GOLD_DARK, width=2)
    day_text = f"Day {day_number}"
    bbox = draw.textbbox((0,0), day_text, font=fonts['badge'])
    tw = bbox[2] - bbox[0]
    draw.text((bx + (badge_w-tw)//2, by+8), day_text, fill="#FFFFFF", font=fonts['badge'])
    draw.text((W//2 - 30, H-45), "VERI-K", fill=GOLD_LIGHT, font=fonts['sm'])
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
    img = Image.new('RGBA', (W-60, 220), (0,0,0,0))
    draw = ImageDraw.Draw(img)
    area_w = img.size[0]

    bbox = draw.textbbox((0,0), korean, font=fonts['word'])
    tw = bbox[2]-bbox[0]
    draw.text(((area_w-tw)//2, 0), korean, fill=TEXT_DARK, font=fonts['word'])

    bbox2 = draw.textbbox((0,0), pronunciation, font=fonts['pron'])
    tw2 = bbox2[2]-bbox2[0]
    draw.text(((area_w-tw2)//2, 80), pronunciation, fill=TEXT_GRAY, font=fonts['pron'])

    bbox3 = draw.textbbox((0,0), khmer, font=fonts['khmer_big'])
    tw3 = bbox3[2]-bbox3[0]
    draw.text(((area_w-tw3)//2, 130), khmer, fill=TEXT_KHMER, font=fonts['khmer_big'])
    return img

def create_example_section(example_kr, example_khmer, keyword):
    fonts = get_fonts()
    box_w, box_h = W-80, 180
    img = Image.new('RGBA', (box_w, box_h), (0,0,0,0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((0,0,box_w,box_h), radius=12, fill=WHITE_BOX, outline="#E0D8C8", width=1)
    draw.text((18,12), "Example", fill="#777777", font=fonts['label'])

    if keyword and example_kr and keyword in example_kr:
        kw_bbox = draw.textbbox((20,55), keyword, font=fonts['ex'])
        kw_w = kw_bbox[2]-kw_bbox[0]
        kw_h = kw_bbox[3]-kw_bbox[1]
        draw.rounded_rectangle((14,52, 14+kw_w+12, 52+kw_h+10), radius=6, fill=HIGHLIGHT_BG)
        draw.text((20,55), keyword, fill=TEXT_DARK, font=fonts['ex'])
        rest = example_kr.split(keyword, 1)
        if len(rest) > 1:
            draw.text((20+kw_w+4, 55), rest[1], fill=TEXT_DARK, font=fonts['ex'])
    else:
        draw.text((20,55), example_kr or "", fill=TEXT_DARK, font=fonts['ex'])

    draw.text((18,110), example_khmer or "", fill=TEXT_KHMER, font=fonts['khmer_ex'])
    return img

# === ANIMATION ===

def generate_frames(base, illust, word_sec, example_sec, output_dir):
    n = int(DURATION * FPS)
    os.makedirs(output_dir, exist_ok=True)
    for i in range(n):
        t = i/FPS
        frame = base.copy()

        if t >= 0:
            a = min(1.0, t/0.4)
            temp = illust.copy()
            if a < 1: temp.putalpha(Image.eval(temp.split()[3], lambda x: int(x*a)))
            frame.paste(temp, (30,60), temp)

        if t >= 0.6 and t < 1.8:
            a = min(1.0, (t-0.6)/0.4)
            temp = word_sec.copy()
            mask = Image.new('L', temp.size, 0)
            ImageDraw.Draw(mask).rectangle((0,0,temp.size[0],110), fill=int(255*a))
            tm = Image.new('RGBA', temp.size, (0,0,0,0))
            tm.paste(temp, (0,0), mask)
            frame.paste(tm, (30,390), tm)

        if t >= 1.8:
            a = min(1.0, (t-1.8)/0.3)
            temp = word_sec.copy()
            if a < 1: temp.putalpha(Image.eval(temp.split()[3], lambda x: int(x*a)))
            frame.paste(temp, (30,390), temp)

        if t >= 3.0:
            a = min(1.0, (t-3.0)/0.5)
            yo = int((1-a)*25)
            temp = example_sec.copy()
            if a < 1: temp.putalpha(Image.eval(temp.split()[3], lambda x: int(x*a)))
            frame.paste(temp, (40,590+yo), temp)

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

    # Mix all tracks together
    if has_word and has_example:
        filters.append(f'[{base_idx}][word][ex]amix=inputs=3:duration=first[out]')
    elif has_word:
        filters.append(f'[{base_idx}][word]amix=inputs=2:duration=first[out]')
    elif has_example:
        filters.append(f'[{base_idx}][ex]amix=inputs=2:duration=first[out]')
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

def generate_single_card(word_data, day_number, emoji_str, custom_path, supabase_url, output_path):
    base = create_base_card(day_number)
    illust = create_illustration(emoji_str, word_data['korean'], word_data.get('category','명사'), custom_path, supabase_url)
    word_sec = create_word_section(word_data['korean'], word_data.get('pronunciation',''), word_data.get('meaning_khmer',''))
    example_sec = create_example_section(word_data.get('example_kr',''), word_data.get('example_khmer',''), word_data['korean'])

    tmp = tempfile.mkdtemp()
    try:
        generate_frames(base, illust, word_sec, example_sec, tmp)

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
