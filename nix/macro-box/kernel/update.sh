#!/usr/bin/env bash
# Regenerates firecracker-x86_64.config: Firecracker's CI microVM config
# (Apache-2.0, firecracker-microvm/firecracker at FIRECRACKER_REV) plus
# macro-box.fragment, resolved with `make olddefconfig` against the kernel
# source the Firecracker image builds. Run from the repository root after
# changing the fragment, the pinned revision or nixpkgs' 6.18 kernel.
set -euo pipefail
FIRECRACKER_REV=7614ab4d258ad66eee72a34f2fbf3712c3664c65
here=nix/macro-box/kernel
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

src=$(nix build --no-link --print-out-paths '.#nixosConfigurations.macro-box-firecracker.config.boot.kernelPackages.kernel.src')
tar -xJf "$src" -C "$work" --strip-components=1
curl -fsSL -o "$work/.config" \
  "https://raw.githubusercontent.com/firecracker-microvm/firecracker/$FIRECRACKER_REV/resources/guest_configs/microvm-kernel-ci-x86_64-6.18.config"
nix shell nixpkgs#gnumake nixpkgs#gcc nixpkgs#flex nixpkgs#bison nixpkgs#bc nixpkgs#perl -c \
  bash -c "cd '$work' && scripts/kconfig/merge_config.sh -m .config '$PWD/$here/macro-box.fragment' > /dev/null && make -s olddefconfig"

# Every line of the fragment must survive olddefconfig: a dropped one means
# an unmet dependency.
missing=0
while read -r line; do
  if ! grep -qx "$line" "$work/.config"; then
    echo "update.sh: $line did not survive olddefconfig" >&2
    missing=1
  fi
done < <(grep -E '^CONFIG_' "$here/macro-box.fragment")
[ "$missing" = 0 ]
cp "$work/.config" "$here/firecracker-x86_64.config"
