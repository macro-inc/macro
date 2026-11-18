{
  description = "muppet macro calls: the programs utilities/macro/calls needs";

  # Sharing a browser tab in a call needs what utilities/browser needs
  # (Chromium, and ffmpeg, which decodes the tab's frames). An agent's flake
  # takes this as an input and adds it to its dev shell:
  #
  #   inputs.calls = {
  #     url = "github:<owner>/muppet?dir=packages/lib/utilities/macro/calls";
  #     inputs.nixpkgs.follows = "nixpkgs";
  #   };
  #
  #   devShells.default = pkgs.mkShell {
  #     packages = [ calls.packages.${system}.default ];
  #   };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    browser = {
      url = "path:../../browser";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { nixpkgs, browser, ... }:
    {
      packages = nixpkgs.lib.mapAttrs (system: packages: {
        inherit (packages) default;
      }) browser.packages;
    };
}
