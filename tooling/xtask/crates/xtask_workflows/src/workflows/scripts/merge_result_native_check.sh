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
  local hash=$1 listing=$2 fetch=$3 built merge tip merge_base why files
  built=$(git rev-parse HEAD)
  merge=""
  if merge=$(pr_merge_commit); then
    $fetch "$merge"
    if [[ "$($hash "$merge")" == "$($hash "$built")" ]]; then
      echo "Native code matches the merge result ${merge:0:10}."
      return 0
    fi
    why="PR #${PR_NUMBER}'s merge result (${merge:0:10}) has native code this build (${built:0:10}) lacks"
  fi
  read -r tip merge_base < <(gh api "repos/${GH_REPO}/compare/${BASE_BRANCH}...${built}" \
    --jq '"\(.base_commit.sha) \(.merge_base_commit.sha)"')
  $fetch "$tip"
  $fetch "$merge_base"
  if [[ -z "$merge" ]]; then
    if [[ "$($hash "$tip")" == "$($hash "$merge_base")" ]]; then
      echo "PR #${PR_NUMBER} has no merge result (conflicts, or GitHub has not computed it), but ${BASE_BRANCH} (${tip:0:10})" \
        "still has the native code the PR branched from (${merge_base:0:10}), so merging can only carry this build's native code."
      return 0
    fi
    why="PR #${PR_NUMBER} has no merge result (conflicts, or GitHub has not computed it), and ${BASE_BRANCH} changed native code since the PR branched"
  fi
  files=$({ diff <($listing "$merge_base") <($listing "$tip") || true; } \
    | sed -n -e 's/^[<>] [^\t]*\t/  /p' -e 's/^[<>] \(cache-wasm-version .*\)/  \1/p' | sort -u)
  echo "${why}. Native changes on ${BASE_BRANCH} since ${merge_base:0:10}" \
    "(https://github.com/${GH_REPO}/compare/${merge_base:0:10}...${tip:0:10}):" >&2
  echo "${files:-  (none listed: an excluded path?)}" >&2
  return 1
}
# ------------------------------------------------------------------------------
