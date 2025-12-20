FROM node:18

WORKDIR /app

# Copy package files
COPY ./collaboration-service/package*.json ./

# Install service dependencies
RUN npm install --omit=dev

# Copy shared utilities and install their deps
COPY services/shared-utils ./shared-utils
RUN cd shared-utils && npm install --omit=dev

# Copy shared utils
COPY ./shared-utils ./shared-utils

# Install shared utils dependencies
RUN cd ./shared-utils && npm install

# Copy shared utils
COPY ./shared-utils ./shared-utils

# Install shared utils dependencies
RUN cd ./shared-utils && npm install

# Copy the rest of the application
COPY ./collaboration-service/ .

# Generate Prisma client (schema push happens at runtime)
RUN npx prisma generate

# Create startup script that runs migrations then starts the app
RUN echo '#!/bin/sh\necho "Attempting Prisma migrations..."\nnpx prisma db push --skip-generate || echo "Migration failed, skipping..."\necho "Starting collaboration service..."\nnpm start' > /app/start.sh && chmod +x /app/start.sh

EXPOSE 3003

CMD ["/app/start.sh"]