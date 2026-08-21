# Arion composition for the local stack.
#
# Paths with `/_` are ignored by import-tree; `nix/arion.nix` imports this
# directory and injects the Linux dockerTools image attrsets. `just run_local`
# / `just stack` consume the rendered YAML (`.#arion-compose-yaml`) plus the
# xtask override for bind mounts, LocalStack, Mailpit, and the reverse proxy.
{
  pkgs,
  images,
  runtime,
  aux,
  ...
}:
let
  helpers = import ./lib.nix {
    inherit
      pkgs
      images
      runtime
      aux
      ;
  };
in
{
  project.name = "macro";
  enableDefaultNetwork = false;

  docker-compose.raw.name = "macro";

  networks = {
    services.driver = "bridge";
    databases.external = true;
    auth.external = true;
    auth-internal.driver = "bridge";
  };

  docker-compose.volumes = {
    db = {
      name = "macro_postgres_data";
      external = true;
    };
    cache = {
      name = "macro_redis_data";
      external = true;
    };
    opensearch_data = {
      name = "macro_opensearch_data";
      external = true;
    };
    kafka_data = {
      name = "macro_kafka_data";
      external = true;
    };
    db_data = {
      name = "fusionauth_db_data";
      external = true;
    };
    fusionauth_config = {
      name = "fusionauth_config";
      external = true;
    };
  };

  services =
    (import ./rust-services.nix { lib = helpers; })
    // (import ./databases.nix { lib = helpers; })
    // (import ./aux.nix { lib = helpers; })
    // (import ./fusionauth.nix { lib = helpers; })
    // (import ./tracing.nix { lib = helpers; });
}
