FROM node:24-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN node ace build

FROM node:24-alpine AS production

RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY --from=builder /app/build ./
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3333
CMD ["node", "bin/server.js"]
