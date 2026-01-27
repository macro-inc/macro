FROM rust:1.87-bookworm

# Install Node.js 22.x
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g npm@latest

# Install llvm/clang for ring crate compilation
RUN apt-get update && apt-get install -y \
    llvm \
    clang \
    && rm -rf /var/lib/apt/lists/*

# Install wasm32 target and worker-build
RUN rustup target add wasm32-unknown-unknown && \
    cargo install worker-build

WORKDIR /app

# Copy package files and install npm dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy bebop schema and generate typescript bindings
COPY bebop/ bebop/
RUN cd bebop && npx bebopc build

# Copy remaining source files
COPY . .

# Build the worker (generates Rust bebop bindings and compiles to wasm)
RUN worker-build --release

EXPOSE 8787

# Run wrangler dev with local mode and bind to all interfaces
CMD ["npx", "wrangler", "dev", "--local", "--ip", "0.0.0.0", "--port", "8787"]
