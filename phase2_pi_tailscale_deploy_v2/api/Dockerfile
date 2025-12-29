# API container for Raspberry Pi (ARM)
# Debian-based Node image avoids Alpine/musl native module pain.
FROM node:20-bookworm-slim

WORKDIR /app

# Native deps for better-sqlite3 builds on ARM
RUN apt-get update   && apt-get install -y --no-install-recommends python3 make g++   && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "src/index.js"]
