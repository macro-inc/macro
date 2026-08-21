# FHS dynamic linker for zigbuild binaries.
#
# Host `cargo zigbuild` links against `/lib64/ld-linux-x86-64.so.2` (x86_64)
# or `/lib/ld-linux-aarch64.so.2` (aarch64). Putting `glibc` in `contents`
# already materialises those paths in the customisation layer (`lib64` → `lib`
# plus `lib/ld-linux-*.so.2`). Do not symlink over the glibc *store* path:
# that is the interpreter Nix-linked tools (`/bin/sh`, `curl`) use, and
# overlaying it with a self-link makes every exec fail with ELOOP.
{ pkgs }:
{
  extraCommands = ''
    mkdir -p ./app
  '';
}
