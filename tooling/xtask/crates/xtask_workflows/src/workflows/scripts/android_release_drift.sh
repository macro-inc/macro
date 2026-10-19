set -euo pipefail
# A push landed on a PR that carries android-update. Compare the Android native
# code before and after the push. Only native changes matter — web-only
# commits ship over the air after the merge. A force-push that discarded the
# old head counts as changed: nothing proves the released bundle still matches.
if gh_fetch "$BEFORE_SHA" && before=$(bun scripts/android-native.mjs hash "$BEFORE_SHA"); then :; else
  before=unknown
fi
gh_fetch "$AFTER_SHA"
after=$(bun scripts/android-native.mjs hash "$AFTER_SHA")
echo "native hash before: ${before}"
echo "native hash after:  ${after}"
if [[ "$before" == "$after" ]]; then
  echo "changed=false" >> "$GITHUB_OUTPUT"
  echo "No Android native changes in this push; the release stays valid."
else
  echo "changed=true" >> "$GITHUB_OUTPUT"
  # The version code that may already be on Play is the old head's. After a
  # force-push the old head is gone; the new head's code is the best guess (a
  # push rarely changes it), and it keeps the Play check running — that
  # check is what tells the author a stale bundle is already in production.
  if [[ "$before" != unknown ]]; then
    released=$BEFORE_SHA
  else
    released=$AFTER_SHA
    echo "The previous head is unreachable (force-push); checking Play for the current head's version code instead."
  fi
  echo "version_code=$(bun scripts/android-native.mjs version-code "$released")" >> "$GITHUB_OUTPUT"
  echo "Android native code changed; the released bundle is stale."
fi
