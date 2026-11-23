set -euo pipefail
[[ "$RELEASE_TAG" =~ ^v20[0-9]{2}\.[0-9]{1,2}\.[0-9]{1,2}(\.[0-9]{1,2})?$ ]]
gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json isDraft,isPrerelease \
  | jq -e '.isDraft == false and .isPrerelease == false'
filename="macro-$RELEASE_TAG-android-arm64.aab"
mapping="macro-$RELEASE_TAG-android-arm64-mapping.txt"
mkdir -p "$RUNNER_TEMP/play-release"
gh release download "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" \
  --dir "$RUNNER_TEMP/play-release" \
  --pattern "$filename" --pattern "$filename.sha256" \
  --pattern "$mapping" --pattern "$mapping.sha256"
\cd "$RUNNER_TEMP/play-release"
# Compare only the expected files; don't interpret paths from a checksum file.
for artifact in "$filename" "$mapping"; do
  expected=$(awk 'NR == 1 { print $1 }' "$artifact.sha256")
  [[ "$expected" =~ ^[a-f0-9]{64}$ ]]
  actual=$(sha256sum "$artifact" | cut -d ' ' -f 1)
  [[ "$actual" == "$expected" ]]
done
echo "bundle=$RUNNER_TEMP/play-release/$filename" >> "$GITHUB_OUTPUT"
echo "mapping=$RUNNER_TEMP/play-release/$mapping" >> "$GITHUB_OUTPUT"
