#!/bin/sh
# Local development only: keep encrypted storage and its local seal together.
set -eu
umask 077
ulimit -c 0

state=/openbao/file
if [ "$(id -u)" = 0 ]; then
    mkdir -p "$state"
    chown openbao:openbao "$state"
    chmod 700 "$state"
    exec su-exec openbao /bin/sh "$0"
fi

if [ ! -s "$state/seal.key" ]; then
    if [ -d "$state/data" ]; then
        echo 'Local OpenBao seal key is missing; refusing to replace it for existing storage.' >&2
        exit 1
    fi
    head -c 32 /dev/urandom > "$state/seal.key.tmp"
    mv "$state/seal.key.tmp" "$state/seal.key"
fi

mkdir -p "$state/data"

bao server -config=/openbao/config/macro-local.hcl &
server_pid=$!
trap 'kill -TERM "$server_pid" 2>/dev/null || true; wait "$server_pid" || true' EXIT
trap 'exit 0' INT TERM

# The listener must be ready before init; initialization output never reaches logs.
attempt=0
while :; do
    status=0
    bao operator init -status >/dev/null 2>&1 || status=$?
    case "$status" in
        0)
            if [ ! -e "$state/bootstrap.json" ] && [ -s "$state/bootstrap.json.tmp" ]; then
                mv "$state/bootstrap.json.tmp" "$state/bootstrap.json"
            fi
            break
            ;;
        2)
            # Raft may report uninitialized briefly while loading existing data.
            if [ ! -e "$state/bootstrap.json" ] && [ ! -e "$state/bootstrap.json.tmp" ]; then
                bao operator init -recovery-shares=1 -recovery-threshold=1 -format=json > "$state/bootstrap.json.tmp"
                mv "$state/bootstrap.json.tmp" "$state/bootstrap.json"
                echo 'Initialized local OpenBao; bootstrap credentials remain in /openbao/file/bootstrap.json.'
                break
            fi
            ;;
    esac
    if ! kill -0 "$server_pid" 2>/dev/null || [ "$attempt" -ge 60 ]; then
        echo 'Local OpenBao did not become ready for initialization.' >&2
        exit 1
    fi
    attempt=$((attempt + 1))
    sleep 1
done

wait "$server_pid"
