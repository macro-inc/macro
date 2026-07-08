# Builder: compiles the worker (Rust -> wasm + JS shim). Nothing from this
# stage's toolchain (rustc, clang, npm dev deps, the cargo target dir) is
# needed at runtime, so it all stays here.
FROM rust:1.90-bookworm AS builder

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

# Copy cargo files first for dependency caching
COPY Cargo.toml Cargo.lock build.rs ./
COPY bebop-schema/Cargo.toml bebop-schema/Cargo.toml

# The macro_sync_service_jwt path dependency (`../cloud-storage/...`) resolves
# to /cloud-storage/... from /app. It lives outside this build context, so
# compose passes it in as an additional named context (see docker-compose.yml).
# Its deps are `workspace = true`, so the real cloud-storage workspace root
# manifest comes along too (single source of truth for version pins), with its
# member list shrunk to just this crate — the other members aren't in the image.
COPY --from=macro_sync_service_jwt . /cloud-storage/macro_sync_service_jwt
COPY --from=cloud_storage_manifest Cargo.toml /cloud-storage/Cargo.toml
RUN sed -i '/^members = \[$/,/^\]$/c\members = ["macro_sync_service_jwt"]' /cloud-storage/Cargo.toml

# Create dummy src to build dependencies only (cached layer)
RUN mkdir -p src bebop-schema/src && \
    echo "use worker::*; #[event(fetch)] async fn fetch(_: Request, _: Env, _: Context) -> Result<Response> { Response::ok(\"ok\") }" > src/lib.rs && \
    echo "" > bebop-schema/src/lib.rs && \
    worker-build --release && \
    rm -rf src bebop-schema/src target/wasm32-unknown-unknown/release/.fingerprint/*sync* \
           target/wasm32-unknown-unknown/release/deps/*sync*

# Copy package files and install npm dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy bebop schema and generate typescript bindings
COPY bebop/ bebop/
RUN cd bebop && npx bebopc build

# Copy remaining source files
COPY . .

# Build the actual application
RUN worker-build --release

# Runtime: wrangler dev serving the prebuilt worker. Needs node + the
# production npm deps (wrangler brings miniflare/workerd along), the built
# worker, the wrangler config, and the D1 migrations — nothing else.
FROM node:22-bookworm-slim

# curl for the compose healthcheck; ca-certificates for wrangler's TLS.
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY wrangler.docker.toml ./
COPY database/ database/
COPY --from=builder /app/build build/

EXPOSE 8787

# Generate .dev.vars from environment variables so wrangler can resolve secret bindings,
# apply local D1 migrations, then start.
CMD sh -c 'printf "LOCAL_API_KEY=%s\nDOCUMENT_PERMISSIONS_SECRET=%s\nSPS_API_SECRET_KEY=%s\n" "$INTERNAL_API_SECRET_KEY" "$DOCUMENT_PERMISSIONS_SECRET" "$INTERNAL_API_SECRET_KEY" > .dev.vars && CI=true npx wrangler d1 migrations apply USER_PEER_MAPPING --local --config wrangler.docker.toml && exec npx wrangler dev --local --ip 0.0.0.0 --port 8787 --config wrangler.docker.toml'
