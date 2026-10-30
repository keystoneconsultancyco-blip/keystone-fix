# One image runs both services. ROLE=web (default) starts the dashboard,
# ROLE=worker starts the always-on worker. Based on the official Playwright
# image so Chromium and its system libraries are already installed.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DATA_DIR=/data \
    HF_HOME=/data/models

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
RUN npm run build && mkdir -p /data

EXPOSE 3000
CMD ["sh", "scripts/start.sh"]
