FROM rust:1.90-bookworm

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

# Install wasm32 target and worker-build once
RUN rustup target add wasm32-unknown-unknown && \
    cargo install worker-build@^0.8 --locked

WORKDIR /app

# Copy cargo files first for dependency caching
COPY Cargo.toml Cargo.lock build.rs ./

# Create dummy src to build dependencies only (cached layer)
RUN mkdir -p src && \
    echo "use worker::*; #[event(fetch)] async fn fetch(_: Request, _: Env, _: Context) -> Result<Response> { Response::ok(\"ok\") }" > src/lib.rs && \
    worker-build --release && \
    rm -rf src target/wasm32-unknown-unknown/release/.fingerprint/*sync* \
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

EXPOSE 8787

# Generate .dev.vars from environment variables so wrangler can resolve secret bindings, then start
CMD sh -c 'echo "LOCAL_API_KEY=${INTERNAL_API_SECRET_KEY}\nDOCUMENT_PERMISSIONS_SECRET=${DOCUMENT_PERMISSIONS_SECRET}" > .dev.vars && npx wrangler dev --local --ip 0.0.0.0 --port 8787 --config wrangler.docker.toml'
