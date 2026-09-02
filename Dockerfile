# HSO Accurate Background Sync Engine
# Deploy via Coolify (Docker)

FROM node:20-alpine

WORKDIR /app

# Set default production environment
ENV NODE_ENV=production
ENV PORT=3005

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy source
COPY src/ ./src/

# Expose server port
EXPOSE 3005

# Healthcheck endpoint
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:3005/health || exit 1

CMD ["node", "src/index.js"]
