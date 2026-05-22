# Tend main app: static frontend + chat API.
# Build context = repo root. Bridge/Nango run separately under deploy/.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# App code + assets
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY project ./project
COPY config ./config

# /app/config is mounted as a volume in docker-compose so demo data
# can be swapped without rebuilding the image.

EXPOSE 3000
CMD ["node", "server.js"]
