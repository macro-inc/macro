# The cluster directory's commands, run as `nix run .#<name>` from it.
{ pkgs }:
let
  script =
    name: runtimeInputs:
    pkgs.writeShellApplication {
      inherit name runtimeInputs;
      text = builtins.readFile ./${name}.sh;
    };
  common = [
    pkgs.coreutils
    pkgs.git
    pkgs.findutils
  ];
  # kind 0.31 (nixos-26.05) can't create a v1.37 node: kubeadm dropped the
  # v1beta3 config it writes.
  kind = pkgs.kind.overrideAttrs (old: {
    version = "0.33.0";
    src = pkgs.fetchFromGitHub {
      owner = "kubernetes-sigs";
      repo = "kind";
      tag = "v0.33.0";
      hash = "sha256-exqO/KERw/SOv3dywcrm/DSHY37dfTOhQezg6Nroew0=";
    };
    vendorHash = "sha256-tRpylYpEGF6XqtBl7ESYlXKEEAt+Jws4x4VlUVW8SNI=";
  });
in
{
  render = script "render" (common ++ [ pkgs.rsync ]);
  check = script "check" (common ++ [ pkgs.diffutils ]);
  validate = script "validate" (
    common
    ++ [
      pkgs.kubeconform
      pkgs.yq-go
      pkgs.jq
    ]
  );
  bootstrap = script "bootstrap" (
    common
    ++ [
      pkgs.kubectl
      pkgs.yq-go
    ]
  );
  kind-smoke = script "kind-smoke" (
    common
    ++ [
      kind
      pkgs.kubectl
      pkgs.docker-client
      pkgs.yq-go
      pkgs.jq
      pkgs.gnugrep
      pkgs.gawk
      pkgs.util-linux
    ]
  );
}
