#!/usr/bin/env python3
"""
VERI-K Word Card Generator
Railway에서 Node.js가 호출하는 Python 스크립트
Usage: python3 generate_card.py <word_json> <illustration_path> <output_path>
"""

import sys
import json
from PIL import Image, ImageDraw, ImageFont
import os

# 폰트 경로 우선순위
FONT_PATHS = {
    'kr_bold': [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fonts', 'NotoSansKR-Bold.ttf'),
        '/app/fonts/NotoSansKR-Bold.ttf',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    ],
    'kr_regular': [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fonts', 'NotoSansKR-Regular.ttf'),
        '/app/fonts/NotoSansKR-Regular.ttf',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    ],
    'khmer': [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fonts', 'NotoSansKhmer-Regular.ttf'),
        '/app/fonts/NotoSansKhmer-Regular.ttf',
        '/usr/share/fonts/truetype/noto/NotoSansKhmer-Regular.ttf',
        '/usr/share/fonts/truetype/noto/NotoSansKhmer-Bold.ttf',
        '/usr/share/fonts/opentype/unifont/unifont.otf',
    ]
}

def find_font(key):
    for p in FONT_PATHS[key]:
        if os.path.exists(p):
            print(f"  Font [{key}]: {p}", file=sys.stderr)
            return p
    print(f"  Font [{key}]: NOT FOUND", file=sys.stderr)
    return None

def load_fonts():
    kr_bold_path = find_font('kr_bold')
    kr_reg_path = find_font('kr_regular')
    khmer_path = find_font('khmer')

    if not kr_bold_path or not kr_reg_path:
        print("ERROR: Korean fonts not found!", file=sys.stderr)
        sys.exit(1)

    # TTF = index 0, TTC = index 4 (KR)
    kr_idx = 4 if kr_bold_path.endswith('.ttc') else 0
    print(f"  Korean font index: {kr_idx} ({'TTC' if kr_idx == 4 else 'TTF'})", file=sys.stderr)

    fonts = {
        'kr_b64': ImageFont.truetype(kr_bold_path, 64, index=kr_idx),
        'kr_b32': ImageFont.truetype(kr_bold_path, 32, index=kr_idx),
        'kr_b26': ImageFont.truetype(kr_bold_path, 26, index=kr_idx),
        'kr_b24': ImageFont.truetype(kr_bold_path, 24, index=kr_idx),
        'kr_b22': ImageFont.truetype(kr_bold_path, 22, index=kr_idx),
        'kr_b20': ImageFont.truetype(kr_bold_path, 20, index=kr_idx),
        'kr_b18': ImageFont.truetype(kr_bold_path, 18, index=kr_idx),
        'kr_r26': ImageFont.truetype(kr_reg_path, 26, index=kr_idx),
        'kr_r20': ImageFont.truetype(kr_reg_path, 20, index=kr_idx),
    }

    if khmer_path:
        try:
            print(f"  Loading Khmer font from: {khmer_path}", file=sys.stderr)
            fonts['km_b32'] = ImageFont.truetype(khmer_path, 28)
            fonts['km_r18'] = ImageFont.truetype(khmer_path, 16)
            print(f"  Khmer font loaded successfully", file=sys.stderr)
        except Exception as e:
            print(f"  Khmer font load error: {e}", file=sys.stderr)
            # 폴백: 한국어 폰트 사용
            fonts['km_b32'] = fonts['kr_b32']
            fonts['km_r18'] = fonts['kr_r20']
    else:
        print(f"  WARNING: No Khmer font found, using Korean font as fallback", file=sys.stderr)
        fonts['km_b32'] = fonts['kr_b32']
        fonts['km_r18'] = fonts['kr_r20']

    return fonts

def draw_gold_line(draw, y, W):
    for x in range(5, W-5):
        r = x / W
        if r < 0.5:
            c = (int(212+(240-212)*r*2), int(168+(214-168)*r*2), int(67+(138-67)*r*2))
        else:
            c = (int(240-(240-212)*(r-0.5)*2), int(214-(214-168)*(r-0.5)*2), int(138-(138-67)*(r-0.5)*2))
        draw.rectangle((x, y, x+1, y+8), fill=c)

def generate_card(word, illustration_path, output_path, fonts):
    W, H = 760, 820
    img = Image.new('RGBA', (W, H), (0,0,0,0))
    draw = ImageDraw.Draw(img)

    index = word.get('index', 0)
    total = word.get('total', 29)
    day = word.get('day_number', 1)
    korean = word.get('korean', '')
    pron = word.get('pronunciation', f'[{korean}]')
    category = word.get('category', '')
    meaning_khmer = word.get('meaning_khmer', '')
    example_kr = word.get('example_kr', '')
    example_khmer = word.get('example_khmer', '')
    
    # DEBUG: 받은 데이터 출력
    print(f"  DEBUG korean: {korean}", file=sys.stderr)
    print(f"  DEBUG meaning_khmer: {meaning_khmer}", file=sys.stderr)
    print(f"  DEBUG example_khmer: {example_khmer}", file=sys.stderr)

    # 배경
    draw.rounded_rectangle((0, 0, W, H), 32, fill='white')
    draw.rounded_rectangle((2, 2, W-2, H-2), 32, outline='#1B2A4A', width=5)

    # 골드 라인
    draw_gold_line(draw, 5, W)
    draw_gold_line(draw, H-13, W)

    # 재생 버튼
    draw.ellipse((34, 30, 78, 74), fill='#1B2A4A')
    draw.polygon([(62, 52), (50, 44), (50, 60)], fill='#D4A843')
    draw.text((86, 37), f"{index + 1} / {total}", font=fonts['kr_b26'], fill='#1B2A4A')

    # DAY 배지
    draw.rounded_rectangle((W-180, 32, W-30, 74), 16, fill='#1B2A4A')
    day_text = f"DAY {day}"
    bb = draw.textbbox((0,0), day_text, font=fonts['kr_b22'])
    draw.text((W-105-(bb[2]-bb[0])//2, 40), day_text, font=fonts['kr_b22'], fill='#D4A843')

    # 일러스트 영역
    imgY = 88
    imgH = 440
    draw.rounded_rectangle((36, imgY, W-36, imgY+imgH), 24, fill='#E0F2E0')

    # DALL-E 일러스트 삽입
    if illustration_path and os.path.exists(illustration_path):
        try:
            illust = Image.open(illustration_path).convert('RGBA')
            illust = illust.resize((380, 380), Image.LANCZOS)
            ix = (W - 380) // 2
            iy = imgY + (imgH - 380) // 2
            img.paste(illust, (ix, iy), illust)
            draw = ImageDraw.Draw(img)  # Re-create draw after paste
        except Exception as e:
            print(f"Illustration error: {e}", file=sys.stderr)

    # 스피커 아이콘
    draw.ellipse((W-112, imgY+10, W-52, imgY+70), fill=(27,42,74,200))
    draw.text((W-94, imgY+24), "🔊", font=fonts['kr_b22'], fill='#D4A843')

    # 한국어 단어
    wordY = imgY + imgH + 20
    draw.text((48, wordY), korean, font=fonts['kr_b64'], fill='#1B2A4A')
    bb_kr = draw.textbbox((0,0), korean, font=fonts['kr_b64'])
    kr_width = bb_kr[2] - bb_kr[0]
    draw.text((48 + kr_width + 16, wordY + 20), pron, font=fonts['kr_r26'], fill='#B0B0B0')

    # 품사 배지
    draw.rounded_rectangle((W-155, wordY+10, W-48, wordY+45), 12, fill='#EEF2F7')
    bb = draw.textbbox((0,0), category, font=fonts['kr_b20'])
    draw.text((W-101-(bb[2]-bb[0])//2, wordY+15), category, font=fonts['kr_b20'], fill='#1B2A4A')

    # 크메르어 뜻
    khmerY = wordY + 80
    draw.rounded_rectangle((48, khmerY, W-48, khmerY+55), 16, fill='#F0F7ED', outline='#4CAF50', width=3)
    bb = draw.textbbox((0,0), meaning_khmer, font=fonts['km_b32'])
    draw.text((W//2-(bb[2]-bb[0])//2, khmerY+10), meaning_khmer, font=fonts['km_b32'], fill='#2E7D32')

    # EXAMPLE
    exY = khmerY + 72
    draw.text((48, exY), "EXAMPLE", font=fonts['kr_b18'], fill='#C0C0C0')
    draw.rounded_rectangle((48, exY+24, W-48, exY+96), 16, fill='#F9F9F9')
    if example_kr:
        draw.text((68, exY+32), example_kr, font=fonts['kr_b24'], fill='#555555')
    if example_khmer:
        draw.text((68, exY+64), example_khmer, font=fonts['km_r18'], fill='#AAAAAA')

    # 저장
    img.save(output_path, 'PNG')
    print(f"OK:{output_path}")

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Usage: python3 generate_card.py <word_json> <illustration_path> <output_path>")
        sys.exit(1)

    word = json.loads(sys.argv[1])
    illustration_path = sys.argv[2] if sys.argv[2] != 'none' else None
    output_path = sys.argv[3]

    fonts = load_fonts()
    generate_card(word, illustration_path, output_path, fonts)
