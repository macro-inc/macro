args:
let
  services = import ./components/services.nix args;
  dependencies = import ./components/dependencies.nix args;
in
(import ./components/backing.nix args)
// (args.lib.mapAttrs (
  _: service:
  service
  // {
    # Local bootstrap gates wrap the reusable service declarations.
    initContainers.dependencies = dependencies;
  }
) services)
// (import ./components/auxiliary.nix args)
// (import ./components/bootstrap.nix args)
