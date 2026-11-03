# Bakes the repository into a service image whose local compose service
# bind-mounts the whole checkout (`.:/app`), for `cargo x env` cluster
# environments. Installs the JavaScript workspace in the image rather than
# copying the host's node_modules. The base image keeps its CMD and WORKDIR.
ARG BASE
FROM ${BASE}
ARG GITHUB_PACKAGES_TOKEN
RUN if [ -n "${GITHUB_PACKAGES_TOKEN}" ]; then \
      printf '[install.scopes]\nmacro-inc = { token = "%s", url = "https://npm.pkg.github.com" }\n' "${GITHUB_PACKAGES_TOKEN}" > /root/.bunfig.toml; \
    fi
COPY . /app
RUN cd /app && bun install --frozen-lockfile && rm -f /root/.bunfig.toml
