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
      pkgs.kind
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
