#!/usr/bin/env bash
# Builds the Android benchmark APK: the production frontend and release native
# code against production services, with OTA updates off and every perf span
# exported to a same-origin path the harness answers over DevTools.
#
# Usage: build.sh [--target x86_64|aarch64] [--signing /path/keystore.properties]
set -euo pipefail

target=x86_64
signing=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) target="$2"; shift 2 ;;
    --signing) signing="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

script_dir="$(\cd "$(dirname "$0")" && pwd)"
web="$(\cd "$script_dir/../.." && pwd)"
android="$web/tauri/src-tauri/gen/android"
\cd "$web"

if [[ -z "${VITE_POSTHOG_API_KEY:-}" ]]; then
  # Without the key every feature flag reads false and the app differs from
  # what users run. The key is public: production's bundle embeds it.
  VITE_POSTHOG_API_KEY="$(bun "$script_dir/posthog-key.ts")"
  export VITE_POSTHOG_API_KEY
fi
# Perf sampling keeps 5% of users when the environment is `prod`; any other
# name keeps every perf trace. Spans go to the WebView's own origin, never to
# Datadog: the harness answers them, and nothing else does.
export VITE_OTEL_ENV=benchmark
export VITE_ENABLE_BROWSER_OTEL=true
export VITE_OTEL_EXPORTER_URL=/__benchmark/otlp/v1/traces

# Sign with the test key named here and nothing else: an existing
# configuration may be the Play upload key.
[[ -n "$signing" && -f "$signing" ]] || {
  echo "Pass --signing with a local test keystore.properties (never the Play upload key)" >&2
  exit 1
}
if [[ -e "$android/keystore.properties" || -L "$android/keystore.properties" ]]; then
  if [[ "$(readlink -f "$android/keystore.properties")" != "$(readlink -f "$signing")" ]]; then
    echo "$android/keystore.properties is another signing configuration; move it aside first" >&2
    exit 1
  fi
else
  ln -s "$signing" "$android/keystore.properties"
fi
if [[ ! -e "$android/app/google-services.json" ]]; then
  bun scripts/android-firebase.ts build --doppler "$android/app/google-services.json"
fi

just build-tauri

export CARGO_INCREMENTAL=0
# aws-lc-sys must not use its CMake builder for Android targets.
export "AWS_LC_SYS_CMAKE_BUILDER_${target}_linux_android=0"
\cd tauri/src-tauri
# `--no-default-features` turns OTA updates off, so the bundle under test is
# the one built here.
cargo tauri android build --target "$target" --apk --ci \
  --config '{"build":{"beforeBuildCommand":"","frontendDist":"../../dist"}}' \
  -- --no-default-features
find "$android/app/build/outputs/apk" -name '*-release.apk'
