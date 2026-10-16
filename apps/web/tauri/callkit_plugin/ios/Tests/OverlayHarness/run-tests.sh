#!/usr/bin/env bash
set -euo pipefail

harness_dir="$(\cd "$(dirname "$0")" && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/macro-call-overlay.XXXXXX")"
destination="${1:-platform=iOS Simulator,name=iPhone Air}"

# Resolve sources before generating outside the checkout. No generated Xcode
# project, downloaded SDK, or test result belongs in the production source tree.
python3 - "$harness_dir" "$test_dir" <<'PY'
from pathlib import Path
import re
import sys
source, output = map(Path, sys.argv[1:])
spec = (source / 'project.yml').read_text()
spec = re.sub(r'^(\s+- )(.*\.swift)$', lambda m: m[1] + str((source / m[2]).resolve()), spec, flags=re.M)
(output / 'project.yml').write_text(spec)
PY

echo "Native overlay test artifacts: $test_dir"
xcodegen generate --spec "$test_dir/project.yml" --project "$test_dir"
xcodebuild test \
  -project "$test_dir/CallOverlayHarness.xcodeproj" \
  -scheme CallOverlayHarness \
  -destination "$destination" \
  -derivedDataPath "$test_dir/DerivedData" \
  -resultBundlePath "$test_dir/results.xcresult" \
  -parallel-testing-enabled NO
