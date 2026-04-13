FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    fonts-noto-cjk \
    ffmpeg \
    libraqm-dev \
    libfribidi-dev \
    libharfbuzz-dev \
    pkg-config \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Build Pillow from source so it detects libraqm for complex script (Khmer) rendering
# build-essential provides gcc needed for Pillow source compilation
RUN pip3 install requests --break-system-packages --no-cache-dir && \
    pip3 install Pillow --break-system-packages --force-reinstall --no-cache-dir --no-binary Pillow

WORKDIR /app
COPY requirements.txt ./
RUN pip3 install -r requirements.txt --break-system-packages
COPY package*.json ./
RUN npm install
COPY . .

CMD ["node", "src/index.js"]
