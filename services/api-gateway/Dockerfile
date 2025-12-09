FROM node:18-slim

WORKDIR /app

COPY ./api-gateway/package*.json ./
RUN npm install --omit=dev

COPY ./api-gateway/ .

EXPOSE 4000

CMD ["npm", "start"]
