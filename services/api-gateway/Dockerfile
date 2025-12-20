FROM node:18-slim

WORKDIR /app

# Copy package files
COPY ./api-gateway/package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy shared utils
COPY ./shared-utils ./shared-utils

# Install shared utils dependencies
RUN cd ./shared-utils && npm install

# Copy application files
COPY ./api-gateway/ .

EXPOSE 4000

CMD ["npm", "start"]
