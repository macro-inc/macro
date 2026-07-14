FROM oven/bun:1
WORKDIR /app

ARG GITHUB_PACKAGES_TOKEN
RUN echo '[install.scopes]\nmacro-inc = { token = "'${GITHUB_PACKAGES_TOKEN}'", url = "https://npm.pkg.github.com" }' > /root/.bunfig.toml

COPY . .
RUN bun install --frozen-lockfile

WORKDIR /app/services/lexical-service
RUN mkdir -p node_modules/@macro-inc \
  && ln -sfn /app/packages/lexical-core node_modules/@macro-inc/lexical-core

EXPOSE 8096

CMD ["bun", "run", "src/server.ts"]
