#!/usr/bin/env python3
"""
VERI-K Countdown Card Generator
D-Day countdown to TOPIK I exam (2026-05-17)
"""

import sys
import json
from PIL import Image, ImageDraw, ImageFont
from datetime import datetime, date
import os

TOPIK_DATE = date(2026, 5, 17)

FONT_PATHS = {
    'kr_bold': [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fonts', 'NotoSansKR-Bold.ttf'),
        '/app/fonts/NotoSansKR-Bold.ttf',
    ],
    'kr_regular': [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fonts', 'NotoSansKR-Regular.ttf'),
        '/app/fonts/NotoSansKR-Regular.ttf',
    ],
    'khmer': [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fonts', 'NotoSansKhmer-Regular.ttf'),
        '/app/fonts/NotoSansKhmer-Regular.ttf',
    ],
}

def find_font(key):
    for p in FONT_PATHS[key]:
        if os.path.exists(p):
            return p
    return None

def generate_countdown_card(today_str, output_path):
    today = date.fromisoformat(today_str)
    d_day = (TOPIK_DATE - today).days

    W, H = 760, 900

    # Load fonts
    kr_bold_path = find_font('kr_bold')
    kr_reg_path = find_font('kr_regular')
    khmer_path = find_font('khmer')

    if not kr_bold_path or not kr_reg_path:
        print("ERROR: Korean fonts not found!", file=sys.stderr)
        sys.exit(1)

    fonts = {
        'huge': ImageFont.truetype(kr_bold_path, 120),
        'big': ImageFont.truetype(kr_bold_path, 48),
        'mid': ImageFont.truetype(kr_bold_path, 32),
        'sm': ImageFont.truetype(kr_reg_path, 24),
        'xs': ImageFont.truetype(kr_reg_path, 20),
    }
    if khmer_path:
        fonts['km'] = ImageFont.truetype(khmer_path, 22)
    else:
        fonts['km'] = fonts['sm']

    img = Image.new('RGBA', (W, H), '#F5F0E8')
    draw = ImageDraw.Draw(img)

    # Gold border
    draw.rounded_rectangle((20, 20, W-20, H-20), 24, outline='#D4A843', width=4)

    # Header badge: TOPIK I
    badge_text = "TOPIK I  한국어능력시험"
    bb = draw.textbbox((0, 0), badge_text, font=fonts['mid'])
    bw = bb[2] - bb[0]
    badge_x = (W - bw) // 2 - 20
    badge_w = bw + 40
    draw.rounded_rectangle((badge_x, 55, badge_x + badge_w, 100), 15, fill='#C62828')
    draw.text(((W - bw) // 2, 58), badge_text, font=fonts['mid'], fill='white')

    # D-Day number
    if d_day > 0:
        d_text = f"D-{d_day}"
    elif d_day == 0:
        d_text = "D-Day!"
    else:
        d_text = f"D+{abs(d_day)}"

    bb_d = draw.textbbox((0, 0), d_text, font=fonts['huge'])
    dw = bb_d[2] - bb_d[0]
    dh = bb_d[3] - bb_d[1]
    d_x = (W - dw) // 2
    d_y = 160
    draw.text((d_x, d_y), d_text, font=fonts['huge'], fill='#C62828')

    # Decorative line
    line_y = d_y + dh + 50
    draw.line([(100, line_y), (W - 100, line_y)], fill='#D4A843', width=3)

    # Exam date
    exam_label = "시험일 (ថ្ងៃប្រឡង)"
    exam_date_text = "2026년 5월 17일 (일)"

    label_y = line_y + 30
    bb_el = draw.textbbox((0, 0), exam_label, font=fonts['sm'])
    draw.text(((W - (bb_el[2] - bb_el[0])) // 2, label_y), exam_label, font=fonts['sm'], fill='#888888')

    exam_y = label_y + 40
    bb_ed = draw.textbbox((0, 0), exam_date_text, font=fonts['big'])
    draw.text(((W - (bb_ed[2] - bb_ed[0])) // 2, exam_y), exam_date_text, font=fonts['big'], fill='#1A1A1A')

    # Today's date
    today_label = "오늘 (ថ្ងៃនេះ)"
    weekday_kr = ['월', '화', '수', '목', '금', '토', '일']
    wd = weekday_kr[today.weekday()]
    today_text = f"{today.year}년 {today.month}월 {today.day}일 ({wd})"

    today_label_y = exam_y + 80
    bb_tl = draw.textbbox((0, 0), today_label, font=fonts['sm'])
    draw.text(((W - (bb_tl[2] - bb_tl[0])) // 2, today_label_y), today_label, font=fonts['sm'], fill='#888888')

    today_y = today_label_y + 40
    bb_td = draw.textbbox((0, 0), today_text, font=fonts['mid'])
    draw.text(((W - (bb_td[2] - bb_td[0])) // 2, today_y), today_text, font=fonts['mid'], fill='#333333')

    # Decorative line 2
    line2_y = today_y + 60
    draw.line([(100, line2_y), (W - 100, line2_y)], fill='#D4A843', width=3)

    # Motivational message
    msg_kr = "매일 30단어, 꾸준히 하면 합격!"
    msg_km = "រៀនពាក្យ ៣០ រាល់ថ្ងៃ ជាប់ប្រាកដ!"

    msg_y = line2_y + 35
    bb_mk = draw.textbbox((0, 0), msg_kr, font=fonts['mid'])
    draw.text(((W - (bb_mk[2] - bb_mk[0])) // 2, msg_y), msg_kr, font=fonts['mid'], fill='#C62828')

    msg_km_y = msg_y + 50
    bb_mm = draw.textbbox((0, 0), msg_km, font=fonts['km'])
    draw.text(((W - (bb_mm[2] - bb_mm[0])) // 2, msg_km_y), msg_km, font=fonts['km'], fill='#555555')

    # Progress indicator (days completed)
    prog_y = msg_km_y + 70
    # Calculate study day based on 35-day program
    study_day = max(0, 35 - d_day + (TOPIK_DATE - date(2026, 5, 17)).days)
    # Simplified: just show remaining days visually
    bar_w = 500
    bar_x = (W - bar_w) // 2
    bar_h = 30

    prog_label = f"D-{d_day}" if d_day > 0 else "D-Day"
    bb_pl = draw.textbbox((0, 0), prog_label, font=fonts['xs'])
    draw.text(((W - (bb_pl[2] - bb_pl[0])) // 2, prog_y), prog_label, font=fonts['xs'], fill='#888888')

    bar_y = prog_y + 30
    draw.rounded_rectangle((bar_x, bar_y, bar_x + bar_w, bar_y + bar_h), 15, fill='#E0E0E0')
    # Progress: from 35 days out to exam day
    progress = max(0, min(1, (35 - d_day) / 35)) if d_day <= 35 else 0
    filled = int(bar_w * progress)
    if filled > 0:
        draw.rounded_rectangle((bar_x, bar_y, bar_x + filled, bar_y + bar_h), 15, fill='#C62828')

    # VERI-K branding
    brand = "VERI-K"
    bb_br = draw.textbbox((0, 0), brand, font=fonts['mid'])
    draw.text(((W - (bb_br[2] - bb_br[0])) // 2, H - 70), brand, font=fonts['mid'], fill='#D4A843')

    img.save(output_path, 'PNG')
    print(f"OK:{output_path}")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python3 generate_countdown_card.py <YYYY-MM-DD> <output_path>")
        sys.exit(1)
    generate_countdown_card(sys.argv[1], sys.argv[2])
