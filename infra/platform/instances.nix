# Size profiles and the instances each cluster runs. A profile is the only
# thing allowed to differ between environments (see the parity check in
# docs/design/kubernetes-platform.md): replicas, resource requests, and
# volume sizes. Everything else comes from the same components.
rec {
  sizes = {
    local = {
      replicas = { };
      storage = {
        default = "2Gi";
        postgres = "10Gi";
        search = "10Gi";
        kafka = "10Gi";
        rustfs = "20Gi";
      };
      resources = {
        default.requests = {
          cpu = "25m";
          memory = "64Mi";
        };
        search.requests = {
          cpu = "250m";
          memory = "1Gi";
        };
        fusionauth.requests = {
          cpu = "250m";
          memory = "768Mi";
        };
        kafka.requests = {
          cpu = "250m";
          memory = "768Mi";
        };
        postgres.requests = {
          cpu = "250m";
          memory = "512Mi";
        };
      };
    };
  };

  # Instances on the local cluster. `just platform up <name>` creates or
  # updates one; any number can run side by side.
  local = {
    demo = {
      size = sizes.local;
    };
  };
}
