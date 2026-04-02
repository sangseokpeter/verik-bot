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

    if not os.path.exists(cached):
        url = f'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/{fname}'
        try:
            if hasattr(requests, 'get'):
                r = requests.get(url, timeout=5)
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
    audio = os.path.join(tmp, 'chime.wav')
    try:
        generate_frames(base, illust, word_sec, example_sec, tmp)
        create_chime_audio(audio)
        encode_video(tmp, audio, output_path)
        return os.path.exists(output_path)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
