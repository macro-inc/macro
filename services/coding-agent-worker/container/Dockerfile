FROM golang:1.26 AS sidecar-build
WORKDIR /build
COPY sidecar/ ./
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /build/acp-sidecar .

FROM ubuntu:22.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl xz-utils ca-certificates sudo && \
    rm -rf /var/lib/apt/lists/*

# Determinate Systems installer: handles root + no-init-system Docker builds
# cleanly (the upstream nixos.org installer assumes systemd/launchd for this).
RUN curl -fsSL https://install.determinate.systems/nix | \
    sh -s -- install linux --init none --no-confirm

ENV PATH=/nix/var/nix/profiles/default/bin:$PATH
ENV NIX_CONFIG="experimental-features = nix-command flakes"

WORKDIR /env
COPY flake.nix flake.lock* ./

# Bake the fully-resolved devshell environment (PATH, env vars) into a plain
# bash script at build time. This realises the nix store paths once, here,
# instead of re-evaluating the flake on every command.
RUN nix print-dev-env > /env/dev-env.sh

# gets us to use the nix devshell environment
ENV BASH_ENV=/env/dev-env.sh
ENV SHELL=/bin/bash

COPY --from=sidecar-build /build/acp-sidecar /opt/acp-sidecar
COPY opencode.json /root/.config/opencode/opencode.json

CMD ["bash"]
