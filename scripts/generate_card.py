#!/usr/bin/env python3
"""
VERI-K Word Card Generator - New Design
Based on Mobile Prototype PDF
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
        'kr_b72': ImageFont.truetype(kr_bold_path, 72, index=kr_idx),
        'kr_b48': ImageFont.truetype(kr_bold_path, 48, index=kr_idx),
        'kr_b32': ImageFont.truetype(kr_bold_path, 32, index=kr_idx),
        'kr_b28': ImageFont.truetype(kr_bold_path, 28, index=kr_idx),
        'kr_b24': ImageFont.truetype(kr_bold_path, 24, index=kr_idx),
        'kr_b20': ImageFont.truetype(kr_bold_path, 20, index=kr_idx),
        'kr_r24': ImageFont.truetype(kr_reg_path, 24, index=kr_idx),
        'kr_r20': ImageFont.truetype(kr_reg_path, 20, index=kr_idx),
    }

    if khmer_path:
        try:
            print(f"  Loading Khmer font from: {khmer_path}", file=sys.stderr)
            fonts['km_b42'] = ImageFont.truetype(khmer_path, 42)
            fonts['km_r22'] = ImageFont.truetype(khmer_path, 22)
            print(f"  Khmer font loaded successfully", file=sys.stderr)
        except Exception as e:
            print(f"  Khmer font load error: {e}", file=sys.stderr)
            fonts['km_b42'] = fonts['kr_b48']
            fonts['km_r22'] = fonts['kr_r24']
    else:
        print(f"  WARNING: No Khmer font found, using Korean font as fallback", file=sys.stderr)
        fonts['km_b42'] = fonts['kr_b48']
        fonts['km_r22'] = fonts['kr_r24']

    return fonts

def generate_card(word, illustration_path, output_path, fonts):
    W, H = 760, 1400
    img = Image.new('RGBA', (W, H), '#F5F0E8')  # 베이지 배경
    draw = ImageDraw.Draw(img)

    index = word.get('index', 0)
    total = word.get('total', 29)
    day = word.get('day_number', 1)
    korean = word.get('korean', '')
    pron = word.get('pronunciation', f'[{korean}]')
    meaning_khmer = word.get('meaning_khmer', '')
    example_kr = word.get('example_kr', '')
    example_khmer = word.get('example_khmer', '')
    
    # DEBUG
    print(f"  DEBUG korean: {korean}", file=sys.stderr)
    print(f"  DEBUG meaning_khmer: {meaning_khmer}", file=sys.stderr)

    # ── 카드 테두리 ──
    draw.rounded_rectangle((20, 20, W-20, H-20), 24, outline='#D4A843', width=4)

    # ── 프로그레스 바 ──
    progress_y = 50
    bar_w = 300
    bar_h = 30
    bar_x = 60
    
    # 배경 바
    draw.rounded_rectangle((bar_x, progress_y, bar_x+bar_w, progress_y+bar_h), 15, fill='#E0E0E0')
    
    # 진행 바 (빨강)
    progress = (index + 1) / total
    filled_w = int(bar_w * progress)
    if filled_w > 0:
        draw.rounded_rectangle((bar_x, progress_y, bar_x+filled_w, progress_y+bar_h), 15, fill='#C62828')
    
    # 진행 텍스트
    progress_text = f"{index + 1}/{total}"
    draw.text((bar_x + bar_w + 20, progress_y + 5), progress_text, font=fonts['kr_b24'], fill='#C62828')

    # ── DAY 배지 (오른쪽) ──
    day_badge_x = W - 180
    draw.rounded_rectangle((day_badge_x, progress_y, W-60, progress_y+bar_h), 15, fill='#C62828')
    day_text = f"Day {day}"
    bb = draw.textbbox((0,0), day_text, font=fonts['kr_b20'])
    day_w = bb[2] - bb[0]
    draw.text((day_badge_x + (120-day_w)//2, progress_y + 5), day_text, font=fonts['kr_b20'], fill='white')

    # ── 일러스트 영역 ──
    img_y = 110
    img_h = 550
    draw.rounded_rectangle((40, img_y, W-40, img_y+img_h), 20, fill='#2C2C2C')

    # DALL-E 일러스트
    if illustration_path and os.path.exists(illustration_path):
        try:
            illust = Image.open(illustration_path).convert('RGBA')
            illust = illust.resize((640, 500), Image.LANCZOS)
            ix = (W - 640) // 2
            iy = img_y + (img_h - 500) // 2
            img.paste(illust, (ix, iy), illust)
            draw = ImageDraw.Draw(img)
        except Exception as e:
            print(f"Illustration error: {e}", file=sys.stderr)

    # ── 스피커 아이콘 (오른쪽 상단) ──
    speaker_x = W - 120
    speaker_y = img_y + 20
    draw.ellipse((speaker_x, speaker_y, speaker_x+70, speaker_y+70), fill='#5DADE2')
    draw.text((speaker_x+15, speaker_y+15), "🔊", font=fonts['kr_b32'], fill='white')

    # ── 한국어 단어 ──
    word_y = img_y + img_h + 40
    draw.text((60, word_y), korean, font=fonts['kr_b72'], fill='#1A1A1A')
    
    # 발음
    draw.text((60, word_y + 90), pron, font=fonts['kr_r24'], fill='#888888')

    # ── 크메르어 버튼 (오른쪽) ──
    khmer_btn_x = W - 240
    khmer_btn_y = word_y + 20
    draw.rounded_rectangle((khmer_btn_x, khmer_btn_y, W-60, khmer_btn_y+70), 12, fill='#C62828')
    bb_km = draw.textbbox((0,0), meaning_khmer, font=fonts['km_b42'])
    km_w = bb_km[2] - bb_km[0]
    draw.text((khmer_btn_x + (180-km_w)//2, khmer_btn_y + 12), meaning_khmer, font=fonts['km_b42'], fill='white')

    # ── EXAMPLE 섹션 ──
    ex_y = word_y + 180
    draw.text((60, ex_y), "Example", font=fonts['kr_b32'], fill='#1A1A1A')

    # 예문 박스
    ex_box_y = ex_y + 60
    draw.rounded_rectangle((60, ex_box_y, W-60, ex_box_y+180), 16, fill='white', outline='#5DADE2', width=3)

    # 한국어 예문
    if example_kr:
        # 먼저 하이라이트 그리기
        if korean in example_kr:
            # 단어 앞부분 너비 계산
            before_text = example_kr[:example_kr.find(korean)]
            before_bb = draw.textbbox((0,0), before_text, font=fonts['kr_b24'])
            before_w = before_bb[2] - before_bb[0]
            
            # 단어 너비 계산
            word_bb = draw.textbbox((0,0), korean, font=fonts['kr_b24'])
            word_w = word_bb[2] - word_bb[0]
            
            # 노란색 하이라이트
            highlight_x = 90 + before_w
            draw.rounded_rectangle(
                (highlight_x-4, ex_box_y+22, highlight_x+word_w+4, ex_box_y+58),
                6, fill='#FFEB3B'
            )
        
        # 텍스트 그리기
        draw.text((90, ex_box_y+25), example_kr, font=fonts['kr_b24'], fill='#1A1A1A')

    # 크메르어 예문
    if example_khmer:
        # 먼저 하이라이트 그리기
        if meaning_khmer in example_khmer:
            # 단어 앞부분 너비 계산
            before_text = example_khmer[:example_khmer.find(meaning_khmer)]
            before_bb = draw.textbbox((0,0), before_text, font=fonts['km_r22'])
            before_w = before_bb[2] - before_bb[0]
            
            # 단어 너비 계산
            word_bb = draw.textbbox((0,0), meaning_khmer, font=fonts['km_r22'])
            word_w = word_bb[2] - word_bb[0]
            
            # 노란색 하이라이트
            highlight_x = 90 + before_w
            draw.rounded_rectangle(
                (highlight_x-4, ex_box_y+82, highlight_x+word_w+4, ex_box_y+118),
                6, fill='#FFEB3B'
            )
        
        # 텍스트 그리기
        draw.text((90, ex_box_y+85), example_khmer, font=fonts['km_r22'], fill='#555555')

    # ── READ 버튼 ──
    read_btn_x = W - 220
    read_btn_y = ex_box_y + 60
    draw.rounded_rectangle((read_btn_x, read_btn_y, W-100, read_btn_y+55), 12, fill='#C62828')
    draw.text((read_btn_x+35, read_btn_y+12), "READ", font=fonts['kr_b28'], fill='white')

    # ── 저장 ──
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
