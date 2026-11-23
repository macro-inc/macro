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
    # init -status returns 2 for both uninitialized and unreachable servers.
    # status returns 1 on a transport error, so do not initialize before a
    # listener response (0 when unsealed, 2 when sealed).
    listener_status=0
    bao status >/dev/null 2>&1 || listener_status=$?
    if [ "$listener_status" = 0 ] || [ "$listener_status" = 2 ]; then
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
                # An empty file holds no credentials: an earlier init failed before
                # writing any, so retry it.
                if [ -e "$state/bootstrap.json.tmp" ] && [ ! -s "$state/bootstrap.json.tmp" ]; then
                    rm -f "$state/bootstrap.json.tmp"
                fi
                # Raft may report uninitialized briefly while loading existing data.
                if [ ! -e "$state/bootstrap.json" ] && [ ! -e "$state/bootstrap.json.tmp" ]; then
                    init_status=0
                    bao operator init -recovery-shares=1 -recovery-threshold=1 -format=json > "$state/bootstrap.json.tmp" || init_status=$?
                    if [ "$init_status" != 0 ] || [ ! -s "$state/bootstrap.json.tmp" ]; then
                        # Partial output may hold the only copy of the credentials.
                        if [ ! -s "$state/bootstrap.json.tmp" ]; then
                            rm -f "$state/bootstrap.json.tmp"
                        fi
                        echo 'Local OpenBao initialization failed.' >&2
                        exit 1
                    fi
                    mv "$state/bootstrap.json.tmp" "$state/bootstrap.json"
                    echo 'Initialized local OpenBao; bootstrap credentials remain in /openbao/file/bootstrap.json.'
                    break
                fi
                ;;
        esac
    fi
    if ! kill -0 "$server_pid" 2>/dev/null || [ "$attempt" -ge 60 ]; then
        echo 'Local OpenBao did not become ready for initialization.' >&2
        exit 1
    fi
    attempt=$((attempt + 1))
    sleep 1
done

wait "$server_pid"
