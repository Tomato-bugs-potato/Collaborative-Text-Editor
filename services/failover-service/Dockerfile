FROM node:18-alpine

WORKDIR /usr/src/app

COPY failover-service/package*.json ./
COPY shared-utils ./shared-utils

RUN npm install

COPY failover-service/ .

CMD ["npm", "start"]
