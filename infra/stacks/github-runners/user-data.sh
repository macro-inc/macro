#!/usr/bin/env bash
# First-boot bootstrap for the db-migrator GitHub Actions runner. cloud-init
# runs it once per instance and logs to /var/log/cloud-init-output.log.
# runner.ts inserts GITHUB_RUNNER_URL and AWS_REGION after the next line.
set -euo pipefail

# It installs everything but registers nothing. Registering takes a one-hour
# token from an organization admin, which must not be in the user data: any
# job on the box can read that from the instance metadata service. An admin
# registers the runners afterwards with `sudo register-db-migrator-runners`
# over Session Manager (docs/runbooks/db-migrator-runner.md).

export DEBIAN_FRONTEND=noninteractive
# Files written here are readable by all and writable only by their owner,
# whatever umask the caller left.
umask 022

# What the jobs run: the AWS CLI (database URLs from Secrets Manager, S3
# presigning), jq, git (checkout) and sqlx-cli (migrations).
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
apt-get purge -y --auto-remove build-essential pkg-config
sqlx --version

# Deploys of a commit from before the migrations called `sqlx` run
# `cargo sqlx` (a rollback, a re-run). This `cargo` only forwards that
# subcommand to sqlx-cli's `cargo-sqlx` and refuses everything else.
cat >/usr/local/bin/cargo <<'EOF'
#!/bin/sh
if [ "${1:-}" = sqlx ]; then
  exec /usr/local/bin/cargo-sqlx "$@"
fi
echo "cargo: the db-migrator runner builds nothing; build on Namespace and pass the binary (docs/runbooks/db-migrator-runner.md)" >&2
exit 1
EOF
chmod 0755 /usr/local/bin/cargo
cargo sqlx --version

# ─── Runners ──────────────────────────────────────────────────────────────────
if ! id -u "$RUNNER_USER" &>/dev/null; then
  useradd --create-home --shell /bin/bash "$RUNNER_USER"
fi

# Jobs call the AWS CLI without --region, and the instance profile gives only
# credentials.
install -d -o "$RUNNER_USER" -g "$RUNNER_USER" -m 0700 "/home/${RUNNER_USER}/.aws"
printf '[default]\nregion = %s\n' "$AWS_REGION" >"/home/${RUNNER_USER}/.aws/config"
chown "${RUNNER_USER}:${RUNNER_USER}" "/home/${RUNNER_USER}/.aws/config"

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
done
rm -f "$tarball"

# Registers both runners with a token read from the terminal (or stdin), then
# starts them. The token reaches config.sh only through its environment
# (ACTIONS_RUNNER_INPUT_TOKEN), never a command line or a log, and both
# runners register before either starts. Each step is skipped once done, so a
# run that failed half-way can be repeated.
register() {
  umask 022
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run it as root: sudo register-db-migrator-runners" >&2
    return 1
  fi
  local token name dir unit
  if [ -t 0 ]; then
    read -r -s -p "Runner registration token: " token
    echo
  else
    IFS= read -r token || true
  fi
  if [ -z "$token" ]; then
    echo "No token given. See docs/runbooks/db-migrator-runner.md." >&2
    return 1
  fi

  for name in "${RUNNER_NAMES[@]}"; do
    dir="/home/${RUNNER_USER}/${name}"
    if [ -e "$dir/.runner" ]; then
      echo "${name} is already registered."
    else
      ACTIONS_RUNNER_INPUT_TOKEN="$token" runuser -u "$RUNNER_USER" -- "$dir/config.sh" \
        --unattended \
        --url "$GITHUB_RUNNER_URL" \
        --name "$name" \
        --labels "$RUNNER_LABEL" \
        --runnergroup "$RUNNER_GROUP" \
        --work _work \
        --replace
    fi

    if [ ! -e "$dir/.service" ]; then
      (cd "$dir" && ./svc.sh install "$RUNNER_USER")
    fi
    unit=$(cat "$dir/.service")

    # The generated unit neither restarts nor survives a job's OOM kill:
    # restart it whenever it exits, and keep it running when the kernel kills
    # one of its processes so the runner can report the failed step.
    install -d "/etc/systemd/system/${unit}.d"
    printf '%s\n' '[Service]' 'Slice=github-runner.slice' 'Restart=always' \
      'RestartSec=15s' 'OOMPolicy=continue' \
      >"/etc/systemd/system/${unit}.d/10-db-migrator.conf"
  done

  systemctl daemon-reload
  for name in "${RUNNER_NAMES[@]}"; do
    systemctl enable --now "$(cat "/home/${RUNNER_USER}/${name}/.service")"
  done
  echo ">>> db-migrator runners registered and started: ${RUNNER_NAMES[*]}"
}

{
  echo '#!/usr/bin/env bash'
  echo '# Written at first boot by infra/stacks/github-runners/user-data.sh.'
  echo 'set -euo pipefail'
  declare -p GITHUB_RUNNER_URL RUNNER_USER RUNNER_GROUP RUNNER_LABEL RUNNER_NAMES
  declare -f register
  # shellcheck disable=SC2016 # the generated script expands it
  echo 'register "$@"'
} >/usr/local/sbin/register-db-migrator-runners
chmod 0755 /usr/local/sbin/register-db-migrator-runners
systemctl daemon-reload

echo ">>> db-migrator runner bootstrap complete; register the runners: sudo register-db-migrator-runners"
