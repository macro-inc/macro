# No -e: a failing cargo test is a result to record, not a reason to stop the step.
set +e
set -u

# The Rust unit tests of src-tauri on macOS. Best effort: the result is
# recorded either way and the QA harness reports it as the `cargo-test` check.
mkdir -p "$QA_OUT"
# tauri::generate_context! needs the frontend directory to exist; the unit
# tests do not use its contents.
mkdir -p apps/web/dist
[ -e apps/web/dist/index.html ] || echo '<!doctype html>' > apps/web/dist/index.html
# A production build.rs insists on the embedded bundle manifest; a development
# one falls back to bundle build 0 (the native E2E build does the same).
echo development > apps/web/tauri/src-tauri/.macro-tauri-env

# Nix's cctools ld crashes (SIGTRAP) linking the app's tests, and putting
# /usr/bin first does not help: the dev shell's DEVELOPER_DIR still sends clang
# to it. Link with the DMG build's Apple linker shim, which runs Xcode's ld.
if ! linker=$(nix build --no-link --print-out-paths ".#tauri-desktop-apple-linker" 2> "$QA_OUT/cargo-test.log"); then
  echo "could not build the Apple linker shim; see cargo-test.log" >&2
  # A ref from before the shim was exported: the harness reports a skip.
  if grep -q "does not provide attribute" "$QA_OUT/cargo-test.log"; then
    echo no-linker > "$QA_OUT/cargo-test.status"
  else
    echo 1 > "$QA_OUT/cargo-test.status"
  fi
  tail -n 30 "$QA_OUT/cargo-test.log"
  exit 0
fi
CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER="$linker" nix develop --command cargo test \
  --manifest-path apps/web/tauri/Cargo.toml -p app --lib --locked \
  > "$QA_OUT/cargo-test.log" 2>&1
status=$?
echo "$status" > "$QA_OUT/cargo-test.status"
tail -n 30 "$QA_OUT/cargo-test.log"
exit 0
