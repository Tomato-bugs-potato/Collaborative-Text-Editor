FROM node:18-slim

WORKDIR /app

# Copy package files
COPY ./collaboration-service/package*.json ./

# Install system dependencies for Prisma
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install dependencies
RUN npm install

# Copy shared utils
COPY ./shared-utils ./shared-utils

# Install shared utils dependencies
RUN cd ./shared-utils && npm install

# Copy the rest of the application
COPY ./collaboration-service/ .

# Generate Prisma Client after schema.prisma is copied
RUN npx prisma generate

EXPOSE 3003

CMD ["npm", "start"]