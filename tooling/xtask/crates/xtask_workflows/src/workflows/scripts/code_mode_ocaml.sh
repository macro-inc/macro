set -euo pipefail

# The bundle's store path is baked into code_mode_assets at build time, so set
# it before the first cargo build of the job.
bundle="$(nix build --no-link --print-out-paths --print-build-logs .#code-mode-ocaml)"
echo "CODE_MODE_OCAML_DIR=$bundle" >> "$GITHUB_ENV"
