{
  pkgs,
  lib,
  platformLib,
  platformPkgs,
  instance,
  ...
}:
let
  bootstrap = import ./bootstrap.nix {
    inherit
      pkgs
      lib
      platformLib
      platformPkgs
      instance
      ;
  };
in
{
  image = platformPkgs.utilityImages.readiness.ref;
  command = [
    "/bin/sh"
    "-ec"
    ''
      ${lib.concatMapStringsSep "\n" (
        name:
        let
          job = platformLib.jobName instance name bootstrap.${name};
        in
        ''
          until kubectl get job ${job} >/dev/null 2>&1; do sleep 0.2; done
          kubectl wait --for=condition=complete job/${job} --timeout=600s
        ''
      ) (builtins.attrNames bootstrap)}
      for endpoint in fusionauth:9011 localstack:4566 redis:6379; do
        until nc -z -w 1 "''${endpoint%:*}" "''${endpoint#*:}"; do sleep 0.2; done
      done
    ''
  ];
}
