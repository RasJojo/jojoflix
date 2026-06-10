FROM node:24-alpine AS production

RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY build ./
COPY package*.json ./
RUN npm ci --legacy-peer-deps

EXPOSE 3333
CMD ["sh", "-c", "node bin/console.js migration:run --force && node bin/server.js"]
