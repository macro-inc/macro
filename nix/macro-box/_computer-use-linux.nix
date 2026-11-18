# computer-use-linux (MIT), the agent's desktop control MCP server, built from
# source at a pinned release. On the agent's X11 display it screenshots with a
# root-window GetImage, types and clicks through xdotool/XTEST, lists windows
# through wmctrl and xprop, and reads AT-SPI trees on the session bus.
{ pkgs }:
let
  inherit (pkgs) lib;
in
pkgs.rustPlatform.buildRustPackage (finalAttrs: {
  pname = "computer-use-linux";
  version = "0.7.49";
  src = pkgs.fetchFromGitHub {
    owner = "agent-sh";
    repo = "computer-use-linux";
    tag = "v${finalAttrs.version}";
    hash = "sha256-7tjEYla8l86n0OuOJCY0U33qUmpgtV+INEBuTQOGkQE=";
  };
  cargoHash = "sha256-qxyuguEdgmnS+v405AlEURHJ1apl9pmiEfLvOhN7HfY=";
  nativeBuildInputs = [ pkgs.makeWrapper ];
  # Its tests drive a live desktop session and compositor.
  doCheck = false;
  # xkbcommon is loaded with dlopen; the rest are programs it runs by name.
  postInstall = ''
    for program in $out/bin/*; do
      wrapProgram "$program" \
        --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath [ pkgs.libxkbcommon ]} \
        --prefix PATH : ${
          lib.makeBinPath [
            pkgs.xdotool
            pkgs.wmctrl
            pkgs.xprop
            pkgs.xrandr
            pkgs.glib
            pkgs.dbus
            pkgs.procps
            pkgs.fontconfig
            pkgs.xdg-user-dirs
          ]
        }
    done
  '';
  meta = {
    description = "Linux desktop control over MCP: AT-SPI trees, screenshots and input";
    homepage = "https://github.com/agent-sh/computer-use-linux";
    license = lib.licenses.mit;
    mainProgram = "computer-use-linux";
    platforms = lib.platforms.linux;
  };
})
