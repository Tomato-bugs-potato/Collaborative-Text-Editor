FROM node:18-alpine

WORKDIR /app

# Accept environment variables from docker-compose
ARG REACT_APP_API_URL
ARG REACT_APP_COLLABORATION_URL
ARG REACT_APP_DOCUMENTS_URL

# Create .env file with build-time environment variables
RUN echo "REACT_APP_API_URL=http://localhost:3001" > .env && \
    echo "REACT_APP_DOCUMENTS_URL=http://localhost:3002" >> .env && \
    echo "REACT_APP_COLLABORATION_URL=http://localhost:4000" >> .env && \
    echo "REACT_APP_AUTH_URL=http://localhost:3001" >> .env

COPY package*.json ./
RUN npm ci

COPY . .

# Force rebuild by adding a timestamp
RUN echo $(date) > build_timestamp.txt

RUN npm run build

FROM nginx:alpine

COPY --from=0 /app/build /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
