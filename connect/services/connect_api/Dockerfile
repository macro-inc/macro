# syntax=docker/dockerfile:1
FROM rust:1.94-bookworm AS builder
WORKDIR /app
ENV SQLX_OFFLINE=true
RUN apt-get update && apt-get install -y --no-install-recommends cmake clang libclang-dev && rm -rf /var/lib/apt/lists/*
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=shared \
    --mount=type=cache,target=/usr/local/cargo/git/db,sharing=shared \
    cargo build --release --locked -p connect_api --bin connect_api && \
    strip target/release/connect_api

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 connect
COPY --from=builder /app/target/release/connect_api /usr/local/bin/connect_api
USER connect
EXPOSE 8080
ENTRYPOINT ["connect_api"]
