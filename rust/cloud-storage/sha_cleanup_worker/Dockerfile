FROM rust:latest AS builder

WORKDIR /app

# enable sqlx offline mode
# ensure you have run make prepare_db BEFORE building the image
ENV SQLX_OFFLINE=true

COPY ./Cargo.lock Cargo.lock
COPY ./Cargo.toml Cargo.toml
COPY ./.sqlx .sqlx

COPY ./src src

RUN --mount=type=cache,id=cargo_build,target=/usr/local/cargo/registry cargo build --release

RUN rm -rf ./src

FROM debian:bookworm-slim AS runner

# Install ssl certs so we can connect to the DB with ssl true
RUN apt-get update && apt install -y ca-certificates openssl

COPY --from=builder /app/target/release/sha_cleanup_worker .

CMD ["./sha_cleanup_worker"]
