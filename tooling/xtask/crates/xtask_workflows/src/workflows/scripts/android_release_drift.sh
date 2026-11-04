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
  # Only the verified old head identifies the version that may be on Play.
  # A force-push may also bump the version, so the new head cannot substitute.
  if [[ "$before" != unknown ]]; then
    echo "version_code=$(bun scripts/android-native.mjs version-code "$BEFORE_SHA")" >> "$GITHUB_OUTPUT"
  else
    echo "The previous native tree could not be verified; the prior Play version and production status remain unknown."
  fi
  echo "Android native code changed or cannot be verified; treating the released bundle as stale."
fi
