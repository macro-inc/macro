#!/usr/bin/env bash
# Source this helper before frontend preparation, then activate only for native work.

ios_resolve_toolchain() {
  # Nix's DEVELOPER_DIR can point at its macOS-only SDK. Honor an explicit
  # Xcode selection, otherwise use the system selection without Nix's override.
  ios_developer_dir="${DEVELOPER_DIR:-}"
  case "$ios_developer_dir" in
    ""|/nix/store/*)
      ios_developer_dir="$(/usr/bin/env -u DEVELOPER_DIR /usr/bin/xcode-select -p)"
      ;;
  esac
  if [[ ! -d "$ios_developer_dir/Platforms/iPhoneOS.platform" ]]; then
    echo "iOS builds require full Xcode; select it with xcode-select or DEVELOPER_DIR." >&2
    exit 1
  fi
  ios_cc="$(DEVELOPER_DIR="$ios_developer_dir" /usr/bin/xcrun --sdk iphoneos --find clang)"
  ios_cxx="$(DEVELOPER_DIR="$ios_developer_dir" /usr/bin/xcrun --sdk iphoneos --find clang++)"

  # Keep the selected Rust toolchain, including Nix's pinned Fenix toolchain.
  # Its iOS standard libraries are declared in the root rust-toolchain.toml;
  # Nix's rustup shim cannot install it into an already-running dev shell.
  ios_cargo="$(command -v cargo)"
  ios_rustc="$(command -v "${RUSTC:-${CARGO_BUILD_RUSTC:-rustc}}")"
  ios_rust_target="${1:?Rust target is required}"
  ios_rust_libdir="$("$ios_rustc" --print target-libdir --target "$ios_rust_target")"
  if ! compgen -G "$ios_rust_libdir/libstd-*.rlib" > /dev/null; then
    echo "The active Rust toolchain is missing $ios_rust_target: $ios_rust_libdir" >&2
    echo "Re-enter nix develop to load the updated rust-toolchain.toml, or install the target with rustup if building outside Nix." >&2
    exit 1
  fi
}

ios_activate_toolchain() {
  export DEVELOPER_DIR="$ios_developer_dir"
  export CC="$ios_cc" CXX="$ios_cxx"
  export CC_aarch64_apple_ios="$ios_cc" CXX_aarch64_apple_ios="$ios_cxx"
  export CC_aarch64_apple_ios_sim="$ios_cc" CXX_aarch64_apple_ios_sim="$ios_cxx"
  # Tauri forwards PATH to the Xcode build via its options server, but not CC/CXX.
  # cargo-mobile also sets CC=clang, so absolute compiler variables alone do not
  # protect builds launched with --open. Include Apple's linker and Xcode tools.
  export PATH="$(dirname "$ios_cc"):$DEVELOPER_DIR/usr/bin:$(dirname "$ios_cargo"):/usr/bin:$PATH"
  # CARGO_BUILD_* is forwarded through Tauri's options server to Xcode. Keep
  # explicit compiler overrides consistent with the selected Cargo toolchain.
  export RUSTC="$ios_rustc" CARGO_BUILD_RUSTC="$ios_rustc"
  unset SDKROOT MACOSX_DEPLOYMENT_TARGET NIX_CFLAGS_COMPILE NIX_LDFLAGS
  # Tauri locates its options server via a file in TMPDIR before it can restore
  # the CLI environment. Xcode can retain a previous nix develop shell's TMPDIR.
  # Use the same per-user directory as the Xcode build phase.
  export TMPDIR="$(/usr/bin/getconf DARWIN_USER_TEMP_DIR)"
}
