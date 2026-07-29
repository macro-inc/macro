# Builder: compiles the worker (Rust -> wasm + JS shim). Nothing from this
# stage's toolchain (rustc, clang, npm dev deps, the cargo target dir) is
# needed at runtime, so it all stays here.
FROM rust:1.94-bookworm AS builder

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

# Install wasm32 target and worker-build once.
# Pinned: worker-build 0.8.3 raised its wasm-bindgen floor to 0.2.121, but the
# locked dep graph here is on wasm-bindgen 0.2.118 (via worker 0.8.1 →
# serde-wasm-bindgen → js-sys 0.3.95). Stay on 0.8.1 until worker is bumped.
RUN rustup target add wasm32-unknown-unknown && \
    cargo install worker-build@=0.8.1 --locked

WORKDIR /app

COPY . .

# Install the sync service's JavaScript build dependencies.
RUN cd services/sync-service && npm ci

# Copy bebop schema and generate typescript bindings
RUN cd services/sync-service/bebop && npx bebopc build

# Build the actual application
RUN cd services/sync-service && worker-build --profile sync-service-release

# Runtime: wrangler dev serving the prebuilt worker. Needs node + the
# production npm deps (wrangler brings miniflare/workerd along), the built
# worker, the wrangler config, and the D1 migrations — nothing else.
FROM node:22-bookworm-slim

# curl for the compose healthcheck; ca-certificates for wrangler's TLS.
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY services/sync-service/package.json services/sync-service/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY services/sync-service/wrangler.docker.toml ./
COPY services/sync-service/database/ database/
COPY --from=builder /app/services/sync-service/build build/

EXPOSE 8787

# Generate .dev.vars from environment variables so wrangler can resolve secret bindings,
# apply local D1 migrations, then start.
CMD sh -c 'printf "LOCAL_API_KEY=%s\nDOCUMENT_PERMISSIONS_SECRET=%s\nSPS_API_SECRET_KEY=%s\nDSS_INTERNAL_AUTH_KEY=%s\n" "$INTERNAL_API_SECRET_KEY" "$DOCUMENT_PERMISSIONS_SECRET" "$INTERNAL_API_SECRET_KEY" "$DSS_INTERNAL_AUTH_KEY" > .dev.vars && CI=true npx wrangler d1 migrations apply USER_PEER_MAPPING --local --config wrangler.docker.toml && exec npx wrangler dev --local --ip 0.0.0.0 --port 8787 --config wrangler.docker.toml'
