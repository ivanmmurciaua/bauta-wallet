FROM node:22-alpine
WORKDIR /app

# Frontend
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
ARG NEXT_PUBLIC_WATCHER_PORT=8765
ARG NEXT_PUBLIC_FE_PORT=8766
ENV NEXT_PUBLIC_WATCHER_PORT=$NEXT_PUBLIC_WATCHER_PORT
ENV NEXT_PUBLIC_FE_PORT=$NEXT_PUBLIC_FE_PORT
RUN npm run build

# Watcher
WORKDIR /app/stealth-watcher
COPY stealth-watcher/package.json stealth-watcher/package-lock.json ./
RUN npm ci --ignore-scripts

WORKDIR /app
RUN chmod +x entrypoint.sh
# Ports configurable via FRONTEND_PORT / WATCHER_PORT in docker-compose.yml
EXPOSE 8765 8766
ENTRYPOINT ["./entrypoint.sh"]
