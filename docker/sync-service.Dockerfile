# syntax=docker/dockerfile:1.7

# Builder: compiles the worker (Rust -> wasm + JS shim). Nothing from this
# stage's toolchain (rustc, clang, npm dev deps, the cargo target dir) is
# needed at runtime, so it all stays here.
# Pinned to the exact patch the repo's rust-toolchain.toml asks for: the
# floating 1.94 tag moved to 1.94.1, and rustup then tried to download 1.94.0
# from scratch on every cargo invocation below.
FROM rust:1.94.0-bookworm AS builder

# rust-toolchain.toml also names components (rust-src, rust-analyzer) and host
# targets this image has no use for, which is enough on its own to make rustup
# re-sync the channel. Selecting the installed toolchain explicitly makes
# rustup skip the file, so the build never touches static.rust-lang.org.
ENV RUSTUP_TOOLCHAIN=1.94.0

# Install Node.js 22.x
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install llvm/clang for ring crate compilation
RUN apt-get update && apt-get install -y \
    llvm \
    clang \
    && rm -rf /var/lib/apt/lists/*

# Keep the build tool aligned with services/sync-service/justfile and the
# workspace's wasm-bindgen floor.
ENV CARGO_BUILD_JOBS=4
RUN rustup target add wasm32-unknown-unknown && \
    cargo install worker-build@=0.8.4 --locked

WORKDIR /app

COPY . .

# Install the sync service's JavaScript build dependencies.
RUN cd services/sync-service && npm ci

# Copy bebop schema and generate typescript bindings
RUN node crates/sync_protocol/bebop/generate.mjs

# Build the actual application. The workspace context changes whenever a
# dependent Rust crate changes; preserve Cargo's target cache across those
# BuildKit layer invalidations so branch reconciliation stays incremental.
RUN --mount=type=cache,id=macro-sync-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=macro-sync-cargo-target,target=/app/target \
    cd services/sync-service && worker-build --profile sync-service-release

# Runtime: wrangler dev serving the prebuilt worker. Needs node + the
# production npm deps (wrangler brings miniflare/workerd along), the built
# worker, the wrangler config, and the D1 migrations — nothing else.
FROM node:22-bookworm-slim

WORKDIR /app

COPY services/sync-service/package.json services/sync-service/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY services/sync-service/wrangler.docker.toml ./
COPY services/sync-service/database/ database/
COPY --from=builder /app/services/sync-service/build build/

EXPOSE 8787

# Generate .dev.vars from environment variables so wrangler can resolve secret bindings,
# apply local D1 migrations, then start.
CMD ["sh", "-c", "printf \"LOCAL_API_KEY=%s\\nDOCUMENT_PERMISSIONS_SECRET=%s\\nSPS_API_SECRET_KEY=%s\\nDSS_INTERNAL_AUTH_KEY=%s\\nLEXICAL_SERVICE_AUTH_KEY=%s\\nCOMMENT_GATE_MODE=%s\\n\" \"$INTERNAL_API_SECRET_KEY\" \"$DOCUMENT_PERMISSIONS_SECRET\" \"$INTERNAL_API_SECRET_KEY\" \"$DSS_INTERNAL_AUTH_KEY\" \"$INTERNAL_API_SECRET_KEY\" \"${COMMENT_GATE_MODE:-http}\" > .dev.vars && CI=true npx wrangler d1 migrations apply USER_PEER_MAPPING --local --config wrangler.docker.toml && exec npx wrangler dev --local --ip 0.0.0.0 --port 8787 --config wrangler.docker.toml"]
