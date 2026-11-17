{
  description = "Observability cluster contents: nixidy modules rendered to YAML that Argo CD applies";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    nixidy = {
      url = "github:arnarg/nixidy";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { nixpkgs, nixidy, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      envs =
        pkgs:
        nixidy.lib.mkEnvs {
          inherit pkgs;
          modules = [ ./modules ];
          envs.prod.modules = [ ./env/prod.nix ];
        };
    in
    {
      nixidyEnvs = forAllSystems envs;

      packages = forAllSystems (
        pkgs:
        let
          prod = (envs pkgs).prod;
          tools = import ./scripts { inherit pkgs; };
        in
        {
          # The tree committed under manifests/prod. The app of apps
          # (Application-apps.yaml) goes into apps/ with the Applications it
          # syncs, so after `scripts/bootstrap.sh` applies it once it manages
          # itself too. File names are kind-name; `:` in a name (RBAC objects)
          # becomes `_`, which no Kubernetes name contains, because CI's
          # changed-files tooling and some filesystems can't handle it.
          prod = pkgs.runCommand "observability-cluster-prod" { } ''
            cp -rL --no-preserve=mode ${prod.environmentPackage}/. $out/
            cp -L --no-preserve=mode ${prod.bootstrapPackage}/*.yaml $out/apps/
            find $out -name '*:*' -type f | while IFS= read -r file; do
              mv "$file" "$(dirname "$file")/$(basename "$file" | tr : _)"
            done
          '';
          inherit (tools)
            render
            check
            validate
            bootstrap
            kind-smoke
            ;
        }
      );

      apps = forAllSystems (
        pkgs:
        nixpkgs.lib.genAttrs
          [
            "render"
            "check"
            "validate"
            "bootstrap"
            "kind-smoke"
          ]
          (name: {
            type = "app";
            program = nixpkgs.lib.getExe (import ./scripts { inherit pkgs; }).${name};
          })
      );

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
