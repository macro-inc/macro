#!/usr/bin/env bash
# Runs a command in a network namespace of its own, where localhost:<port> for
# each port in <ports> (comma-separated) reaches the same port on this machine:
#
#   tooling/difftest/soup-list/netns.sh 23209,23250,23251 bun run run.ts ...
#
# Chromium fails every request in flight with net::ERR_NETWORK_CHANGED when a
# network interface or address appears or goes. On a machine where other
# containers start and stop, that is about every second (docker's veth pairs),
# and a dev-server page, which loads a few thousand modules, comes up blank or
# fails a dynamic import. The namespace has only its loopback and pasta's one
# interface, so the browser sees none of that churn. Docker's socket still works
# inside it.
#
# It is IPv4 only: pasta forwards a namespace port to the host port of the same
# family, and Chromium does not fall back to the other family after a reset. So
# vite.sh binds 127.0.0.1; in here ::1 refuses and every client falls back.
set -euo pipefail
ports=$1
shift
if command -v pasta >/dev/null; then
  pasta=pasta
else
  pasta=$(nix build --no-link --print-out-paths nixpkgs#passt)/bin/pasta
fi
exec "$pasta" --config-net -4 -t none -u none -U none -T "$ports" -- "$@"
