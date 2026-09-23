#!/usr/bin/env bash
set -euo pipefail

action="${1:-dev}"
shift || true
case "$action" in
  dev|build) ;;
  *) echo "Usage: android.sh {dev|build} [--firebase-config /path/google-services.json] [Tauri arguments]" >&2; exit 1 ;;
esac

script_dir="$(\cd "$(dirname "$0")" && pwd)"
\cd "$script_dir/.."

firebase_config=""
if [[ "${1:-}" == "--firebase-config" ]]; then
  [[ -f "${2:-}" ]] || { echo "Firebase configuration file not found" >&2; exit 1; }
  firebase_config="$2"
  shift 2
fi

firebase_environment=prod
[[ "$action" != "dev" ]] || firebase_environment=dev
firebase_destination=tauri/src-tauri/gen/android/app/google-services.json
firebase_default="tauri/src-tauri/firebase/$firebase_environment/google-services.json"
if [[ -z "$firebase_config" && -f "$firebase_default" ]]; then
  firebase_config="$firebase_default"
elif [[ -z "$firebase_config" && -f "$firebase_destination" ]]; then
  firebase_config="$firebase_destination"
fi
if [[ -n "$firebase_config" ]]; then
  bun scripts/android-firebase.ts "$action" "$firebase_config" "$firebase_destination"
fi

if [[ "$(uname)" == "Darwin" ]]; then
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  if [[ -z "${JAVA_HOME:-}" && -d /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ]]; then
    export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
  fi
else
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
fi
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/30.0.16248370}"
[[ -d "$NDK_HOME/toolchains/llvm" ]] || { echo "Install NDK 30.0.16248370 or set NDK_HOME" >&2; exit 1; }
[[ -d "$ANDROID_HOME/platforms/android-36" ]] || { echo "Install Android SDK Platform 36" >&2; exit 1; }
export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}$ANDROID_HOME/platform-tools:$PATH"

\cd tauri/src-tauri
if [[ "$action" == "dev" ]]; then
  export PORT="${PORT:-3000}"
  exec cargo tauri android dev --config "{\"build\":{\"devUrl\":\"http://localhost:${PORT}\"}}" "$@" -- --no-default-features
else
  exec cargo tauri android build --target aarch64 "$@"
fi
