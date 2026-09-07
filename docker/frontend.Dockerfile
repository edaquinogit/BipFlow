FROM node:20-slim AS build

WORKDIR /app

COPY bipflow-frontend/package*.json ./
RUN npm ci

ARG VITE_API_URL=/api/
ENV VITE_API_URL=${VITE_API_URL}

COPY bipflow-frontend ./
RUN npm run build

FROM nginx:1.27-alpine

ARG BIPFLOW_COMMIT_SHA=local

LABEL org.opencontainers.image.source="https://github.com/edaquinogit/BipFlow" \
      org.opencontainers.image.revision="${BIPFLOW_COMMIT_SHA}" \
      org.opencontainers.image.title="BipFlow frontend"

RUN mkdir -p /etc/nginx/snippets
COPY docker/nginx-proxy-headers.conf /etc/nginx/snippets/proxy-headers.conf
COPY docker/nginx-http-maps.conf /etc/nginx/conf.d/00-maps.conf
COPY docker/frontend-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
RUN printf '{"revision":"%s"}\n' "${BIPFLOW_COMMIT_SHA}" > /usr/share/nginx/html/revision.json

EXPOSE 80
