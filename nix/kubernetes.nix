{ inputs, ... }:
let
  system = "x86_64-linux";
  pkgs = import inputs.nixpkgs { inherit system; };
  platform = import ../infra/k8s {
    inherit pkgs;
    inherit (inputs)
      nixidy
      nix2container
      crane
      fenix
      ;
    packages = inputs.self.packages.${system};
  };
in
{
  flake.kubeLocal = platform;
  perSystem =
    { ... }:
    let
      reference = platform.instance { name = "reference"; };
    in
    {
      packages = {
        local-kubernetes-tools = platform.tools;
        kubernetes-reference = reference.manifests;
        kubernetes-postgres-seed = reference.builds.postgresSeed;
        kubernetes-bootstrap = reference.builds.bootstrap;
        kubernetes-sync = reference.builds.sync;
        kubernetes-frontend = reference.builds.frontend;
        kubernetes-search-bootstrap = reference.builds.searchBootstrap;
      };
      checks.kubernetes-rendered =
        pkgs.runCommand "check-kubernetes-rendered"
          {
            nativeBuildInputs = [ pkgs.gitleaks ];
          }
          ''
            diff -ru ${../infra/k8s/rendered} ${reference.manifests}
            gitleaks dir --no-banner --redact ${reference.manifests}
            touch $out
          '';
    };
}
