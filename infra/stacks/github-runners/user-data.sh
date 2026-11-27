#!/usr/bin/env bash
# First-boot bootstrap for the db-migrator GitHub Actions runner. cloud-init
# runs it once per instance and logs to /var/log/cloud-init-output.log.
# runner.ts inserts GITHUB_RUNNER_URL and GITHUB_RUNNER_TOKEN after the next line.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

# What the jobs run: the AWS CLI (database URLs from Secrets Manager, S3
# presigning), jq, git (checkout) and sqlx-cli (migrations). The runners
# register last, so a box that failed to bootstrap never takes a job.
AWS_CLI_VERSION=2.42.5
AWS_CLI_SHA256=7694a5b0bdd31ddccdbe9c103849cfe1a2aa4b4768e803a50ae94610aa970800
# The workspace's sqlx version (Cargo.toml).
SQLX_CLI_VERSION=0.8.6
RUST_TOOLCHAIN=1.94.0
RUNNER_VERSION=2.338.2
RUNNER_SHA256=baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40

RUNNER_USER=runner
RUNNER_GROUP=monorepo
RUNNER_LABEL=db-migrator
# Slot 1 keeps the old runner's name so `--replace` takes over its
# registration; slot 2 lets a migration run beside a long rollout job.
RUNNER_NAMES=(db-migrator-runner db-migrator-runner-2)
# Memory kept outside the runners' slice, for the OS and the SSM agent.
OS_RESERVED_KIB=$((768 * 1024))

apt-get update -y
apt-get install -y --no-install-recommends \
  build-essential ca-certificates curl git jq pkg-config unzip

# ─── AWS CLI v2 ───────────────────────────────────────────────────────────────
work=$(mktemp -d)
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AWS_CLI_VERSION}.zip" \
  -o "$work/awscliv2.zip"
echo "${AWS_CLI_SHA256}  $work/awscliv2.zip" | sha256sum --check --strict -
unzip -q "$work/awscliv2.zip" -d "$work"
"$work/aws/install" --update
aws --version

# ─── sqlx-cli ─────────────────────────────────────────────────────────────────
# Built once with a throwaway toolchain, which is then deleted: jobs on this
# runner must not compile anything, and a checkout's rust-toolchain.toml would
# otherwise make any `cargo` call install the repository's whole toolchain.
export RUSTUP_HOME="$work/rustup" CARGO_HOME="$work/cargo"
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --no-modify-path --profile minimal --default-toolchain "$RUST_TOOLCHAIN"
"$CARGO_HOME/bin/cargo" install --locked --root /usr/local \
  --version "$SQLX_CLI_VERSION" --no-default-features --features rustls,postgres sqlx-cli
unset RUSTUP_HOME CARGO_HOME
rm -rf "$work"
# `cargo-sqlx` needs cargo, which this box deliberately lacks; keep `sqlx`.
rm -f /usr/local/bin/cargo-sqlx
apt-get purge -y --auto-remove build-essential pkg-config
sqlx --version

# ─── Runners ──────────────────────────────────────────────────────────────────
if ! id -u "$RUNNER_USER" &>/dev/null; then
  useradd --create-home --shell /bin/bash "$RUNNER_USER"
fi

tarball=$(mktemp)
curl -fsSL \
  "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
  -o "$tarball"
echo "${RUNNER_SHA256}  $tarball" | sha256sum --check --strict -

# Every runner process runs in this slice. A job that outgrows it is killed by
# the kernel inside the slice and fails its step, instead of exhausting the
# machine until it stops answering.
mem_kib=$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)
cat >/etc/systemd/system/github-runner.slice <<EOF
[Unit]
Description=GitHub Actions runners

[Slice]
MemoryMax=$((mem_kib - OS_RESERVED_KIB))K
EOF

for name in "${RUNNER_NAMES[@]}"; do
  dir="/home/${RUNNER_USER}/${name}"
  install -d -o "$RUNNER_USER" -g "$RUNNER_USER" "$dir"
  tar -xzf "$tarball" -C "$dir"
  chown -R "${RUNNER_USER}:${RUNNER_USER}" "$dir"
  (cd "$dir" && ./bin/installdependencies.sh)

  sudo -u "$RUNNER_USER" "$dir/config.sh" \
    --unattended \
    --url "$GITHUB_RUNNER_URL" \
    --token "$GITHUB_RUNNER_TOKEN" \
    --name "$name" \
    --labels "$RUNNER_LABEL" \
    --runnergroup "$RUNNER_GROUP" \
    --work _work \
    --replace

  (cd "$dir" && ./svc.sh install "$RUNNER_USER")
  unit=$(cat "$dir/.service")

  # The generated unit neither restarts nor survives a job's OOM kill:
  # restart it whenever it exits, and keep it running when the kernel kills
  # one of its processes so the runner can report the failed step.
  install -d "/etc/systemd/system/${unit}.d"
  cat >"/etc/systemd/system/${unit}.d/10-db-migrator.conf" <<'EOF'
[Service]
Slice=github-runner.slice
Restart=always
RestartSec=15s
OOMPolicy=continue
EOF
done
rm -f "$tarball"

systemctl daemon-reload
for name in "${RUNNER_NAMES[@]}"; do
  systemctl enable --now "$(cat "/home/${RUNNER_USER}/${name}/.service")"
done

echo ">>> db-migrator runner bootstrap complete"
