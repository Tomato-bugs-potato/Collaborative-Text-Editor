FROM node:18

WORKDIR /app

# Copy service manifests from monorepo root context
COPY services/auth-service/package*.json ./

# Install service dependencies
RUN npm install --omit=dev

# Copy shared utilities and install their deps
COPY services/shared-utils ./shared-utils
RUN cd shared-utils && npm install --omit=dev

# Copy Prisma schema and service source
COPY services/auth-service/schema.prisma ./schema.prisma
COPY services/auth-service .

# Generate Prisma client (schema push happens at runtime)
RUN npx prisma generate

EXPOSE 3001

CMD ["npm", "start"]