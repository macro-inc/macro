set -euo pipefail

# Builds the per-user NSIS installer with the runner's MSVC toolchain, from
# the frontend and release identity the Linux job handed over (windows-input/)
# and the macrod the previous step built. tauri.windows.conf.json holds the
# Windows settings; windows-input/tauri.release.json the release identity
# (version, updater feed and key), as Nix supplies them on macOS and Linux.

target=x86_64-pc-windows-msvc
app=apps/web/tauri/src-tauri
export SQLX_OFFLINE=true

rm -rf apps/web/dist
cp -R windows-input/dist apps/web/dist
cp windows-input/desktop-release.json apps/web/tauri/desktop-release.json
printf production > "$app/.macro-tauri-env"
# Tauri's sidecar naming: the bundler strips the triple when installing it.
mkdir -p "$app/binaries"
cp "target/$target/release/macrod.exe" "$app/binaries/macrod-$target.exe"

# The same tauri-cli release nixpkgs bundles the AppImage with.
cargo install tauri-cli --version "=$TAURI_CLI_VERSION" --locked --root "$RUNNER_TEMP/tauri-cli"
# RUNNER_TEMP is a Windows path (D:\a\_temp), whose drive colon would split
# a bash PATH entry; cargo then finds no `tauri` subcommand.
PATH="$(cygpath -u "$RUNNER_TEMP")/tauri-cli/bin:$PATH"
export PATH

release_config=$(cygpath -w "$PWD/windows-input/tauri.release.json")
(
  cd "$app"
  cargo tauri build --verbose --bundles nsis \
    --config "$release_config" \
    --config "$TAURI_SIGNING_CONFIG"
)

version=$(cat windows-input/version)
shopt -s nullglob
installers=(apps/web/tauri/target/release/bundle/nsis/*-setup.exe)
if [ "${#installers[@]}" -ne 1 ]; then
  echo "Expected one NSIS installer, found ${#installers[@]}" >&2
  find apps/web/tauri/target/release/bundle -maxdepth 2 >&2 || true
  exit 1
fi
rm -rf artifacts
mkdir -p artifacts
cp "${installers[0]}" "artifacts/Macro-$version-x86_64-windows-setup.exe"
cp windows-input/desktop-release.json artifacts/windows-x86_64.release.json
(cd artifacts && sha256sum -- *.exe > macro-windows-SHA256SUMS)
echo "INSTALLER=$(cygpath -w "$PWD/artifacts/Macro-$version-x86_64-windows-setup.exe")" >> "$GITHUB_ENV"
