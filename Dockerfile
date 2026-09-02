# HSO Accurate Webhook Server
# Deploy via Coolify (Docker)

FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json .
RUN npm install --production

# Copy source
COPY src/ ./src/

# Port yang diexpose
EXPOSE 3001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "src/index.js"]
