#!/usr/bin/env bash
# Sourced by linuxdeploy's AppRun before it launches the application.
export APPDIR="${APPDIR:-"$(dirname "$(realpath "$0")")"}"
# This hook sorts before other hooks, so external helpers can restore the
# caller's environment rather than exporting AppImage libraries to host apps.
# shellcheck disable=SC1091
source "$APPDIR/usr/libexec/macro/host-environment.sh"
macro_capture_host_environment
export WEBKIT_INJECTED_BUNDLE_PATH="$APPDIR/usr/lib"
# Nix's libxkbcommon embeds a store path that does not exist on other distros.
export XKB_CONFIG_ROOT="$APPDIR/usr/share/X11/xkb"
# The patched AppRun leaves this single-directory value intact (no ':' suffix).
export GSETTINGS_SCHEMA_DIR="$APPDIR/usr/share/glib-2.0/schemas"
# Use the host's managed TLS trust, not a build-time Nix path. Preserve explicit
# overrides (including invalid ones): the TLS backend must fail closed on those.
macro_find_ca_bundle() {
  local root="${1:-}" candidate
  for candidate in \
    etc/ssl/certs/ca-certificates.crt \
    etc/pki/tls/certs/ca-bundle.crt \
    etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem \
    etc/ssl/ca-bundle.pem \
    etc/ssl/cert.pem; do
    if [ -r "$root/$candidate" ] && [ -s "$root/$candidate" ]; then
      printf '%s\n' "$root/$candidate"
      return 0
    fi
  done
  return 1
}
if [ -z "${SSL_CERT_FILE:-}" ]; then
  if ca_file=$(macro_find_ca_bundle); then
    export SSL_CERT_FILE="$ca_file"
  fi
fi
gio_modules="$APPDIR/usr/lib/gio/modules"
if [ -d "$gio_modules" ]; then
  case ":${GIO_EXTRA_MODULES:-}:" in
    *:"$gio_modules":*) ;;
    *) export GIO_EXTRA_MODULES="$gio_modules${GIO_EXTRA_MODULES:+:$GIO_EXTRA_MODULES}" ;;
  esac
fi
