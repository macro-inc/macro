FROM rust:latest AS chef 
ARG SERVICE_NAME
ENV SQLX_OFFLINE=true
# We only pay the installation cost once, 
# it will be cached from the second build onwards
RUN cargo install cargo-chef cargo-strip 
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare  --recipe-path recipe.json --bin ${SERVICE_NAME}

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
# Build dependencies - this is the caching Docker layer!
RUN cargo chef cook --release --recipe-path recipe.json --bin ${SERVICE_NAME}
# Build application
COPY . .
RUN cargo build --release --bin ${SERVICE_NAME} && \
  cargo strip && \
  mv /app/target/release/${SERVICE_NAME} /app/svc

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
