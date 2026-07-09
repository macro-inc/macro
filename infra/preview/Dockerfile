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
#   bin/        prebuilt orchestrator + the in-place hot-update driver
#   preload/    manifest of every image the stack runs (image ID -> local tag
#               -> registry ref); the entrypoint pulls them from the app's Fly
#               registry repo at boot, skipping whatever the machine's
#               persistent layer store already has
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
      gnupg \
      jq \
    && rm -rf /var/lib/apt/lists/*

# Doppler CLI: the machine boots with a config-scoped service token
# (DOPPLER_TOKEN, set as a Fly secret by the workflow) and the stack's env
# layer pulls the preview secrets with it.
RUN curl -Ls --tlsv1.2 --proto "=https" https://cli.doppler.com/install.sh | sh

# One COPY per artifact, ordered stable → volatile: the staging step preserves
# mtimes, so a layer whose inputs didn't change this deploy is byte-identical
# to the previous image's — the registry push and the Fly host's pull both
# skip it. Everything after the first changed layer re-ships, so the pieces
# that churn every deploy (frontend bundle, service binaries) go last.
COPY entrypoint.sh /srv/macro/entrypoint.sh
COPY deployment.json /srv/macro/deployment.json
COPY repo/ /srv/macro/repo/
COPY bin/ /srv/macro/bin/
COPY artifacts/snapshots/ /srv/macro/artifacts/snapshots/
COPY preload/ /srv/macro/preload/
COPY artifacts/frontend-dist/ /srv/macro/artifacts/frontend-dist/
COPY artifacts/binaries/ /srv/macro/artifacts/binaries/
RUN chmod +x /srv/macro/entrypoint.sh /srv/macro/bin/xtask /srv/macro/bin/hot-update

# Point the prebuilt xtask at the staged layout (its compiled-in paths refer to
# the CI checkout) and at the baked snapshot store.
ENV MACRO_REPO_ROOT=/srv/macro/repo \
    MACRO_STACK_SNAPSHOT_DIR=/srv/macro/artifacts/snapshots

# The instance's single-origin proxy (fly.toml's internal_port).
EXPOSE 8090

ENTRYPOINT ["/srv/macro/entrypoint.sh"]
