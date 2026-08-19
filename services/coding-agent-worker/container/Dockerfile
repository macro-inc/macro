# Sidecar install
FROM rust:1.94.0-slim-bullseye AS sidecar-build
WORKDIR /build
COPY sidecar/Cargo.toml sidecar/Cargo.lock ./
COPY sidecar/src ./src
RUN cargo build --locked --release

# Macro nix devshell hard install
FROM ubuntu:22.04 AS nix-build

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl xz-utils && \
    rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://install.determinate.systems/nix | \
    sh -s -- install linux --init none --no-confirm

ENV PATH=/nix/var/nix/profiles/default/bin:$PATH
ENV NIX_CONFIG="experimental-features = nix-command flakes"

# Trust the public macro-inc Cachix cache (read-only, no token in the sandbox)
# so dev shells substitute instead of building.
RUN printf '%s\n' \
      'extra-substituters = https://macro-inc.cachix.org' \
      'extra-trusted-public-keys = macro-inc.cachix.org-1:5cwmXb6wn9TsqE/6uWwY7doHYrq+mZhNh3Yaw5qjMzw=' \
      >> /etc/nix/nix.conf && \
    nix config show substituters | grep -q 'cache\.nixos\.org' && \
    nix config show substituters | grep -q 'macro-inc\.cachix\.org'

WORKDIR /env
COPY flake.nix flake.lock* ./

RUN nix develop --profile /env/.base-root path:/env --command true && \
    nix print-dev-env path:/env > /env/dev-env.sh

# Bake the macro repo's dev shell, so sandboxes skip realization entirely
# (git comes from the base shell).
RUN bash -c 'source /env/dev-env.sh && \
      git clone --depth 1 https://github.com/macro-inc/macro.git /tmp/bake && \
      nix develop --accept-flake-config --profile /env/.repo-root path:/tmp/bake --command true && \
      nix print-dev-env --accept-flake-config path:/tmp/bake > /env/repo-dev-env.sh && \
      rm -rf /tmp/bake' && \
    nix-collect-garbage -d && \
    rm -rf /root/.cache/nix

# Runtime
FROM ubuntu:22.04

# curl: the ensure script's readiness probe. nixbld users: nix.conf names the
# group, and source builds inside the sandbox need it.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl sudo xz-utils && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd -r nixbld && \
    for i in $(seq 1 10); do \
      useradd -r -g nixbld -G nixbld -d /var/empty -s /usr/sbin/nologin "nixbld$i"; \
    done

# Largest, least volatile layer first so sidecar/config changes reuse it.
COPY --from=nix-build /nix /nix
# The whole directory: nix.conf `!include`s nix.custom.conf.
COPY --from=nix-build /etc/nix /etc/nix
COPY --from=nix-build /env /env

ENV PATH=/nix/var/nix/profiles/default/bin:$PATH \
    BASH_ENV=/env/dev-env.sh \
    SHELL=/bin/bash

COPY --from=sidecar-build /build/target/release/acp-sidecar /opt/acp-sidecar
COPY --chmod=755 ensure.sh /opt/ensure.sh
COPY opencode.json /root/.config/opencode/opencode.json

CMD ["bash"]
