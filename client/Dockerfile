FROM node:18-alpine

WORKDIR /app

# Accept environment variables from docker-compose
ARG REACT_APP_API_URL
ARG REACT_APP_COLLABORATION_URL
ARG REACT_APP_DOCUMENTS_URL
ARG REACT_APP_EMAILJS_SERVICE_ID
ARG REACT_APP_EMAILJS_TEMPLATE_ID
ARG REACT_APP_EMAILJS_PUBLIC_KEY

# Set environment variables for React build
ENV REACT_APP_API_URL=${REACT_APP_API_URL:-http://localhost:3001}
ENV REACT_APP_DOCUMENTS_URL=${REACT_APP_DOCUMENTS_URL:-http://localhost:3002}
ENV REACT_APP_COLLABORATION_URL=${REACT_APP_COLLABORATION_URL:-http://localhost:4000}
ENV REACT_APP_AUTH_URL=http://localhost:3001
ENV REACT_APP_EMAILJS_SERVICE_ID=${REACT_APP_EMAILJS_SERVICE_ID}
ENV REACT_APP_EMAILJS_TEMPLATE_ID=${REACT_APP_EMAILJS_TEMPLATE_ID}
ENV REACT_APP_EMAILJS_PUBLIC_KEY=${REACT_APP_EMAILJS_PUBLIC_KEY}

COPY package*.json ./
RUN npm ci

COPY . .

# Force rebuild by adding a timestamp
RUN echo $(date) > build_timestamp.txt

RUN npm run build

FROM nginx:alpine

COPY --from=0 /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
