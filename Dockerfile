# Chromium is needed by whatsapp-web.js (Puppeteer). Alpine keeps it small.
FROM node:22-alpine AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Persist the WhatsApp session and the durable queue (mount volumes here).
VOLUME ["/app/.wwebjs_auth", "/app/data"]
EXPOSE 8088
CMD ["node", "dist/index.js"]
