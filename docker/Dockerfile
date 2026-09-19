# syntax=docker/dockerfile:1
FROM rust:latest AS chef
ARG SERVICE_NAME
ENV SQLX_OFFLINE=true
WORKDIR /app

FROM chef AS builder
ARG SERVICE_NAME

# cmake is needed to compile librdkafka (via rdkafka-sys, pulled in
# transitively by workspace-hack for every binary) from source; rust:latest
# doesn't include it by default.
RUN apt-get update && apt-get install -y --no-install-recommends cmake && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

COPY . .

# Build the service
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=shared \
  --mount=type=cache,target=/usr/local/cargo/git/db,sharing=shared \
  --mount=type=cache,target=/app/target,id=rust-target-release,sharing=locked \
  cargo build --release --bin ${SERVICE_NAME} && \
  strip /app/target/release/${SERVICE_NAME} && \
  cp /app/target/release/${SERVICE_NAME} /app/svc

# Create slim runner to run the service
FROM debian:trixie-slim AS runner
ARG SERVICE_NAME
WORKDIR /app

RUN : \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
  ca-certificates \
  dumb-init \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

COPY --chmod=755 --from=builder /app/svc /app/svc

ENV PORT=8080
EXPOSE ${PORT}

ENTRYPOINT ["dumb-init", "./svc"]
