FROM node:18

WORKDIR /app

# Copy package files
COPY ./document-service/package*.json ./

# Install service dependencies
RUN npm install --omit=dev

# Copy shared utils
COPY ./shared-utils ./shared-utils

# Install shared utils dependencies
RUN cd ./shared-utils && npm install

# Copy application files
COPY ./document-service/ .

# Generate Prisma client
RUN npx prisma generate

# Create startup script that runs migrations then starts the app
RUN echo '#!/bin/sh\necho "Attempting Prisma migrations..."\nnpx prisma db push --skip-generate || echo "Migration failed, skipping..."\necho "Starting document service..."\nnode index.js' > /app/start.sh && chmod +x /app/start.sh

# Expose port
EXPOSE 3002

CMD ["/app/start.sh"]