FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-pillow \
    fonts-noto-cjk \
    ffmpeg \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

RUN pip3 install requests Pillow --break-system-packages

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

CMD ["node", "src/index.js"]
