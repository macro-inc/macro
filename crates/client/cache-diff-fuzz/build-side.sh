#!/usr/bin/env bash
# Builds the fuzzer against one side of a comparison: BASE with BRANCH... merged in.
#
#   build-side.sh NAME BASE [BRANCH...]
#
# FEATURES=idle-checkpoint builds the side with the host's idle point (the side must
# have TursoStorage::checkpoint_if_due). TARGET=x builds in target-x instead of
# target-NAME, so sides that differ little share one. The binary lands in
# $CACHE_DIFF_FUZZ_HOME/bin/NAME, and $CACHE_DIFF_FUZZ_HOME/bin/NAME.side records the commits it was built from.
set -euo pipefail

name=$1
base=$2
shift 2
repo=$(git rev-parse --show-toplevel)
# FUZZER_SRC builds from a snapshot of the fuzzer, so the working copy can change meanwhile.
crate=${FUZZER_SRC:-$repo/crates/client/cache-diff-fuzz}
home=${CACHE_DIFF_FUZZ_HOME:-$HOME/.cache/cache-diff-fuzz}
tree=$home/sides/$name
mkdir -p "$home/bin" "$home/sides"

if [ -d "$tree" ]; then
  git -C "$repo" worktree remove --force "$tree"
fi
git -C "$repo" worktree add --quiet --detach "$tree" "$base"
for branch in "$@"; do
  git -C "$tree" merge --quiet --no-edit "$branch"
done

# A deliberate regression, to show a comparison catches it: MUTATE_FILE (relative to the
# repository) gets the perl substitution MUTATE_PERL, which must change it.
if [ -n "${MUTATE_FILE:-}" ]; then
  before=$(sha256sum "$tree/$MUTATE_FILE")
  perl -0pi -e "$MUTATE_PERL" "$tree/$MUTATE_FILE"
  if [ "$(sha256sum "$tree/$MUTATE_FILE")" = "$before" ]; then
    echo "MUTATE_PERL did not change $MUTATE_FILE" >&2
    exit 1
  fi
fi

# The fuzzer itself is the same on every side: this checkout's copy.
rm -rf "$tree/crates/client/cache-diff-fuzz"
cp -r "$crate" "$tree/crates/client/cache-diff-fuzz"
if ! grep -q '"crates/client/cache-diff-fuzz"' "$tree/Cargo.toml"; then
  sed -i 's|^  "crates/client/cache-core",$|  "crates/client/cache-core",\n  "crates/client/cache-diff-fuzz",|' "$tree/Cargo.toml"
fi

(
  cd "$tree"
  CARGO_TARGET_DIR=$home/target-${TARGET:-$name} cargo build --quiet --release -p cache-diff-fuzz \
    ${FEATURES:+--features "$FEATURES"}
)
cp "$home/target-${TARGET:-$name}/release/cache-diff-fuzz" "$home/bin/$name"
{
  echo "base $(git -C "$repo" rev-parse "$base")"
  for branch in "$@"; do
    echo "branch $branch $(git -C "$repo" rev-parse "$branch")"
  done
  echo "tree $(git -C "$tree" rev-parse HEAD)"
  echo "features ${FEATURES:-}"
  [ -n "${MUTATE_FILE:-}" ] && echo "mutate $MUTATE_FILE $MUTATE_PERL"
  echo "fuzzer $(git -C "$repo" rev-parse HEAD) $(cd "$crate" && find . -type f -not -path './target/*' | sort | xargs cat | sha256sum | cut -c1-16)"
} > "$home/bin/$name.side"
cat "$home/bin/$name.side"
