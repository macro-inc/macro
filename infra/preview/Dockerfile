# The Fly preview machine image: the entire local stack inside one VM.
#
# Built by .github/workflows/preview-fly.yml from a STAGED context (not the
# repo root) — CI lays out everything the machine needs and this file just
# copies it in:
#
#   repo/       minimal repo layout xtask reads (compose files, migrations,
#               index helpers) — MACRO_REPO_ROOT points here
#   artifacts/  binaries/ (zigbuild output), frontend-dist/ (same-origin
#               bundle), snapshots/ (baked init snapshot)
#   bin/xtask   prebuilt orchestrator (release, x86_64 glibc)
#   preload/    docker-save tar of every image the stack runs, loaded into the
#               inner daemon at boot so nothing is pulled or built in the VM
#
# Fly machines are full microVMs, so an inner Docker daemon runs the same
# compose topology as `just run_local` — the preview IS the local stack.
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
      docker.io \
      docker-compose-v2 \
      docker-buildx \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

COPY . /srv/macro
RUN chmod +x /srv/macro/entrypoint.sh /srv/macro/bin/xtask

# Point the prebuilt xtask at the staged layout (its compiled-in paths refer to
# the CI checkout) and at the baked snapshot store.
ENV MACRO_REPO_ROOT=/srv/macro/repo \
    MACRO_STACK_SNAPSHOT_DIR=/srv/macro/artifacts/snapshots

# The instance's single-origin proxy (fly.toml's internal_port).
EXPOSE 8090

ENTRYPOINT ["/srv/macro/entrypoint.sh"]
