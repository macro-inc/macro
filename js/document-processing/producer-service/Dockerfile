FROM node:20-alpine3.18 AS base
# Install Python and make.
RUN apk add --no-cache python3 py3-pip make g++ openssl
# Create a symlink for python
RUN ln -sf python3 /usr/bin/python
# PNPM env setup
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable
RUN corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Skip installing handlers
ENV skip_handlers=1

COPY . .

FROM base AS build
WORKDIR /app
# Install dev dependencies
RUN --mount=type=cache,id=pnpm_build,target=/pnpm/store pnpm install --frozen-lockfile

# Build
RUN pnpm build

FROM base AS service
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs
# Copy over contents from build
COPY --from=build --chown=nodejs:nodejs /app/ .
# Remove all node_modules
RUN rm -rf node_modules
# Install production modules
RUN --mount=type=cache,id=pnpm_prod,target=/pnpm/store pnpm install --frozen-lockfile

RUN apk --no-cache add ca-certificates openssl

USER nodejs
WORKDIR /app

ENV PORT=8080

EXPOSE ${PORT}
CMD [ "npm", "run", "start"]
