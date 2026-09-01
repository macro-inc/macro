{
  description = "AI coding agent devshell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      # Linux only: the image always runs in Docker, including on macOS.
      # Unpinned `docker build` then bakes native amd64 or Apple Silicon / ARM
      # Linux. GHCR / Daytona / Fly stay linux/amd64 and do not use this path.
      forEachSystem = nixpkgs.lib.genAttrs [ "x86_64-linux" "aarch64-linux" ];
    in
    {
      devShells = forEachSystem (system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in {
          default = pkgs.mkShell {
            packages = [ pkgs.nodejs pkgs.git pkgs.opencode ];
          };
        });
    };
}
