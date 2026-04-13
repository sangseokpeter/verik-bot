FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    fonts-noto-cjk \
    ffmpeg \
    imagemagick \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/* && \
    # Allow ImageMagick to read/write files (default policy may block)
    sed -i 's/rights="none" pattern="@\*"/rights="read|write" pattern="@*"/' /etc/ImageMagick-6/policy.xml 2>/dev/null || true

# Pillow binary wheel (no source build needed)
# Khmer complex script rendering handled by ImageMagick (Pango/HarfBuzz built-in)
RUN pip3 install requests Pillow --break-system-packages --no-cache-dir

WORKDIR /app
COPY requirements.txt ./
RUN pip3 install -r requirements.txt --break-system-packages
COPY package*.json ./
RUN npm install
COPY . .

CMD ["node", "src/index.js"]
