FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DB_PATH=/data/lexopak.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY views ./views
COPY public ./public
VOLUME /data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
