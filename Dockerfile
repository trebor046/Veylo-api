FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp precisa existir como binário no PATH: o /download faz spawn("yt-dlp").
# pip traz a versão mais recente (a do apt em bookworm é antiga e quebra extractors).
RUN pip3 install --break-system-packages --no-cache-dir yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8080

CMD ["npm", "start"]
