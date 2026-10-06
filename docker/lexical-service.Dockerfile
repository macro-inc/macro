FROM oven/bun:1
WORKDIR /app

ARG GITHUB_PACKAGES_TOKEN
RUN echo '[install.scopes]\nmacro-inc = { token = "'${GITHUB_PACKAGES_TOKEN}'", url = "https://npm.pkg.github.com" }' > /root/.bunfig.toml

COPY . .
RUN bun install --frozen-lockfile

WORKDIR /app/services/lexical-service
RUN mkdir -p node_modules/@macro-inc \
  && ln -sfn /app/packages/lexical-core node_modules/@macro-inc/lexical-core

# Run a bundle, not the TS entry. Executing the unbundled TS under Bun
# evaluates the circular @lexical/* ESM imports in an order that triggers a TDZ
# ("Cannot access 'HeadingNode'/'ElementNode' before initialization");
# bundling orders the declarations, as wrangler/esbuild does for the worker.
# loro-crdt stays external: bundling it emits its .wasm as a second output
# file (breaking --outfile) and mis-wires the wasm instantiation at runtime.
# The bundle lives under /app so the external loro-crdt import resolves
# against /app/node_modules.
RUN bun build src/server.ts --target=bun --external loro-crdt --outfile=/app/server.bundle.js

EXPOSE 8096

CMD ["bun", "/app/server.bundle.js"]
