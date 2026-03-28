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
            fonts['km_b42'] = ImageFont.truetype(khmer_path, 29)  # 42 * 0.7
            fonts['km_r22'] = ImageFont.truetype(khmer_path, 15)  # 22 * 0.7
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
    W, H = 760, 1100  # 1400 → 1100 (하단 공간 줄임)
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
    day_badge_w = 120
    draw.rounded_rectangle((day_badge_x, progress_y, W-60, progress_y+bar_h), 15, fill='#C62828')
    day_text = f"Day {day}"
    bb_day = draw.textbbox((0,0), day_text, font=fonts['kr_b20'])
    day_text_w = bb_day[2] - bb_day[0]
    day_text_h = bb_day[3] - bb_day[1]
    day_x = day_badge_x + (day_badge_w - day_text_w) // 2
    day_y = progress_y + (bar_h - day_text_h) // 2 - bb_day[1]  # y offset 보정
    draw.text((day_x, day_y), day_text, font=fonts['kr_b20'], fill='white')

    # ── 일러스트 영역 ──
    img_y = 110
    img_size = 550  # 정사각형
    draw.rounded_rectangle((40, img_y, W-40, img_y+img_size), 20, fill='#2C2C2C')

    # DALL-E 일러스트 (1:1 정사각형)
    if illustration_path and os.path.exists(illustration_path):
        try:
            illust = Image.open(illustration_path).convert('RGBA')
            illust = illust.resize((500, 500), Image.LANCZOS)  # 1:1 정사각형
            ix = (W - 500) // 2
            iy = img_y + (img_size - 500) // 2
            img.paste(illust, (ix, iy), illust)
            draw = ImageDraw.Draw(img)
        except Exception as e:
            print(f"Illustration error: {e}", file=sys.stderr)

    # ── 스피커 아이콘 (이미지 영역 안, 오른쪽 상단) ──
    speaker_size = 70
    speaker_x = W - 40 - speaker_size - 20  # 이미지 테두리 안쪽
    speaker_y = img_y + 20
    draw.ellipse((speaker_x, speaker_y, speaker_x+speaker_size, speaker_y+speaker_size), fill='#5DADE2')
    # 스피커 이모지
    draw.text((speaker_x+18, speaker_y+18), "🔊", font=fonts['kr_b28'], fill='white')

    # ── 한국어 단어 ──
    word_y = img_y + img_size + 40
    draw.text((60, word_y), korean, font=fonts['kr_b72'], fill='#1A1A1A')
    
    # 발음
    draw.text((60, word_y + 90), pron, font=fonts['kr_r24'], fill='#888888')

    # ── 크메르어 버튼 (오른쪽) ──
    khmer_btn_w = 270  # 180 → 270 (1.5배)
    khmer_btn_x = W - 60 - khmer_btn_w  # 오른쪽 끝(W-60)에서 왼쪽으로 확장
    khmer_btn_y = word_y + 20
    khmer_btn_h = 70
    draw.rounded_rectangle((khmer_btn_x, khmer_btn_y, W-60, khmer_btn_y+khmer_btn_h), 12, fill='#C62828')
    
    # 텍스트 중앙 정렬
    bb_km = draw.textbbox((0,0), meaning_khmer, font=fonts['km_b42'])
    km_w = bb_km[2] - bb_km[0]
    km_h = bb_km[3] - bb_km[1]
    km_x = khmer_btn_x + (khmer_btn_w - km_w) // 2
    km_y = khmer_btn_y + (khmer_btn_h - km_h) // 2 - bb_km[1]  # y offset 보정
    draw.text((km_x, km_y), meaning_khmer, font=fonts['km_b42'], fill='white')

    # ── EXAMPLE 섹션 ──
    ex_y = word_y + 130  # 180 → 130 (위로 올림)
    draw.text((60, ex_y), "Example", font=fonts['kr_b32'], fill='#1A1A1A')

    # 예문 박스 (흰색 배경 먼저, 테두리 나중에)
    ex_box_y = ex_y + 60
    ex_box_h = 140  # 180 → 140 (높이 축소)
    ex_box_padding = 8  # 테두리 안쪽 여유
    
    # 1. 흰색 배경
    draw.rounded_rectangle((60+ex_box_padding, ex_box_y+ex_box_padding, W-60-ex_box_padding, ex_box_y+ex_box_h-ex_box_padding), 16, fill='white')
    
    # 2. 파란 테두리 (마지막에 그려서 덮어쓰기 방지)
    draw.rounded_rectangle((60, ex_box_y, W-60, ex_box_y+ex_box_h), 16, outline='#5DADE2', width=3)

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
            
            # 노란색 하이라이트 (박스 안쪽에만)
            highlight_x = 90 + before_w
            highlight_x1 = max(highlight_x - 4, 70)  # 왼쪽 경계 (65→70)
            highlight_x2 = min(highlight_x + word_w + 4, W - 70)  # 오른쪽 경계 (65→70)
            draw.rounded_rectangle(
                (highlight_x1, ex_box_y+22, highlight_x2, ex_box_y+58),
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
            
            # 노란색 하이라이트 (박스 안쪽에만)
            highlight_x = 90 + before_w
            highlight_x1 = max(highlight_x - 4, 70)  # 왼쪽 경계
            highlight_x2 = min(highlight_x + word_w + 4, W - 70)  # 오른쪽 경계
            draw.rounded_rectangle(
                (highlight_x1, ex_box_y+82, highlight_x2, ex_box_y+118),
                6, fill='#FFEB3B'
            )
        
        # 텍스트 그리기
        draw.text((90, ex_box_y+85), example_khmer, font=fonts['km_r22'], fill='#555555')

    # ── READ 버튼 ──
    read_btn_x = W - 220
    read_btn_y = ex_box_y + 60
    read_btn_w = 120
    read_btn_h = 55
    draw.rounded_rectangle((read_btn_x, read_btn_y, read_btn_x+read_btn_w, read_btn_y+read_btn_h), 12, fill='#C62828')
    
    # READ 텍스트 중앙 정렬
    read_bb = draw.textbbox((0,0), "READ", font=fonts['kr_b28'])
    read_w = read_bb[2] - read_bb[0]
    read_h = read_bb[3] - read_bb[1]
    read_x = read_btn_x + (read_btn_w - read_w) // 2
    read_y = read_btn_y + (read_btn_h - read_h) // 2 - read_bb[1]  # y offset 보정
    draw.text((read_x, read_y), "READ", font=fonts['kr_b28'], fill='white')

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
