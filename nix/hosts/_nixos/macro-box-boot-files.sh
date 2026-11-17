# Copies each imported Macro computer image's kernel, initrd and command line
# out of its metadata tarball into $BOOT_FILES/<fingerprint>/, then sets the
# image property user.macro.boot.append to the command line. The Incus fleet
# boots a computer's kernel directly (raw.qemu) only from an image with that
# property, so it is set last, once the files are complete.
#
# Usage: macro-box-boot-files [fingerprint...]; with none, every image.
# Images without boot/ in their metadata (other images) are left alone.
# Boot files are never deleted here: an instance created from an image keeps
# booting from them after the image itself is deleted.
images=("$@")
if [ ${#images[@]} -eq 0 ]; then
  mapfile -t images < <(incus image list --format csv --columns F)
fi

for fingerprint in "${images[@]}"; do
  if ! [[ $fingerprint =~ ^[0-9a-f]{64}$ ]]; then
    echo "skipping $fingerprint: not a full fingerprint" >&2
    continue
  fi
  directory=$BOOT_FILES/$fingerprint
  if [ -s "$directory/kernel" ] && [ -s "$directory/initrd" ] \
    && [ -n "$(incus image get-property "$fingerprint" user.macro.boot.append 2>/dev/null)" ]; then
    continue
  fi
  # Split images keep their metadata tarball under the image's fingerprint.
  metadata=$IMAGE_STORE/$fingerprint
  if [ ! -f "$metadata" ] || ! tar --list --file "$metadata" boot/kernel >/dev/null 2>&1; then
    continue
  fi
  staging=$(mktemp --directory "$BOOT_FILES/.staging.XXXXXX")
  tar --extract --file "$metadata" --directory "$staging" boot/kernel boot/initrd boot/cmdline
  if [ ! -s "$staging/boot/kernel" ] || [ ! -s "$staging/boot/initrd" ] || [ ! -s "$staging/boot/cmdline" ]; then
    echo "skipping $fingerprint: incomplete boot files" >&2
    rm -rf "$staging"
    continue
  fi
  chmod 0644 "$staging"/boot/*
  rm -rf "$directory"
  mv "$staging/boot" "$directory"
  rmdir "$staging"
  incus image set-property "$fingerprint" user.macro.boot.append "$(cat "$directory/cmdline")"
  echo "boot files for $fingerprint in $directory"
done
