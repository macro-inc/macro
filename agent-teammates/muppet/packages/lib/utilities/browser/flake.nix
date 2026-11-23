{
  description = "muppet browser: the programs utilities/browser needs";

  # What utilities/browser needs on the system: Chromium to drive, and ffmpeg
  # to turn its frames into video. Playwright drives it, from npm (as
  # playwright-core, which downloads no browser of its own). An agent's flake
  # takes this as an input and adds it to its dev shell:
  #
  #   inputs.browser = {
  #     url = "github:<owner>/muppet?dir=packages/lib/utilities/browser";
  #     inputs.nixpkgs.follows = "nixpkgs";
  #   };
  #
  #   devShells.default = pkgs.mkShell {
  #     packages = [ browser.packages.${system}.default ];
  #   };
  #
  # Chromium comes from nixpkgs on Linux only; elsewhere, install Chrome or
  # Chromium yourself and pass its path to `chromium({ executable })`.

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: {
        default = pkgs.buildEnv {
          name = "muppet-browser";
          paths = [
            # Headless: nothing here reads a display.
            pkgs.ffmpeg-headless
          ]
          ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.chromium ];
        };
      });
    };
}
