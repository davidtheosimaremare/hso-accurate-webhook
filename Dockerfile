# HSO Accurate Background Sync Engine
# Deploy via Coolify (Docker)

FROM node:20-alpine

WORKDIR /app

# Set default production environment
ENV NODE_ENV=production

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy source
COPY src/ ./src/

# Expose common ports
EXPOSE 3005 3000

CMD ["node", "src/index.js"]
