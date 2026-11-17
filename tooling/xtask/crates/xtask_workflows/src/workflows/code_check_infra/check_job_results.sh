echo "path-check: $PATH_CHECK_RESULT"
echo "biome-check: $BIOME_CHECK_RESULT"
echo "check: $CHECK_RESULT"

# Only success and skipped are OK. A job that hits its timeout reports
# cancelled, and passing on that would merge code whose checks never ran.
for result in \
  "$PATH_CHECK_RESULT" \
  "$BIOME_CHECK_RESULT" \
  "$CHECK_RESULT"; do
  if [[ "$result" != "success" && "$result" != "skipped" ]]; then
    echo "❌ One or more jobs failed or were cancelled"
    exit 1
  fi
done

echo "✅ All jobs passed or were skipped"
