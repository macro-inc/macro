# --- merge result native check ------------------------------------------------
# merge_result_native_check <hash> <listing> <fetch>: is the native code of
# PR #PR_NUMBER's merge result the native code of HEAD, the code this run
# built or is about to build? The merge gate hashes the merge result, so a
# build that differs from it could never pass the gate. <hash> / <listing>
# print a commit's native hash / the listing behind it; <fetch> makes a
# commit available (the iOS and Android helpers differ). Needs GH_TOKEN,
# GH_REPO, PR_NUMBER, BASE_BRANCH, and pr_merge_commit.
#
# GitHub's test merge commit answers directly when it exists. It doesn't for
# a PR that conflicts with its base, but the question still has an answer:
# if the base's native code hasn't moved since the PR branched, merging can
# only carry HEAD's native code, whatever files the conflicts are in. A
# refusal lists the native files the base changed.
merge_result_native_check() {
  local hash=$1 listing=$2 fetch=$3 built built_hash merge merge_hash compare tip \
    merge_base tip_hash base_hash why files
  # Callers run this under `if !`, which turns off `set -e` here, so every
  # lookup is checked: an empty commit hashes the same on both sides and would
  # pass an unchecked comparison.
  built=$(git rev-parse HEAD)
  if ! built_hash=$($hash "$built"); then
    echo "Could not hash this build's native code (${built:0:10})." >&2
    return 1
  fi
  merge=""
  if merge=$(pr_merge_commit); then
    if ! $fetch "$merge" || ! merge_hash=$($hash "$merge"); then
      echo "Could not fetch or hash PR #${PR_NUMBER}'s merge result (${merge:0:10})." >&2
      return 1
    fi
    if [[ "$merge_hash" == "$built_hash" ]]; then
      echo "Native code matches the merge result ${merge:0:10}."
      return 0
    fi
    why="PR #${PR_NUMBER}'s merge result (${merge:0:10}) has native code this build (${built:0:10}) lacks"
  fi
  if ! compare=$(gh api "repos/${GH_REPO}/compare/${BASE_BRANCH}...${built}" \
    --jq '"\(.base_commit.sha) \(.merge_base_commit.sha)"'); then
    echo "Could not compare ${BASE_BRANCH} with ${built:0:10}, so the merge result's native code is unverified." >&2
    return 1
  fi
  read -r tip merge_base <<<"$compare"
  if [[ -z "$tip" || -z "$merge_base" ]] || ! $fetch "$tip" || ! $fetch "$merge_base"; then
    echo "Could not fetch ${BASE_BRANCH} (${tip:0:10}) or the PR's branch point (${merge_base:0:10})." >&2
    return 1
  fi
  if [[ -z "$merge" ]]; then
    if ! tip_hash=$($hash "$tip") || ! base_hash=$($hash "$merge_base"); then
      echo "Could not hash ${BASE_BRANCH} (${tip:0:10}) or the PR's branch point (${merge_base:0:10})." >&2
      return 1
    fi
    if [[ "$tip_hash" == "$base_hash" ]]; then
      echo "PR #${PR_NUMBER} has no merge result (conflicts, or GitHub has not computed it), but ${BASE_BRANCH} (${tip:0:10})" \
        "still has the native code the PR branched from (${merge_base:0:10}), so merging can only carry this build's native code."
      return 0
    fi
    why="PR #${PR_NUMBER} has no merge result (conflicts, or GitHub has not computed it), and ${BASE_BRANCH} changed native code since the PR branched"
  fi
  # Listing lines are `<mode> <type> <sha>\t<path>` or `cache-wasm-version <v>`.
  # awk splits on the tab portably; BSD sed has no `\t` in a bracket.
  files=$({ diff <($listing "$merge_base") <($listing "$tip") || true; } \
    | awk -F'\t' '/^[<>] cache-wasm-version / { print "  " substr($0, 3); next }
                  /^[<>] / && NF > 1 { print "  " $2 }' | sort -u)
  echo "${why}. Native changes on ${BASE_BRANCH} since ${merge_base:0:10}" \
    "(https://github.com/${GH_REPO}/compare/${merge_base:0:10}...${tip:0:10}):" >&2
  echo "${files:-  (none listed: an excluded path?)}" >&2
  return 1
}
# ------------------------------------------------------------------------------
