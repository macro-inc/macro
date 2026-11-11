{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    flake-parts.url = "github:hercules-ci/flake-parts";
    import-tree.url = "github:vic/import-tree";

    fenix.url = "github:nix-community/fenix";
    fenix.inputs.nixpkgs.follows = "nixpkgs";
    disko.url = "github:nix-community/disko";
    disko.inputs.nixpkgs.follows = "nixpkgs";
    crane.url = "github:ipetkov/crane";
    # The Macro computer's herdr and its official agent skill; see
    # nix/macro-box/AGENTS.md.
    herdr = {
      url = "github:herdrdev/herdr/v0.9.5";
      flake = false;
    };
    crane-tauri.url = "github:JPHutchins/crane-tauri";
    tauri-cef = {
      url = "github:macro-inc/tauri/4b8a46f15c0a54a5c06a1486cd5432d444c17bd8";
      flake = false;
    };
  };

  outputs = inputs: inputs.flake-parts.lib.mkFlake { inherit inputs; } (inputs.import-tree ./nix);
}
