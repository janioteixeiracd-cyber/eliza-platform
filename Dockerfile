# --- Stage 1: build ---------------------------------------------------
FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# --- Stage 2: runtime ---------------------------------------------------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY firebase-applet-config.json ./firebase-applet-config.json

EXPOSE 3000
CMD ["node", "dist/server.cjs"]
