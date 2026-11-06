#!/usr/bin/env bash
# Builds the macro-box rootfs inside `unshare --user --map-root-user
# --mount` in the Nix sandbox: unpack the Essential debs (debootstrap's first
# stage), then chroot and let Ubuntu's own dpkg install everything under
# Ubuntu's fakeroot, which records the ownership the single mapped uid cannot
# hold (FAKEROOTDONTTRYCHOWN: a real chown to an unmapped id is EINVAL,
# which fakeroot does not swallow). Writes $out/rootfs.tar (VM) and $out/container.tar (Docker).
# Inputs: DEBS BASE FILES CONFIG SKILLS CLOSURE TOOLS out.
# shellcheck disable=SC2154
set -euo pipefail

root="$PWD/root"
mkdir -p "$root"/usr/{bin,sbin,lib,lib64} "$out"
for dir in bin sbin lib lib64; do ln -s "usr/$dir" "$root/$dir"; done
mkdir -p "$root"/{proc,sys,dev,tmp,run,debs,out,var/lib/dpkg/{info,updates},etc}
touch "$root/var/lib/dpkg/status" "$root/var/lib/dpkg/available"
chmod 1777 "$root/tmp"
cp -L "$DEBS"/*.deb "$root/debs/"

# BASE: the Essential/required closure (debs.lock.json `base`), one per line.
mapfile -t required < <(sed 's|^|/debs/|' "$BASE")
bootstrap=("${required[@]/#/$root}" "$root"/debs/fakeroot_*.deb "$root"/debs/libfakeroot_*.deb)
for deb in "${bootstrap[@]}"; do
  dpkg-deb --fsys-tarfile "$deb" | tar -x --keep-directory-symlink --no-same-owner --no-same-permissions -C "$root"
done

mount --rbind /dev "$root/dev"
mount --rbind /proc "$root/proc"
mount --bind "$out" "$root/out"
printf '#!/bin/sh\nexit 101\n' > "$root/usr/sbin/policy-rc.d"
chmod 0755 "$root/usr/sbin/policy-rc.d"

# Nix-built tools: the closure goes into the guest's /nix/store.
mkdir -p "$root/nix/store"
xargs -a "$CLOSURE/store-paths" cp -dR --preserve=mode,timestamps -t "$root/nix/store/"

cp -rT "$FILES" "$root/.macro-box-files"
cp -r --no-preserve=mode "$CONFIG"/. "$root/.macro-box-files/"
cp -rT "$SKILLS" "$root/.macro-box-skills"

in_chroot() {
  chroot "$root" /usr/bin/env -i \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin \
    HOME=/root LC_ALL=C.UTF-8 FAKEROOTDONTTRYCHOWN=1 \
    DEBIAN_FRONTEND=noninteractive DEBCONF_NONINTERACTIVE_SEEN=true \
    TOOLS="$TOOLS" \
    /usr/bin/fakeroot-sysv "$@"
}

in_chroot -s /.fakeroot -- /bin/bash -euo pipefail -c '
  dpkg --force-depends --install /debs/base-passwd_*.deb
  dpkg --force-depends --install /debs/base-files_*.deb
  dpkg --force-depends --force-confold --install "$@"
  # One dpkg run does not order unpacks by Pre-Depends, so each pass
  # installs what the last had to skip (chains such as python3.12-minimal ->
  # python3-minimal -> python3); the last pass must succeed.
  for pass in 1 2 3 4; do
    dpkg --force-confold --skip-same-version --install /debs/*.deb >/dev/null 2>&1 && break || true
  done
  dpkg --force-confold --skip-same-version --install /debs/*.deb
  # Packages unpacked before a dependency was configured stay unconfigured.
  dpkg --force-confold --configure --pending
  unconfigured=$(dpkg --audit)
  if [ -n "$unconfigured" ]; then echo "$unconfigured" >&2; exit 1; fi
  # The kernel may configure before initramfs-tools, whose trigger then only
  # updates existing images; build the initrd explicitly.
  rm -f /boot/initrd.img-*
  update-initramfs -c -k all
  test -s /boot/initrd.img
' bash "${required[@]}"

in_chroot -i /.fakeroot -s /.fakeroot -- /bin/bash -euo pipefail -c '
  cp -rT /.macro-box-files /
  chmod 0440 /etc/sudoers.d/macro
  rm -rf /.macro-box-files

  for bin in "$TOOLS"/bin/*; do ln -s "$bin" "/usr/local/bin/$(basename "$bin")"; done

  mkdir -p /opt/macro
  ln -s "$TOOLS/bin/brain" /opt/macro/brain

  locale-gen
  update-locale LANG=en_US.UTF-8

  mkdir -p /boot/efi

  useradd --create-home --uid 1000 --user-group --shell /bin/bash --groups docker macro
  install -d -o root -g root -m 0755 /var/lib/macrod /etc/macro/personas
  chmod 0700 /etc/macro/personas

  # Skills and Claude Code user config for macro and for every persona user
  # macrod-enroll creates with useradd -m.
  for home in /etc/skel /home/macro; do
    mkdir -p "$home/.claude"
    cp -rT /.macro-box-skills "$home/.claude/skills"
  done
  rm -rf /.macro-box-skills

  mkdir -p /home/macro/work /home/macro/.macrod /home/macro/.config/chromium \
    /home/macro/.config/systemd/user/default.target.wants
  for unit in macro-display macro-openbox macro-chromium; do
    ln -s "/etc/systemd/user/$unit.service" "/home/macro/.config/systemd/user/default.target.wants/$unit.service"
  done
  chown -R macro:macro /home/macro
  mkdir -p /var/lib/systemd/linger
  touch /var/lib/systemd/linger/macro

  systemctl enable \
    macrod-enroll.service macrod.service incus-agent.service macro-box-growroot.service \
    systemd-networkd.service systemd-resolved.service docker.service
  ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf

  # Each instance gets its own machine-id on first boot.
  : > /etc/machine-id
  rm -f /var/lib/dbus/machine-id
  ln -s /etc/machine-id /var/lib/dbus/machine-id

  rm -f /usr/sbin/policy-rc.d
  rm -rf /var/cache/apt/*.bin /var/lib/apt/lists/* /var/log/*.log /root/.cache

  excludes=(--exclude=./debs --exclude=./out --exclude=./.fakeroot --exclude="./proc/*"
    --exclude="./dev/*" --exclude="./sys/*" --exclude="./tmp/*" --exclude="./run/*")
  tar --numeric-owner -cpf /out/rootfs.tar "${excludes[@]}" -C / .
  tar --numeric-owner -cpf /out/container.tar "${excludes[@]}" \
    --exclude="./boot/*" --exclude="./usr/lib/modules/*" --exclude="./usr/lib/firmware/*" -C / .
'
