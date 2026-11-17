echo "path-check: $PATH_CHECK_RESULT"
echo "android-native-check: $ANDROID_NATIVE_CHECK_RESULT"
echo "typescript: $TYPESCRIPT_RESULT"
echo "generated-code: $GENERATED_CODE_RESULT"
echo "biome-check: $BIOME_CHECK_RESULT"
echo "test: $TEST_RESULT"
echo "functional: $FUNCTIONAL_RESULT"
echo "browser: $BROWSER_RESULT"
echo "cycles: $CYCLES_RESULT"
echo "build: $BUILD_RESULT"
echo "ios-native-check: $IOS_NATIVE_CHECK_RESULT"

# The Android check always runs, so it must succeed. For the rest only
# success and skipped are OK: a job that hits its timeout reports
# cancelled, and passing on that would merge code whose checks never ran.
if [[ "$ANDROID_NATIVE_CHECK_RESULT" != "success" ]]; then
  echo "Android Native Check did not succeed"
  exit 1
fi
for result in \
  "$PATH_CHECK_RESULT" \
  "$TYPESCRIPT_RESULT" \
  "$GENERATED_CODE_RESULT" \
  "$BIOME_CHECK_RESULT" \
  "$TEST_RESULT" \
  "$FUNCTIONAL_RESULT" \
  "$BROWSER_RESULT" \
  "$CYCLES_RESULT" \
  "$BUILD_RESULT" \
  "$IOS_NATIVE_CHECK_RESULT"; do
  if [[ "$result" != "success" && "$result" != "skipped" ]]; then
    echo "One or more jobs failed or were cancelled"
    exit 1
  fi
done

echo "All jobs passed or were skipped"
