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

    # Exam date (small, in parentheses below D-day)
    exam_info = "시험일 (2026년 5월 17일 일요일)"
    bb_ei = draw.textbbox((0, 0), exam_info, font=fonts['sm'])
    draw.text(((W - (bb_ei[2] - bb_ei[0])) // 2, d_y + dh + 30), exam_info, font=fonts['sm'], fill='#888888')

    # Decorative line
    line_y = d_y + dh + 80
    draw.line([(100, line_y), (W - 100, line_y)], fill='#D4A843', width=3)

    # Decorative line 2 (for spacing before motivational message)
    line2_y = line_y + 30

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

    # VERI-K logo branding
    script_dir = os.path.dirname(os.path.abspath(__file__))
    logo_path = os.path.join(script_dir, '..', 'assets', 'verik_logo.png')
    if not os.path.exists(logo_path):
        logo_path = '/app/assets/verik_logo.png'
    if os.path.exists(logo_path):
        logo = Image.open(logo_path).convert('RGBA')
        logo_h = 60
        logo_w = int(logo.width * logo_h / logo.height)
        logo = logo.resize((logo_w, logo_h), Image.LANCZOS)
        logo_x = (W - logo_w) // 2
        logo_y = H - logo_h - 25
        img.paste(logo, (logo_x, logo_y), logo)
    else:
        # Fallback to text if logo not found
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
