#!/usr/bin/env bash
# EC2 user-data bootstrap for self-hosted GitHub Actions runners.
# Logs to /var/log/cloud-init-output.log automatically.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

# ─── System packages & updates ────────────────────────────────────────────────
apt-get update -y
apt-get upgrade -y

apt-get install -y \
  build-essential \
  pkg-config \
  libssl-dev \
  libffi-dev \
  zlib1g-dev \
  libbz2-dev \
  libreadline-dev \
  libsqlite3-dev \
  libpq-dev \
  curl \
  wget \
  git \
  jq \
  unzip \
  zip \
  gnupg \
  lsb-release \
  ca-certificates \
  apt-transport-https \
  software-properties-common \
  cmake \
  clang \
  llvm \
  protobuf-compiler \
  libprotobuf-dev \
  python3 \
  python3-pip \
  python3-venv

# ─── Docker ───────────────────────────────────────────────────────────────────
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable docker
systemctl start docker

# ─── Runner user ──────────────────────────────────────────────────────────────
RUNNER_USER="runner"
if ! id -u "$RUNNER_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$RUNNER_USER"
fi
usermod -aG docker "$RUNNER_USER"

# ─── Rust ─────────────────────────────────────────────────────────────────────
sudo -u "$RUNNER_USER" bash -c '
  curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
  rustup component add clippy rustfmt
'

# ─── Just ─────────────────────────────────────────────────────────────────────
curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh | bash -s -- --to /usr/local/bin

# ─── AWS CLI v2 ───────────────────────────────────────────────────────────────
cd /tmp
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip
unzip -qo awscliv2.zip
./aws/install --update
rm -rf awscliv2.zip aws/

# ─── Pulumi CLI ───────────────────────────────────────────────────────────────
curl -fsSL https://get.pulumi.com | bash -s -- --install-root /usr/local

# ─── SOPS ─────────────────────────────────────────────────────────────────────
SOPS_VERSION="3.9.4"
curl -fsSL "https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}/sops-v${SOPS_VERSION}.linux.amd64" \
  -o /usr/local/bin/sops
chmod +x /usr/local/bin/sops

# ─── Node.js LTS (needed by many GH Actions) ─────────────────────────────────
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
corepack enable

# ─── GitHub Actions Runner ────────────────────────────────────────────────────
RUNNER_VERSION="2.332.0"
RUNNER_SHA="f2094522a6b9afeab07ffb586d1eb3f190b6457074282796c497ce7dce9e0f2a"
RUNNER_HOME="/home/${RUNNER_USER}/actions-runner"

mkdir -p "$RUNNER_HOME"
cd "$RUNNER_HOME"

curl -fsSL \
  "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
  -o "actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"

echo "${RUNNER_SHA}  actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" | shasum -a 256 -c
tar xzf "actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
rm -f "actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"

# Install runner's own OS-level dependencies
./bin/installdependencies.sh

chown -R "${RUNNER_USER}:${RUNNER_USER}" "$RUNNER_HOME"

# ─── Configure & start the runner ─────────────────────────────────────────────
# GITHUB_RUNNER_URL and GITHUB_RUNNER_TOKEN are expected to be injected via
# Pulumi config / SSM Parameter Store / Secrets Manager at deploy time.
# The Pulumi stack interpolates them into this script before passing it as userData.

if [[ -n "${GITHUB_RUNNER_URL:-}" && -n "${GITHUB_RUNNER_TOKEN:-}" ]]; then
  sudo -u "$RUNNER_USER" bash -c "
    cd ${RUNNER_HOME}
    ./config.sh \
      --url '${GITHUB_RUNNER_URL}' \
      --token '${GITHUB_RUNNER_TOKEN}' \
      --name '${GITHUB_RUNNER_NAME:-$(hostname)}' \
      --labels 'self-hosted,linux,x64,smoke-tester' \
      --runnergroup 'monorepo' \
      --unattended \
      --replace
  "

  cd "$RUNNER_HOME"
  ./svc.sh install "$RUNNER_USER"
  ./svc.sh start &
fi

echo ">>> Bootstrap complete"
