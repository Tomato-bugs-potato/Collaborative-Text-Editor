FROM node:18

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application files
COPY . .

# Generate Prisma client (schema push happens at runtime)
RUN npx prisma generate

# Expose port
EXPOSE 3001

CMD ["npm", "start"]