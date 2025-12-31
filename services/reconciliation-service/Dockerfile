FROM node:18-slim

WORKDIR /app

# Copy package files
COPY ./reconciliation-service/package*.json ./

# Install system dependencies for Prisma
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install dependencies
RUN npm install

# Copy shared utils
COPY ./shared-utils ./shared-utils
RUN cd ./shared-utils && npm install

# Copy schema from collaboration service (since we share the DB)
COPY ./document-service/schema.prisma ./prisma/schema.prisma

# Generate Prisma Client
RUN npx prisma generate

# Copy application code
COPY ./reconciliation-service/ .

EXPOSE 3004

CMD ["sh", "-c", "npx prisma generate && npm start"]