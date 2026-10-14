# Chromium is needed by whatsapp-web.js (Puppeteer). Alpine keeps it small.
FROM node:22-alpine
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
# Persist the WhatsApp session across restarts (mount a volume here).
VOLUME ["/app/.wwebjs_auth"]
EXPOSE 8088
CMD ["node", "src/index.js"]
