{ runCommand, xdg-utils }:
let
  # Preserve upstream PATH-based commands; resholve embeds Nix tool/data paths.
  portable = xdg-utils.overrideAttrs {
    preFixup = "";
    dontPatchShebangs = true;
  };
in
runCommand "tauri-appimage-xdg-utils" { dontPatchShebangs = true; } ''
  mkdir -p "$out/bin" "$out/libexec/macro"
  for helper in xdg-open xdg-mime; do
    install -m0755 ${../nix/appimage/xdg-helper.sh} "$out/bin/$helper"
    install -m0755 "${portable}/bin/$helper" "$out/libexec/macro/$helper"
  done
  install -m0644 ${../nix/appimage/host-environment.sh} "$out/libexec/macro/host-environment.sh"
''
