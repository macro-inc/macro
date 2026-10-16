#!/usr/bin/env bash
set -euo pipefail
helpers=${1:?usage: test_xdg.sh <portable-xdg-utils>}

# Help/version alone would miss the awk/sed/data paths used by real operations.
if grep -n /nix/store/ "$helpers/bin/xdg-open" "$helpers/bin/xdg-mime" "$helpers"/libexec/macro/*; then
  echo 'Desktop helpers still depend on the Nix store' >&2
  exit 1
fi

export HOME="$PWD/xdg-home" XDG_CONFIG_HOME="$PWD/xdg-config"
export XDG_DATA_HOME="$PWD/xdg-data" XDG_DATA_DIRS="$PWD/xdg-system-data"
unset DISPLAY WAYLAND_DISPLAY DESKTOP_SESSION KDE_FULL_SESSION GNOME_DESKTOP_SESSION_ID
export XDG_CURRENT_DESKTOP=X-Generic
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME/applications" "$XDG_DATA_DIRS" "$PWD/fake-bin"
printf '[Desktop Entry]\nType=Application\nName=AppImage test\nExec=true\nMimeType=x-scheme-handler/macro-appimage-test;\n' \
  > "$XDG_DATA_HOME/applications/macro-appimage-test.desktop"

export PATH="$helpers/bin:$PATH"
bash "$helpers/bin/xdg-mime" --version
bash "$helpers/bin/xdg-open" --help >/dev/null
bash "$helpers/bin/xdg-mime" default macro-appimage-test.desktop x-scheme-handler/macro-appimage-test
test "$(bash "$helpers/bin/xdg-mime" query default x-scheme-handler/macro-appimage-test)" = macro-appimage-test.desktop

# Test browser dispatch without a display, session bus, network, or real browser.
# The generated script expands its arguments and log path when it runs.
# shellcheck disable=SC2016
printf '#!%s\n' "$BASH" > "$PWD/fake-bin/macro-test-browser"
# shellcheck disable=SC2016
printf '%s\n' '
set -eu
if [[ ${XDG_TEST_CHECK_ENV:-} == 1 ]]; then
  [[ $LD_LIBRARY_PATH == "$XDG_TEST_ORIGINAL_LD" ]]
  [[ -v SSL_CERT_FILE && -z $SSL_CERT_FILE ]]
  [[ ! -v GSETTINGS_SCHEMA_DIR && ! -v GIO_EXTRA_MODULES ]]
  [[ ! -v MACRO_APPIMAGE_HOST_ENV_CAPTURED && ! -v APPDIR && ! -v APPIMAGE ]]
fi
printf "%s\n" "$@" > "$XDG_TEST_BROWSER_LOG"
' >> "$PWD/fake-bin/macro-test-browser"
chmod +x "$PWD/fake-bin/macro-test-browser"
export PATH="$PWD/fake-bin:$PATH" BROWSER=macro-test-browser XDG_TEST_BROWSER_LOG="$PWD/browser-args"
url='https://example.invalid/appimage-test?a=1&b=2'
bash "$helpers/bin/xdg-open" "$url"
test "$(< "$XDG_TEST_BROWSER_LOG")" = "$url"

# Simulate a real AppRun call. Preserve caller values (including empty and
# unset), then ensure the external browser sees none of the bundle overrides.
appdir="$PWD/External helper AppDir"
mkdir -p "$appdir/usr"
cp -r "$helpers/." "$appdir/usr/"
(
  # shellcheck disable=SC1091
  source "$helpers/libexec/macro/host-environment.sh"
  unset GSETTINGS_SCHEMA_DIR GIO_EXTRA_MODULES
  export SSL_CERT_FILE=''
  export LD_LIBRARY_PATH="$PWD/original library path"
  export XDG_TEST_ORIGINAL_LD="$LD_LIBRARY_PATH" XDG_TEST_CHECK_ENV=1
  macro_capture_host_environment
  export APPDIR="$appdir" APPIMAGE="$PWD/test.AppImage"
  export LD_LIBRARY_PATH="$appdir/usr/lib" GIO_EXTRA_MODULES="$appdir/usr/lib/gio/modules"
  export GSETTINGS_SCHEMA_DIR="$appdir/usr/share/glib-2.0/schemas" SSL_CERT_FILE="$appdir/bundle-ca.pem"
  macro_capture_host_environment # Must not replace the original snapshot.
  bash "$appdir/usr/bin/xdg-open" "$url"
)
test "$(< "$XDG_TEST_BROWSER_LOG")" = "$url"
echo 'Portable desktop helpers registered/queried MIME handlers and launched a browser with its original environment'
