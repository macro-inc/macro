printf 'Uploaded `%s` to Google Play internal testing with status `%s`.\n' \
  "$RELEASE_TAG" "$RELEASE_STATUS" >> "$GITHUB_STEP_SUMMARY"
