FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY . .
RUN mkdir -p /app/server/data
EXPOSE 8080
CMD ["node", "server/server.js"]
