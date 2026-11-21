#!/usr/bin/env bash
# Builds the fuzzer against one side of a comparison: BASE with BRANCH... merged in.
#
#   build-side.sh NAME BASE [BRANCH...]
#
# IDLE_CHECKPOINT=1 builds the side with the host's idle point (the side must
# have TursoStorage::checkpoint_if_due). TARGET=x builds in target-x instead of
# target-NAME, so sides that differ little share one; builds that share a target
# take turns. The binary lands in $CACHE_DIFF_FUZZ_HOME/bin/NAME, and
# $CACHE_DIFF_FUZZ_HOME/bin/NAME.side records the commits it was built from. A
# failed build leaves neither, and removes its worktree.
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: build-side.sh NAME BASE [BRANCH...]" >&2
  exit 2
fi
name=$1
base=$2
shift 2
# Letters, digits, - and _ only: no dot, so no name is another side's .side, .tmp or lock.
for plain in "$name" "${TARGET:-x}"; do
  [[ "$plain" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || { echo "NAME and TARGET may hold only letters, digits, - and _" >&2; exit 2; }
done
repo=$(git rev-parse --show-toplevel)
# FUZZER_SRC builds from a snapshot of the fuzzer, so the working copy can change meanwhile.
crate=${FUZZER_SRC:-$repo/crates/client/cache-diff-fuzz}
home=${CACHE_DIFF_FUZZ_HOME:-$HOME/.cache/cache-diff-fuzz}
tree=$home/sides/$name
target=$home/target-${TARGET:-$name}
mkdir -p "$home/bin" "$home/sides" "$home/locks"
# One build per side name at a time, and none while a run copies the side. Cargo gets the
# descriptor closed, so no long-lived child (an sccache server) keeps the lock. Locks live
# apart from sides and targets, so no name's lock is another name's file.
exec 8> "$home/locks/side-$name"
flock 8
rm -f "$home/bin/$name" "$home/bin/$name.side"

if [ -d "$tree" ]; then
  git -C "$repo" worktree remove --force "$tree"
fi
built=0
stamp=$(mktemp)
# A failed build leaves no binary, stamp or worktree behind.
trap '[ "$built" = 1 ] || { rm -f "$stamp" "$home/bin/$name.tmp" "$home/bin/$name.side"; git -C "$repo" worktree remove --force "$tree" 2> /dev/null; } || true' EXIT
# Each ref is resolved once, so the stamp names exactly the commits that were built.
base_commit=$(git -C "$repo" rev-parse --verify "$base^{commit}")
fuzzer_commit=$(git -C "$repo" rev-parse HEAD)
echo "base $base_commit" > "$stamp"
commits=()
for branch in "$@"; do
  commit=$(git -C "$repo" rev-parse --verify "$branch^{commit}")
  commits+=("$commit")
  echo "branch $branch $commit" >> "$stamp"
done
git -C "$repo" worktree add --quiet --detach "$tree" "$base_commit"
for commit in "${commits[@]}"; do
  git -C "$tree" merge --quiet --no-edit "$commit"
done

# A deliberate regression, to show a comparison catches it: MUTATE_FILE (relative to the
# repository) gets the perl substitution MUTATE_PERL, which must change it.
if [ -n "${MUTATE_FILE:-}" ]; then
  # The file must resolve inside the side's worktree, through any symlink.
  case "$(realpath -e "$tree/$MUTATE_FILE")" in
    "$(realpath -e "$tree")"/*) ;;
    *) echo "MUTATE_FILE must name a file in the repository" >&2; exit 2 ;;
  esac
  before=$(sha256sum "$tree/$MUTATE_FILE")
  perl -0pi -e "$MUTATE_PERL" "$tree/$MUTATE_FILE"
  if [ "$(sha256sum "$tree/$MUTATE_FILE")" = "$before" ]; then
    echo "MUTATE_PERL did not change $MUTATE_FILE" >&2
    exit 1
  fi
fi

# The fuzzer itself is the same on every side: this checkout's copy, hashed as copied.
rm -rf "${tree:?}/crates/client/cache-diff-fuzz"
cp -r "$crate" "$tree/crates/client/cache-diff-fuzz"
fuzzer_hash=$(cd "$tree/crates/client/cache-diff-fuzz" \
  && find . -type f -not -path './target/*' | LC_ALL=C sort | xargs cat | sha256sum | cut -c1-16)
if ! grep -q '"crates/client/cache-diff-fuzz"' "$tree/Cargo.toml"; then
  sed -i 's|^  "crates/client/cache-core",$|  "crates/client/cache-core",\n  "crates/client/cache-diff-fuzz",|' "$tree/Cargo.toml"
fi

# Sides that share a target take turns, so one never copies another's binary. `-o` keeps
# the lock out of long-lived children such as an sccache server.
(
  cd "$tree"
  export CACHE_DIFF_FUZZ_IDLE_CHECKPOINT=${IDLE_CHECKPOINT:-0} CARGO_TARGET_DIR=$target out=$home/bin/$name.tmp
  flock -o "$home/locks/target-${TARGET:-$name}" bash -c 'cargo build --quiet --release -p cache-diff-fuzz && cp "$CARGO_TARGET_DIR/release/cache-diff-fuzz" "$out"' 8>&-
)
{
  cat "$stamp"
  echo "tree $(git -C "$tree" rev-parse HEAD)"
  echo "idle-checkpoint ${IDLE_CHECKPOINT:-0}"
  if [ -n "${MUTATE_FILE:-}" ]; then echo "mutate $MUTATE_FILE $MUTATE_PERL"; fi
  echo "fuzzer $fuzzer_commit $fuzzer_hash"
} > "$home/bin/$name.side"
rm -f "$stamp"
mv "$home/bin/$name.tmp" "$home/bin/$name"
built=1
cat "$home/bin/$name.side"
