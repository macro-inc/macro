#!/usr/bin/env bash
set -euo pipefail
source_dir=$(cd "$(dirname "$0")" && pwd)
hook="$source_dir/runtime-hook.sh"
data=${1:?usage: test_runtime.sh <xkb-data> <schemas> <gio-modules> <AppRun> <libproxy> <ca-bundle>}
schemas=${2:?missing bundled schemas}
modules=${3:?missing GIO modules}
apprun=${4:?missing real AppRun executable}
libproxy=${5:?missing portable libproxy}
ca_bundle=${6:?missing test CA bundle}
xkb_smoke="$PWD/xkb-smoke"
settings_smoke="$PWD/settings-smoke"
tls_smoke="$PWD/tls-smoke"

# shellcheck disable=SC2046
cc -Wall -Wextra -Werror "$source_dir/test_xkb.c" $(pkg-config --cflags --libs xkbcommon) -o "$xkb_smoke"
# shellcheck disable=SC2046
cc -Wall -Wextra -Werror "$source_dir/test_settings.c" $(pkg-config --cflags --libs gio-2.0) -ldl -o "$settings_smoke"
# shellcheck disable=SC2046
cc -Wall -Wextra -Werror "$source_dir/test_tls.c" $(pkg-config --cflags --libs gio-2.0) -o "$tls_smoke"

# Prove that neither fixture silently falls back to the build host's data.
if env XKB_CONFIG_ROOT="$PWD/missing-xkb-data" "$xkb_smoke"; then
  echo "XKB smoke test unexpectedly used host keyboard data" >&2
  exit 1
fi
if env GSETTINGS_SCHEMA_DIR="$PWD/missing-schemas" "$settings_smoke"; then
  echo "GSettings smoke test unexpectedly used host schemas" >&2
  exit 1
fi

appdir="$PWD/Macro.AppDir"
mkdir -p "$appdir/usr/share/X11" "$appdir/usr/share/glib-2.0" "$appdir/usr/lib/gio" "$appdir/usr/bin" "$appdir/usr/libexec/macro"
cp "$source_dir/host-environment.sh" "$appdir/usr/libexec/macro/host-environment.sh"
cp -r "$data" "$appdir/usr/share/X11/xkb"
cp -r "$schemas" "$appdir/usr/share/glib-2.0/schemas"
cp -rL "$modules" "$appdir/usr/lib/gio/modules"
install -m0755 "$libproxy/lib/libproxy.so.1" "$appdir/usr/lib/libproxy.so.1"
install -m0755 "$libproxy/lib/libproxy/libpxbackend-1.0.so" "$appdir/usr/lib/libpxbackend-1.0.so"
# Nix's schema directory exists in this sandbox: reject baked-in lookups before
# running the fixtures so the host cannot mask a broken proxy module.
PYTHONPATH="$source_dir" python3 - "$appdir" <<'PY'
import sys
from relocate import check_schema_paths
check_schema_paths(sys.argv[1])
PY
# Use the same patched native launcher as the artifact, not a shell stand-in.
# The unpatched executable corrupts GSETTINGS_SCHEMA_DIR after the hook runs.
install -m0755 "$apprun" "$appdir/AppRun.wrapped"
# Only the test copy needs a Nix interpreter to run in the build sandbox.
interpreter=$(patchelf --print-interpreter "$xkb_smoke")
patchelf --set-interpreter "$interpreter" --set-rpath "$(dirname "$interpreter")" "$appdir/AppRun.wrapped"
printf '[Desktop Entry]\nType=Application\nName=Runtime test\nExec=app\n' > "$appdir/Runtime.desktop"
printf '#!%s\nexec "$@"\n' "$BASH" > "$appdir/usr/bin/app"
chmod +x "$appdir/usr/bin/app"
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\nsource %q\nexec "$APPDIR/AppRun.wrapped" "$@"\n' "$hook" > "$appdir/AppRun"

# No user settings or session bus should be needed by these headless checks.
export GSETTINGS_BACKEND=memory XDG_CURRENT_DESKTOP=GNOME
export XDG_DATA_DIRS="$PWD/missing-system-data"

run_smokes() {
  env "$@" bash "$appdir/AppRun" "$xkb_smoke"
  for resolver in gnome libproxy; do
    env "$@" GIO_USE_PROXY_RESOLVER="$resolver" bash "$appdir/AppRun" "$settings_smoke"
  done
  env "$@" SSL_CERT_FILE="$ca_bundle" bash "$appdir/AppRun" "$tls_smoke"
  env "$@" SSL_CERT_FILE="$PWD/nonexistent-ca.pem" bash "$appdir/AppRun" "$tls_smoke" reject
}

# Fedora 44 dropped the old /etc/pki/tls/certs/ca-bundle.crt symlink.
# Exercise discovery against an isolated root with only its current location.
(
  export APPDIR="$appdir"
  # shellcheck disable=SC1090
  source "$hook"
  trust_root="$PWD/fedora-trust-root"
  mkdir -p "$trust_root/etc/pki/ca-trust/extracted/pem"
  cp "$ca_bundle" "$trust_root/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem"
  test "$(macro_find_ca_bundle "$trust_root")" = "$trust_root/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem"
)

# Normal AppImage startup supplies APPDIR; no caller workaround is necessary.
run_smokes -u XKB_CONFIG_ROOT -u GSETTINGS_SCHEMA_DIR APPDIR="$appdir"

# Relocating the bundle (including spaces) must override stale inherited paths.
mv "$appdir" "$PWD/Relocated Macro.AppDir"
appdir="$PWD/Relocated Macro.AppDir"
run_smokes XKB_CONFIG_ROOT="$PWD/missing-xkb-data" GSETTINGS_SCHEMA_DIR="$PWD/missing-schemas" APPDIR="$appdir"
# linuxdeploy's standalone AppRun also works without the runtime environment.
run_smokes -u APPDIR -u XKB_CONFIG_ROOT -u GSETTINGS_SCHEMA_DIR
