# Collabora LibreOfficeKit runtime for convert-service production images.
#
# Matches `docker/Dockerfile.convert_service.prebuilt`: Collabora's
# `core-co-25.04` instdir at `/app/lok`, plus the shared libraries
# `libmergedlo.so` dlopens at runtime.
{
  pkgs,
  lib,
}:
let
  assets = pkgs.fetchzip {
    url = "https://github.com/CollaboraOnline/online/releases/download/for-code-assets/core-co-25.04-assets.tar.gz";
    hash = "sha256-H3WnyJDkbZ7lrZKADfkzPAD3cW5PQzYCdy9c/p53fYk=";
    stripRoot = false;
  };

  lokLibs = with pkgs; [
    cairo
    cups
    dbus
    fontconfig
    freetype
    glib
    harfbuzz
    icu
    krb5
    lcms2
    libjpeg
    libpng
    libxml2
    nspr
    nss
    openjpeg
    pango
    zlib
  ];

  fonts = with pkgs; [
    dejavu_fonts
    liberation_ttf
    noto-fonts
  ];
in
{
  layout = pkgs.runCommand "convert-service-lok" { } ''
    mkdir -p $out/app/lok $out/usr/share/fonts
    cp -a ${assets}/instdir $out/app/lok/instdir
    cp -a ${assets}/include $out/app/lok/include
    chmod -R u+w $out/app/lok
    for f in ${lib.concatStringsSep " " fonts}; do
      find "$f" \( -name '*.ttf' -o -name '*.otf' \) -exec cp -t $out/usr/share/fonts {} +
    done
  '';

  extraEnv = [
    "LD_LIBRARY_PATH=/app/lok/instdir/program:${lib.makeLibraryPath lokLibs}"
    "LOK_PATH=/app/lok/instdir/program"
    "FONTCONFIG_PATH=${pkgs.fontconfig.out}/etc/fonts"
  ];

  inherit lokLibs;
}
