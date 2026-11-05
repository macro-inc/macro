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

    # Not deployed yet; it exists so the parity check compares against something real.
    # Only stateless services scale: data-plane workloads and the queue gateway hold
    # single-writer state.
    prod = {
      replicas = {
        authentication-service = 3;
        connection-gateway = 3;
        document-storage-service = 3;
        edge = 3;
        email-service = 3;
        lexical-service = 3;
        notification-service = 3;
        search-processing-service = 3;
      };
      storage = {
        default = "20Gi";
        postgres = "500Gi";
        search = "200Gi";
        kafka = "500Gi";
        rustfs = "2Ti";
      };
      resources = {
        default = {
          requests = {
            cpu = "250m";
            memory = "512Mi";
          };
          limits.memory = "2Gi";
        };
        search.requests = {
          cpu = "2";
          memory = "8Gi";
        };
        fusionauth.requests = {
          cpu = "1";
          memory = "2Gi";
        };
        kafka.requests = {
          cpu = "2";
          memory = "8Gi";
        };
        postgres.requests = {
          cpu = "4";
          memory = "16Gi";
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
