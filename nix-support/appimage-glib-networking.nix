{
  lib,
  glib-networking,
  libproxy,
}:
(glib-networking.override { inherit libproxy; }).overrideAttrs (
  old:
  let
    nixSchemaPatch = patch: lib.hasSuffix "hardcode-gsettings.patch" (toString patch);
    removed = lib.filter nixSchemaPatch old.patches;
  in
  {
    pname = "glib-networking-appimage";
    # The GNOME resolver must use the AppImage's GSETTINGS_SCHEMA_DIR, not
    # nixpkgs' explicit schema source in /nix/store. Keep all other patches.
    patches =
      assert lib.assertMsg (builtins.length removed == 1) "Review glib-networking's Nix schema patch";
      (lib.filter (patch: !(nixSchemaPatch patch)) old.patches) ++ [ ./appimage-ssl-cert-file.patch ];
  }
)
