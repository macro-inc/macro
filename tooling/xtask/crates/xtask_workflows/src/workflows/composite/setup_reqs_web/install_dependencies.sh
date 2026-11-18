set -euo pipefail
key=$( { bun --version; cat bun.lock apps/web/patches/*; } | sha256sum | cut -d" " -f1)
marker=node_modules/.macro-install-key
if [ -d node_modules ] && [ "$(cat "$marker" 2>/dev/null)" != "$key" ]; then
  find node_modules -mindepth 1 -maxdepth 1 -exec rm -rf {} +
fi
rm -f "$marker"
bun install --frozen-lockfile
echo "$key" > "$marker"
