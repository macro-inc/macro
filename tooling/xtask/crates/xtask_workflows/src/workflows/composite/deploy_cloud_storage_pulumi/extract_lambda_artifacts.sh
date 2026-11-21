set -euo pipefail
# Prefer an on-disk tar (sticky-disk handoff); fall back to the downloaded artifact.
src="${TAR_PATH:-lambda-artifact/lambda-artifacts.tar.gz}"
if [[ ! -f "$src" ]]; then
  echo "::error::lambda artifacts tar missing at $src — the handoff download/extract chain broke upstream; check this job's download step and the build job's upload receipt."
  echo "--- $(dirname "$src") contents ---"; ls -la "$(dirname "$src")" || true
  exit 1
fi
echo "handoff receipt: $(sha256sum "$src" | cut -d' ' -f1) ($(stat -c%s "$src") bytes)"
tar -xzf "$src" -C .
