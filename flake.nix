{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    flake-parts.url = "github:hercules-ci/flake-parts";
    import-tree.url = "github:vic/import-tree";

    fenix.url = "github:nix-community/fenix";
    fenix.inputs.nixpkgs.follows = "nixpkgs";
    crane.url = "github:ipetkov/crane";
    crane-tauri.url = "github:JPHutchins/crane-tauri";
    # infra/platform: typed Kubernetes resources and store-path container images.
    kubenix.url = "github:hall/kubenix";
    kubenix.inputs.nixpkgs.follows = "nixpkgs";
    nix-snapshotter.url = "github:pdtpartners/nix-snapshotter";
    nix-snapshotter.inputs.nixpkgs.follows = "nixpkgs";
    tauri-cef = {
      url = "github:macro-inc/tauri/4b8a46f15c0a54a5c06a1486cd5432d444c17bd8";
      flake = false;
    };
  };

  outputs = inputs: inputs.flake-parts.lib.mkFlake { inherit inputs; } (inputs.import-tree ./nix);
}
