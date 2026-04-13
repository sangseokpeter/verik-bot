FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-pillow \
    fonts-noto-cjk \
    ffmpeg \
    libraqm-dev \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

RUN pip3 install requests Pillow --break-system-packages --force-reinstall --no-cache-dir

WORKDIR /app
COPY requirements.txt ./
RUN pip3 install -r requirements.txt --break-system-packages
COPY package*.json ./
RUN npm install
COPY . .

CMD ["node", "src/index.js"]
