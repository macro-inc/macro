#!/usr/bin/env bash
# Set up a throwaway Firecracker host agent for the crash harness on a host
# that has Firecracker, the jailer, nftables and a ZFS pool with block
# cloning: its own dataset, TLS, config and systemd unit, then build the
# golden it restores. Usage (as a sudoer, from the repo):
#   FIRECRACKER=/path/firecracker JAILER=/path/jailer \
#   IMAGE_SOURCE=/nix/store/...-macro-box-firecracker \
#   AGENT_BUILD=target/release/firecracker-host setup.sh
# Re-runnable.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/env.sh"
: "${FIRECRACKER:?path to firecracker}" "${JAILER:?path to jailer}"
: "${IMAGE_SOURCE:?directory with vmlinux, rootfs.ext4, boot_args}"
: "${AGENT_BUILD:?firecracker-host built with --features crash-points}"

sudo install -d -m 0755 "$ROOT" "$ROOT/bin" "$ROOT/tls" "$(dirname "$IMAGES_DIR/$IMAGE")"
sudo install -m 0555 "$AGENT_BUILD" "$AGENT"
sudo install -m 0555 "$FIRECRACKER" "$ROOT/bin/firecracker"
sudo install -m 0555 "$JAILER" "$ROOT/bin/jailer"
sudo ln -sfn "$IMAGE_SOURCE" "$IMAGES_DIR/$IMAGE"

if ! sudo zfs list -H "$DATASET" >/dev/null 2>&1; then
  sudo zfs create -p -o mountpoint="$ROOT/zfs" "$DATASET"
fi

if [ ! -f "$ROOT/tls/server.crt" ]; then
  for name in server client; do
    sudo openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 30 \
      -subj "/CN=$PREFIX-$name" -addext "subjectAltName=IP:127.0.0.1" \
      -keyout "$ROOT/tls/$name.key" -out "$ROOT/tls/$name.crt" 2>/dev/null
  done
  sudo chmod 0644 "$ROOT/tls/server.crt" "$ROOT/tls/client.crt" "$ROOT/tls/client.key"
fi

sudo tee "$ROOT/config.toml" >/dev/null <<TOML
# Crash harness agent ($PREFIX): throwaway, 127.0.0.1 only.
host_name = "$PREFIX"
listen = "127.0.0.1:$PORT"

[tls]
certificate = "$ROOT/tls/server.crt"
key = "$ROOT/tls/server.key"
client_certificates = ["$ROOT/tls/client.crt"]

[binaries]
firecracker = "$ROOT/bin/firecracker"
jailer = "$ROOT/bin/jailer"
firecracker_version = "$("$ROOT/bin/firecracker" --version | head -1 | awk '{print $2}')"

[storage]
images_dir = "$IMAGES_DIR"
golden_root_disk_gib = $ROOT_DISK_GIB

[storage.disks]
kind = "zfs"
dataset = "$DATASET"

[network]
slots = $SLOTS
prefix = "$PREFIX"
veth_base = "$VETH_BASE"
dns = ["1.1.1.1"]
uplink = "$UPLINK"
api_sources = []

[jail]
uid_base = $UID_BASE
memory_overhead_mib = 256

[guest]
shutdown_grace = 30
golden_boot_timeout = 600
guest_agent_timeout = 30
concurrent_launches = 2
TOML

sudo tee "$ROOT/endpoint.toml" >/dev/null <<TOML
url = "https://127.0.0.1:$PORT"
client_certificate = "$ROOT/tls/client.crt"
client_key = "$ROOT/tls/client.key"
server_certificate = "$ROOT/tls/server.crt"
TOML
sudo chmod 0644 "$ROOT/endpoint.toml"

# As the NixOS module runs the agent: VMs live in the unit's cgroup and
# outlive the agent. Restart=no: the harness starts it, the crash point
# kills it.
sudo tee "/etc/systemd/system/$UNIT.service" >/dev/null <<UNIT
[Unit]
Description=Firecracker host agent for the crash harness ($PREFIX)
[Service]
EnvironmentFile=-$ROOT/crash.env
ExecStart=$AGENT serve --config $ROOT/config.toml \$CRASH_ARGS
Environment=ENVIRONMENT=local
Environment=RUST_LOG=info,firecracker_host=debug
Delegate=yes
DelegateSubgroup=agent
KillMode=process
Restart=no
UNIT
sudo systemctl daemon-reload

. "$here/lib.sh"
start_agent ""
client build-golden --image "$IMAGE" --vcpus "$VCPUS" --memory-mib "$MEMORY_MIB" >/dev/null
wait_golden_ready "$VCPUS" "$MEMORY_MIB"
echo "setup done: golden $IMAGE ${VCPUS}v-${MEMORY_MIB}m ready"
