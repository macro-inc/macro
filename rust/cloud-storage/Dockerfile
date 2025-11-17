# Set the cache image name
ARG CACHE_IMAGE=569036502058.dkr.ecr.us-east-1.amazonaws.com/cloud-storage-cache:latest
# Load the cache image
FROM ${CACHE_IMAGE} AS cache

ARG SERVICE_NAME
ENV SQLX_OFFLINE=true

FROM rust:latest AS chef
ARG SERVICE_NAME
ENV SQLX_OFFLINE=true
RUN cargo install cargo-strip
WORKDIR /app

FROM chef AS builder
ARG SERVICE_NAME

# COPY the pre-built dependencies from cache image
COPY --from=cache /app/target target
COPY --from=cache /usr/local/cargo /usr/local/cargo

COPY . .

# Build the service
RUN cargo build --release --bin ${SERVICE_NAME} && \
  cargo strip && \
  mv /app/target/release/${SERVICE_NAME} /app/svc

# Create slim runner to run the service
FROM debian:trixie-slim AS runner
ARG SERVICE_NAME
WORKDIR /app

RUN : \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
  ca-certificates \
  openssl \
  dumb-init \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/svc /app/svc
RUN chmod +x svc

ENV PORT=8080
EXPOSE ${PORT}

ENTRYPOINT ["dumb-init", "./svc"]
