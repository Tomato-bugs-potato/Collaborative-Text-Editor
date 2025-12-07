FROM node:18

WORKDIR /app

# Copy package files
COPY ./document-service/package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy shared utils
COPY ./shared-utils ./shared-utils

# Install shared utils dependencies
RUN cd ./shared-utils && npm install

# Copy application files
COPY ./document-service/ .

# Generate Prisma client (schema push happens at runtime)
RUN npx prisma generate

# Expose port
EXPOSE 3001

CMD ["npm", "start"]