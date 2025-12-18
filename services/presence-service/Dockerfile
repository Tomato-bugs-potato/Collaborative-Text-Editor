FROM node:18-alpine

WORKDIR /app

# Copy package files from the context (./services)
COPY ./presence-service/package*.json ./

RUN npm install --omit=dev

# Copy shared utils
COPY ./shared-utils ./shared-utils

# Install shared utils dependencies
RUN cd ./shared-utils && npm install

# Copy the rest of the application
COPY ./presence-service/ .

EXPOSE 3005

CMD ["node", "index.js"]
