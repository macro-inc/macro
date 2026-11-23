# chrome-devtools-mcp from npm; the package bundles its dependencies.
{ pkgs }:
pkgs.stdenvNoCC.mkDerivation rec {
  pname = "chrome-devtools-mcp";
  version = "1.12.0";
  src = pkgs.fetchurl {
    url = "https://registry.npmjs.org/chrome-devtools-mcp/-/chrome-devtools-mcp-${version}.tgz";
    hash = "sha512-lAGpH0zXT1ZdaPefP1KK/MvxwihOlu7VGQ7p4wbhD9OhN17vUC4KWk/ImUYR9DE4s+7r4r0ySV4xr2OkTa7ZMA==";
  };
  nativeBuildInputs = [ pkgs.makeWrapper ];
  installPhase = ''
    mkdir -p $out/lib/chrome-devtools-mcp
    cp -r . $out/lib/chrome-devtools-mcp
    # files/cdp-wait.mjs: a browser call right after a restore waits (up to
    # 10 s) for Chromium's DevTools port instead of failing.
    makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/chrome-devtools-mcp \
      --add-flags "--import=${./files/cdp-wait.mjs}" \
      --add-flags $out/lib/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js
  '';
  meta.mainProgram = "chrome-devtools-mcp";
}
