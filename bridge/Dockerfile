FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY bridge.js ./
RUN mkdir -p /data && chown -R node:node /data
USER node
ENV STATE_FILE=/data/state.json
ENV PORT=8000
EXPOSE 8000
CMD ["node", "bridge.js"]
