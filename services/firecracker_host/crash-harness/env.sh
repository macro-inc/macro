# shellcheck shell=bash
# Settings shared by the crash harness scripts; override any of them in
# the environment. Every name the harness makes starts with $PREFIX.
: "${PREFIX:=crash}"
: "${ROOT:=/srv/$PREFIX}"                   # config, TLS, binaries, logs
: "${DATASET:=fc/$PREFIX}"                  # ZFS dataset (pool must clone blocks)
: "${PORT:=8471}"                           # API port, on 127.0.0.1 only
: "${SLOTS:=4}"
: "${UID_BASE:=1200000000}"                 # must not overlap another agent's
: "${VETH_BASE:=10.208.0.0}"                # /16, must not overlap another agent's
: "${UPLINK:=ens5}"
: "${IMAGE:=macro-box/2026-11-17k}"         # installed under $IMAGES_DIR
: "${IMAGES_DIR:=$ROOT/images}"
: "${VCPUS:=2}"
: "${MEMORY_MIB:=2048}"
: "${ROOT_DISK_GIB:=32}"                    # at least golden_root_disk_gib
: "${UNIT:=$PREFIX-firecracker-host}"
: "${AGENT:=$ROOT/bin/firecracker-host}"    # built with --features crash-points

client() {
  "$AGENT" client --endpoint "$ROOT/endpoint.toml" "$@"
}
