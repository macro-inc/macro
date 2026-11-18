#!/usr/bin/env bash
# Replace tz/ with an IANA tzdata release and regenerate src/prebuilt.
# Usage: vendor/chrono-tz/update-tzdata.sh 2026f
set -euo pipefail

release="${1:-}"
if [[ ! "$release" =~ ^[0-9]{4}[a-z]$ ]]; then
  echo "usage: $0 <IANA release, e.g. 2026f>" >&2
  exit 2
fi

# The tz maintainer's release signing key, as listed on
# https://www.iana.org/time-zones. The key has expired; gpg still verifies
# signatures made with it.
signing_key=7E3792A9D8ACF7D633BC1588ED97E90E62AA7E34
files=(africa antarctica asia australasia backward etcetera europe northamerica southamerica)

crate="$(\cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

url="https://data.iana.org/time-zones/releases/tzdata$release.tar.gz"
curl -fsSL -o "$work/tzdata.tar.gz" "$url"
curl -fsSL -o "$work/tzdata.tar.gz.asc" "$url.asc"

export GNUPGHOME="$work/gnupg"
mkdir -m 700 "$GNUPGHOME"
gpg --quiet --keyserver hkps://keyserver.ubuntu.com --recv-keys "$signing_key"
# Read gpg's whole status first: grep -q would stop reading at the match, and
# gpg's next status line would then fail the pipeline under pipefail.
status="$(gpg --status-fd 1 --verify "$work/tzdata.tar.gz.asc" "$work/tzdata.tar.gz" 2>/dev/null || true)"
if ! grep -q "^\[GNUPG:\] VALIDSIG $signing_key " <<<"$status"; then
  echo "tzdata$release.tar.gz is not signed by $signing_key" >&2
  exit 1
fi

mkdir "$work/src"
tar -xzf "$work/tzdata.tar.gz" -C "$work/src"
if [[ "$(cat "$work/src/version")" != "$release" ]]; then
  echo "tarball reports version $(cat "$work/src/version"), expected $release" >&2
  exit 1
fi

# chrono-tz-build drops everything after '#' on each line, so removing comments
# does not change the generated tables. The comments name contributors and
# carry their email addresses, which the repository's PII scan rejects.
# Build the new tz/ beside the download and copy it in only once it is
# complete, so a failed run leaves the committed files as they were.
mkdir "$work/tz"
for f in "${files[@]}"; do
  sed -e 's/#.*//' -e 's/[[:space:]]*$//' "$work/src/$f" | grep -v '^$' >"$work/tz/$f"
done
cp "$work/src/LICENSE" "$work/tz/LICENSE"
# chrono-tz-build reads IANA_TZDB_VERSION from the first release heading.
grep -m1 "^Release $release - " "$work/src/NEWS" >"$work/tz/NEWS"
cp "$work"/tz/* "$crate/tz/"

# tests/codegen.rs rewrites src/prebuilt and fails when the output changed;
# the second run must pass.
cargo test --quiet --manifest-path "$crate/Cargo.toml" --test codegen >/dev/null 2>&1 || true
cargo test --quiet --manifest-path "$crate/Cargo.toml" --test codegen

echo "chrono-tz now bundles tzdata $release"
