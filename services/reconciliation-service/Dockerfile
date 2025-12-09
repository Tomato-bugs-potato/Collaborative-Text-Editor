FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY ./reconciliation-service/package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application code
COPY ./reconciliation-service/ .

# Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3004

CMD ["node", "index.js"]