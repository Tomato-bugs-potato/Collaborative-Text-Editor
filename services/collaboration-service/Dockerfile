FROM node:18-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install system dependencies for Prisma
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Generate Prisma Client after schema.prisma is copied
RUN npx prisma generate

EXPOSE 3003

CMD ["npm", "start"]