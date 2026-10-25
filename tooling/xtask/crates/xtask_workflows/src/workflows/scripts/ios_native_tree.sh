# --- native tree ------------------------------------------------------------
# Hash identifying "the iOS native code" at a commit: every tracked blob under
# apps/web/tauri except the paths that never reach the iOS binary, recognised
# by the same naming convention the Android gate uses (android-native.mjs,
# which excludes iOS/macOS/linux/windows/apple/desktop-named paths): a path
# component that is `android`, `macos`, `linux`, `windows` or `desktop`,
# starts with that name plus `_`, `.` or `-`, or an extension-style
# `.android.` / `.macos.` / `.linux.` / `.windows.` infix (the android_*
# plugins, tauri.android.conf.json and tauri.macos.conf.json, desktop_update
# and the desktop_* modules, linux_notification, the macos icons; the Rust
# ones are all behind cfg(target_os) / cfg(desktop)) — plus the desktop
# updater manifest, editor config and Markdown docs. `apple`/`ios` paths
# stay included: gen/apple is the Xcode project. Plus one thing outside that tree: the
# version of the client cache wasm package
# (crates/client/cache-wasm/Cargo.toml). The app compiles the cache crates
# natively, and the team bumps that version when a cache change must ship, so
# the bump — not every edit under crates/client — is the native signal. The
# release stamps uploaded builds with the hash, the merge gate compares the
# live build's stamp against the merge result's, and the drift / head guards
# compare commits with it. Must match nativeTreeHash() in
# apps/web/scripts/ios-app-store.mjs and the iOS Native Check's change
# detection (web_app_check_main/ios_native_check.rs).
NATIVE_TREE_PATH=apps/web/tauri
CACHE_WASM_MANIFEST=crates/client/cache-wasm/Cargo.toml
export NATIVE_TREE_EXCLUDE='(^|/)(android|macos|linux|windows|desktop)([_./-]|$)|\.(android|macos|linux|windows)\.|\.md$|^desktop-release\.json$|^\.helix/'

# native_tree_hash <commit>: prints the hash, fails if the path is missing.
# (--full-tree: ls-tree otherwise narrows its output to the current directory,
# which would silently hash nothing when run from apps/web.)
native_tree_hash() {
  git rev-parse -q --verify "$1:${NATIVE_TREE_PATH}" >/dev/null || return 1
  {
    git ls-tree -r --full-tree "$1:${NATIVE_TREE_PATH}" \
      | awk -F'\t' '$2 !~ ENVIRON["NATIVE_TREE_EXCLUDE"]'
    echo "cache-wasm-version $(cache_wasm_version "$1")"
  } | git hash-object --stdin
}

# cache_wasm_version <commit>: the `version` of the client cache wasm package
# at that commit ("none" before the package existed).
cache_wasm_version() {
  git show "$1:${CACHE_WASM_MANIFEST}" 2>/dev/null \
    | sed -n 's/^version *= *"\([^"]*\)".*/\1/p' | head -1 | grep . || echo none
}

# native_tree_fetch <sha>: make a commit that is not in this checkout (a new
# PR head, GitHub's test merge commit, the pre-push head) available to
# native_tree_hash. Some callers persist actions/checkout credentials; clear
# inherited headers before adding ours so Git sends Authorization exactly once.
# Fails if the commit is unreachable (a force-pushed-away head).
native_tree_fetch() {
  local auth
  auth=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')
  git -c "http.https://github.com/.extraheader=" \
    -c "http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}" \
    fetch -q --depth=1 origin "$1"
}
# ----------------------------------------------------------------------------
