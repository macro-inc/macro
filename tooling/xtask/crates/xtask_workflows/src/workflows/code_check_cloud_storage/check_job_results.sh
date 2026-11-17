echo "path-check: $PATH_CHECK_RESULT"
echo "check: $CHECK_RESULT"
echo "doppler-config: $DOPPLER_CONFIG_RESULT"
echo "test: $TEST_RESULT"
echo "build-service-bins: $BUILD_SERVICE_BINS_RESULT"
echo "graphql-schema-compat: $GRAPHQL_SCHEMA_COMPAT_RESULT"

# Only success and skipped are OK. A job that hits its timeout reports
# cancelled, and passing on that would merge code whose tests never ran.
for result in \
  "$PATH_CHECK_RESULT" \
  "$CHECK_RESULT" \
  "$DOPPLER_CONFIG_RESULT" \
  "$TEST_RESULT" \
  "$BUILD_SERVICE_BINS_RESULT" \
  "$GRAPHQL_SCHEMA_COMPAT_RESULT"; do
  if [[ "$result" != "success" && "$result" != "skipped" ]]; then
    echo "❌ One or more jobs failed or were cancelled"
    exit 1
  fi
done

echo "✅ All jobs passed or were skipped"
