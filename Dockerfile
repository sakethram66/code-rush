# Code Rush - coding competition platform.
#
# The image bundles the C/Python/Java toolchains the judge needs at *runtime* (not just to build the
# app), because judged code is compiled and run inside this same container.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      python3 \
      openjdk-17-jdk-headless \
      util-linux \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

RUN mkdir -p /app/data && chmod 700 /app/data

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/coderush.db \
    JUDGE_WORK_DIR=/tmp/coderush-judge

EXPOSE 3000

# The server runs as root so the judge can drop privileges to an unprivileged uid per run (see
# README "Security"). It never executes team code as root.
CMD ["node", "server/index.js"]
