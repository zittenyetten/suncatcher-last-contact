FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public
COPY artifacts ./artifacts

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV GCP_PROJECT=h2gdm-hack26icn-2676

EXPOSE 8080

CMD ["node", "server/index.mjs"]
