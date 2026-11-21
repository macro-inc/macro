set -euo pipefail
case "$DEV_SHELL" in
  ''|*[!A-Za-z0-9_-]*)
    echo "invalid devShell attribute: ${DEV_SHELL@Q}" >&2
    exit 1
    ;;
esac
dev_env="$RUNNER_TEMP/nix-dev-env"
nix print-dev-env --accept-flake-config ".#$DEV_SHELL" > "$dev_env"
echo "BASH_ENV=$dev_env" >> "$GITHUB_ENV"
source "$dev_env"
printf '%s\n' "$PATH" | tr ':' '\n' >> "$GITHUB_PATH"
if [ "${NIX_SEED_SAVE:-}" = true ]; then
  echo "NIX_SEED_SAVE=false" >> "$GITHUB_ENV"
  .github/actions/setup-nix/nix_seed.sh save || echo "::warning::Could not save the Nix seed"
fi
