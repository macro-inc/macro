set -euo pipefail

# RELEASE_SECRETS is generated from every secret the desktop jobs read, so a
# change that starts reading a new secret fails here until it is configured.
missing=()
for name in $RELEASE_SECRETS; do
  if [ -z "${!name:-}" ]; then
    missing+=("$name")
  fi
done

if [ "${#missing[@]}" -ne 0 ]; then
  for name in "${missing[@]}"; do
    echo "::error::Repository secret $name is not configured. Desktop releases read it, so add it before merging the change that needs it."
  done
  exit 1
fi
echo "Desktop release secrets are configured: $RELEASE_SECRETS"
