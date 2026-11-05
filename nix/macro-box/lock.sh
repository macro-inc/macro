#!/usr/bin/env bash
# Re-resolve debs.lock.json from packages.txt against a pinned Ubuntu
# snapshot. Run from anywhere: nix/macro-box/lock.sh [SNAPSHOT]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
snapshot="${1:-$(jq -r .snapshot "$here/debs.lock.json" 2>/dev/null || echo 20261101T000000Z)}"
mirror="https://snapshot.ubuntu.com/ubuntu/$snapshot"
# Ubuntu Archive Automatic Signing Key (2018).
archive_fingerprint=F6ECB3762474EDA9D21B7022871920D1991BC93C

if [ -z "${MACRO_BOX_LOCK_IN_SHELL:-}" ]; then
  export MACRO_BOX_LOCK_IN_SHELL=1
  exec nix shell nixpkgs#apt nixpkgs#gnupg nixpkgs#jq nixpkgs#python3 nixpkgs#curl \
    --command bash "${BASH_SOURCE[0]}" "$snapshot"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work"/{etc/apt/apt.conf.d,etc/apt/preferences.d,state/lists/partial,cache/archives/partial,log}
touch "$work/status"

curl -fsSL "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x$archive_fingerprint" \
  | gpg --dearmor > "$work/ubuntu.gpg"
fingerprint="$(gpg --show-keys --with-colons "$work/ubuntu.gpg" | awk -F: '$1=="fpr"{print $10; exit}')"
[ "$fingerprint" = "$archive_fingerprint" ] || { echo "keyserver returned $fingerprint, want $archive_fingerprint" >&2; exit 1; }

for suite in noble noble-updates noble-security; do
  echo "deb [arch=amd64 signed-by=$work/ubuntu.gpg] $mirror $suite main universe"
done > "$work/etc/apt/sources.list"

apt_opts=(
  -o "Dir=$work" -o "Dir::Etc=$work/etc/apt" -o "Dir::State=$work/state"
  -o "Dir::State::status=$work/status" -o "Dir::Cache=$work/cache" -o "Dir::Log=$work/log"
  -o APT::Architecture=amd64 -o APT::Architectures=amd64
  -o APT::Install-Recommends=false -o APT::Install-Suggests=false
  -o Debug::NoLocking=true
)
apt-get "${apt_opts[@]}" -qq update

mapfile -t wanted < <(grep -vE '^\s*(#|$)' "$here/packages.txt")
apt-get "${apt_opts[@]}" install --print-uris -qq -y \
  '?essential' '?priority(required)' "${wanted[@]}" > "$work/uris"
# The Essential/required set with its dependencies: what the rootfs build
# unpacks first and installs before everything else.
apt-get "${apt_opts[@]}" install --print-uris -qq -y \
  '?essential' '?priority(required)' > "$work/base-uris"
# Signed shim + GRUB are unpacked for the ESP, never installed.
apt-get "${apt_opts[@]}" download --print-uris -qq shim-signed grub-efi-amd64-signed > "$work/efi-uris"

python3 - "$work/uris" "$work/base-uris" "$work/efi-uris" "$snapshot" "$mirror" "$work/state/lists" > "$here/debs.lock.json" <<'PY'
import base64, json, os, sys
from urllib.parse import unquote
uris, base_uris, efi_uris, snapshot, mirror, lists = sys.argv[1:]
# apt --print-uris shows only MD5; take SHA512 from the signed indexes.
sha512 = {}
for name in os.listdir(lists):
    if not name.endswith("_Packages"):
        continue
    filename = None
    for line in open(os.path.join(lists, name), encoding="utf-8"):
        if line.startswith("Filename: "):
            filename = line.split(" ", 1)[1].strip()
        elif line.startswith("SHA512: ") and filename:
            sha512[filename] = line.split(" ", 1)[1].strip()
        elif line == "\n":
            filename = None
def locked(path):
    debs = []
    for line in open(path):
        url = line.split()[0].strip("'")
        pool = unquote(url.removeprefix(mirror + "/"))
        debs.append({
            "file": os.path.basename(pool),
            "url": url,
            "hash": "sha512-" + base64.b64encode(bytes.fromhex(sha512[pool])).decode(),
        })
    return sorted(debs, key=lambda deb: deb["file"])
base = {deb["file"] for deb in locked(base_uris)}
debs = [dict(deb, base=deb["file"] in base) for deb in locked(uris)]
json.dump({"snapshot": snapshot, "debs": debs, "efi": locked(efi_uris)}, sys.stdout, indent=1)
print()
PY
echo "locked $(jq '.debs | length' "$here/debs.lock.json") debs at $snapshot" >&2
