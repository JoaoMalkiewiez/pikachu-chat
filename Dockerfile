FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public ./public
RUN mkdir -p /app/data
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/app/data USE_TLS=0
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node","server.js"]
