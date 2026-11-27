set -euo pipefail
[[ $ENVIRONMENT == dev && $GITHUB_REF == refs/heads/main ]] || {
  echo 'Runtime rollout only accepts a dispatch from main to dev' >&2
  exit 1
}
[[ $SOURCE_SHA =~ ^[0-9a-f]{40}$ ]] || {
  echo 'Supply one full main commit SHA' >&2
  exit 1
}
[[ $COMPUTER =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || {
  echo 'Supply a single computer id' >&2
  exit 1
}
git cat-file -e "$SOURCE_SHA^{commit}"
git merge-base --is-ancestor "$SOURCE_SHA" "$GITHUB_SHA"
