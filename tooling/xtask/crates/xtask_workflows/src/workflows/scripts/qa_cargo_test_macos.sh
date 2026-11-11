set -uo pipefail

# The Rust unit tests of src-tauri on macOS. Best effort: the result is
# recorded either way and the QA harness reports it as the `cargo-test` check.
mkdir -p "$QA_OUT"
# tauri::generate_context! needs the frontend directory to exist; the unit
# tests do not use its contents.
mkdir -p apps/web/dist
[ -e apps/web/dist/index.html ] || echo '<!doctype html>' > apps/web/dist/index.html

nix develop --command cargo test \
  --manifest-path apps/web/tauri/Cargo.toml -p app --lib --locked \
  > "$QA_OUT/cargo-test.log" 2>&1
status=$?
echo "$status" > "$QA_OUT/cargo-test.status"
tail -n 30 "$QA_OUT/cargo-test.log"
exit 0
