FROM node:18

WORKDIR /app

# Copy service manifests from monorepo root context
COPY services/document-service/package*.json ./

# Install service dependencies
RUN npm install --omit=dev

# Copy shared utilities and install their deps
COPY services/shared-utils ./shared-utils
RUN cd shared-utils && npm install --omit=dev

# Copy Prisma schema and service source
COPY services/document-service/schema.prisma ./schema.prisma
COPY services/document-service .

# Generate Prisma client (schema push happens at runtime)
RUN npx prisma generate

EXPOSE 3002

CMD ["npm", "start"]