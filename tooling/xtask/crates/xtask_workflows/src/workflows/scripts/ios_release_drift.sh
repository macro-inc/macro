set -euo pipefail
# A push landed on a PR that carries ios-update. Compare the native tree
# before and after the push. Only native changes matter — web-only commits
# ship over the air after the merge. A force-push that discarded the old
# head counts as changed: nothing proves the released build still matches.
if native_tree_fetch "$BEFORE_SHA" && before_tree=$(native_tree_hash "$BEFORE_SHA"); then :; else
  before_tree=unknown
fi
native_tree_fetch "$AFTER_SHA"
after_tree=$(native_tree_hash "$AFTER_SHA")
echo "native tree before: ${before_tree}"
echo "native tree after:  ${after_tree}"
if [[ "$before_tree" == "$after_tree" ]]; then
  echo "changed=false" >> "$GITHUB_OUTPUT"
  echo "No native changes in this push; the release stays valid."
else
  echo "changed=true" >> "$GITHUB_OUTPUT"
  echo "Native code changed; the released build is stale."
fi
