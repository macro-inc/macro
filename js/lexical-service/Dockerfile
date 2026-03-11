FROM oven/bun:1
WORKDIR /app

ARG GITHUB_PACKAGES_TOKEN
RUN echo '[install.scopes]\nmacro-inc = { token = "'${GITHUB_PACKAGES_TOKEN}'", url = "https://npm.pkg.github.com" }' > /root/.bunfig.toml

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

EXPOSE 8096

CMD ["bun", "run", "src/server.ts"]
