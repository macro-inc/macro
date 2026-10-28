{
  lib,
  libproxy,
  glib,
  gsettings-desktop-schemas,
}:
libproxy.overrideAttrs (
  old:
  let
    nixSchemaPatch =
      patch:
      lib.hasSuffix "hardcode-gsettings.patch" (toString patch)
      || lib.hasSuffix "skip-gsettings-detection.patch" (toString patch);
    removed = lib.filter nixSchemaPatch old.patches;
  in
  {
    pname = "libproxy-appimage";
    # Restore upstream's GSettings lookup so the bundled backend honors the
    # launcher's GSETTINGS_SCHEMA_DIR instead of opening a Nix store directory.
    patches =
      assert lib.assertMsg (builtins.length removed == 2) "Review libproxy's Nix schema patches";
      lib.filter (patch: !(nixSchemaPatch patch)) old.patches;
    preCheck = (old.preCheck or "") + ''
      export GSETTINGS_SCHEMA_DIR="${glib.getSchemaPath gsettings-desktop-schemas}"
    '';
  }
)
