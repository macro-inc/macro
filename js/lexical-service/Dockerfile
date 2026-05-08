FROM oven/bun:1
WORKDIR /app

ARG GITHUB_PACKAGES_TOKEN
RUN echo '[install.scopes]\nmacro-inc = { token = "'${GITHUB_PACKAGES_TOKEN}'", url = "https://npm.pkg.github.com" }' > /root/.bunfig.toml

COPY lexical-service/package.json lexical-service/bun.lock ./
RUN bun install --frozen-lockfile

COPY lexical-service ./
COPY lexical-core ./lexical-core
COPY loro-mirror ./loro-mirror
RUN mkdir -p node_modules/@macro-inc \
  && ln -s /app/lexical-core node_modules/@macro-inc/lexical-core

EXPOSE 8096

CMD ["bun", "run", "src/server.ts"]
