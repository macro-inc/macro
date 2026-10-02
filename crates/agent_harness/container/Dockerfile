# The image an agent session runs in: a nix devshell, opencode, and the ACP
# sidecar the harness dials.

# Sidecar install
FROM docker.io/library/rust:1.94.0-bullseye AS sidecar-build
RUN cargo install --locked --version 0.71.0 difftastic --root /review-engine
WORKDIR /crates/agent_harness/container/sidecar
COPY crates/agent_harness/container/sidecar/Cargo.toml crates/agent_harness/container/sidecar/Cargo.lock ./
COPY crates/agent_harness/container/sidecar/src ./src
COPY crates/agent_review_runtime /crates/agent_review_runtime
COPY vendor/diffd-core /vendor/diffd-core
# Keep workspace dependency versions identical to Macro without copying its
# backend members into the standalone sidecar build.
COPY Cargo.toml /macro-workspace.toml
RUN awk 'BEGIN {print "[workspace]\nresolver = \"2\"\nmembers = [\"crates/agent_review_runtime\", \"vendor/diffd-core\"]\n"} \
    /^\[workspace.dependencies\]/ {copy = 1} \
    copy && /^\[/ && $0 != "[workspace.dependencies]" {exit} \
    copy {print}' /macro-workspace.toml > /Cargo.toml
RUN cargo build --locked --release

# Macro nix devshell hard install
FROM docker.io/library/ubuntu:22.04 AS nix-build

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
COPY crates/agent_harness/container/flake.nix crates/agent_harness/container/flake.lock ./

# The flake exposes x86_64-linux and aarch64-linux. `nix develop` uses the
# container's arch, so an unpinned `docker build` on Apple Silicon is native.
RUN nix develop --profile /env/.base-root path:/env --command true && \
    nix print-dev-env path:/env > /env/dev-env.sh

# Bake the macro repo's dev shell, so sandboxes skip realization entirely
# (git comes from the base shell).
#
# Drop stripe-cli from the cloned flake: nixpkgs 1.43.2's checkPhase fails in
# this sandbox (TestResolvePluginForInstallSucceedsForGAPluginWhenNotLoggedIn)
# and a cache miss then fails the whole image. Revert once nixpkgs skips that
# test or ships a cached build.
RUN bash -c 'source /env/dev-env.sh && \
      git clone --depth 1 https://github.com/macro-inc/macro.git /tmp/bake && \
      sed -i "/stripe-cli/d" /tmp/bake/nix/cloud-storage.nix && \
      nix develop --accept-flake-config --profile /env/.repo-root path:/tmp/bake --command true && \
      nix print-dev-env --accept-flake-config path:/tmp/bake > /env/repo-dev-env.sh && \
      rm -rf /tmp/bake' && \
    nix-collect-garbage -d && \
    rm -rf /root/.cache/nix

# Runtime
FROM docker.io/library/ubuntu:22.04

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

COPY --from=sidecar-build /crates/agent_harness/container/sidecar/target/release/acp-sidecar /opt/acp-sidecar
COPY --from=sidecar-build /review-engine/bin/difft /opt/difft
COPY crates/agent_harness/container/opencode.json /root/.config/opencode/opencode.json
COPY crates/agent_harness/container/SYSTEM.md /etc/macro-agent/SYSTEM.md

CMD ["bash"]
