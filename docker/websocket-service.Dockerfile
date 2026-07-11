FROM oven/bun:1 AS base
WORKDIR /app

COPY services/websocket-service/package.json services/websocket-service/bun.lock* ./
RUN bun install --frozen-lockfile

COPY services/websocket-service/ .

EXPOSE 6969

CMD ["bun", "run", "start"]
