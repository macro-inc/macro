# Entry point for infra/platform. `instance` renders one Macro instance (one
# namespace); `cluster` renders what each cluster runs once (ingress). Both
# return kubenix-generated `List` manifests plus the images they reference.
{
  pkgs,
  kubenix,
  nix-snapshotter,
}:
let
  inherit (pkgs) lib;
  platformLib = import ./lib.nix { inherit pkgs nix-snapshotter; };
  platformPkgs = import ./packages.nix { inherit pkgs; };
  instances = import ./instances.nix;

  render =
    module:
    (kubenix.evalModules.${pkgs.stdenv.hostPlatform.system} {
      module =
        { kubenix, ... }:
        {
          imports = [
            kubenix.modules.k8s
            module
          ];
        };
    }).config.kubernetes.generated;

  # Ingress host and the cluster-wide pieces it needs.
  traefikPort = 8443;
in
{
  inherit platformPkgs instances;

  # One instance. `binaries`: cargo bin name -> store path containing
  # `bin/<name>`; `frontend`: the built app bundle; `caddyfile`: the
  # generated edge config.
  instance =
    {
      name,
      host,
      size ? instances.sizes.local,
      envRevision ? "",
      binaries,
      frontend,
      # Host-built Node service bundles: name -> store path.
      node ? { },
      caddyfile ? ./generated/Caddyfile,
      # The host port operator tooling port-forwards Kafka's HOST listener to;
      # the broker must advertise the same address.
      kafkaHostPort ? 9092,
    }:
    let
      namespace = "macro-${name}";
      instance = {
        inherit name size envRevision;
      };
      components = import ./components.nix {
        inherit pkgs lib platformLib platformPkgs;
        macro = {
          inherit
            binaries
            frontend
            node
            caddyfile
            kafkaHostPort
            ;
        };
      };
      workloads = lib.mapAttrsToList (
        n: w:
        platformLib.workloadResources {
          inherit instance;
          name = n;
          inherit w;
        }
      ) components;
      labels = {
        "app.kubernetes.io/part-of" = "macro";
        "macro.com/instance" = name;
      };
      manifests = render {
        kubernetes.namespace = namespace;
        kubernetes.resources = lib.foldl' lib.recursiveUpdate {
          namespaces.${namespace}.metadata = {
            inherit labels;
            name = namespace;
          };
          # Instances never reach each other: only their own pods and the
          # cluster ingress may connect.
          networkPolicies.isolate = {
            metadata = { inherit labels; };
            spec = {
              podSelector = { };
              policyTypes = [ "Ingress" ];
              ingress = [
                {
                  from = [
                    { podSelector = { }; }
                    { namespaceSelector.matchLabels."kubernetes.io/metadata.name" = "platform-ingress"; }
                  ];
                }
              ];
            };
          };
          ingresses.edge = {
            metadata = { inherit labels; };
            spec = {
              ingressClassName = "traefik";
              tls = [
                {
                  hosts = [ host ];
                  secretName = "macro-tls";
                }
              ];
              rules = [
                {
                  inherit host;
                  http.paths = [
                    {
                      path = "/";
                      pathType = "Prefix";
                      backend.service = {
                        name = "edge";
                        port.number = 8080;
                      };
                    }
                  ];
                }
              ];
            };
          };
        } workloads;
      };
    in
    {
      inherit manifests namespace components;
      infraWorkloads = lib.attrNames (lib.filterAttrs (_: w: w.infra or false) components);
      images = lib.mapAttrs (_: w: w.image) components;
    };

  # Host-built binaries as store paths (the fast loop): cargo's output dir ->
  # attrset of wrapped binaries.
  wrapBinaries =
    dir: names:
    lib.genAttrs names (
      bin:
      platformLib.wrapBinary {
        name = bin;
        binary = builtins.path {
          path = "${dir}/${bin}";
          name = bin;
        };
      }
    );

  cluster = render {
    kubernetes.resources = {
      namespaces.platform-ingress.metadata.name = "platform-ingress";
      ingressClasses.traefik.spec.controller = "traefik.io/ingress-controller";
      serviceAccounts.traefik.metadata.namespace = "platform-ingress";
      clusterRoles.traefik.rules = [
        {
          apiGroups = [ "" ];
          resources = [
            "services"
            "secrets"
            "nodes"
          ];
          verbs = [
            "get"
            "list"
            "watch"
          ];
        }
        {
          apiGroups = [ "discovery.k8s.io" ];
          resources = [ "endpointslices" ];
          verbs = [
            "get"
            "list"
            "watch"
          ];
        }
        {
          apiGroups = [ "networking.k8s.io" ];
          resources = [
            "ingresses"
            "ingressclasses"
          ];
          verbs = [
            "get"
            "list"
            "watch"
          ];
        }
        {
          apiGroups = [ "networking.k8s.io" ];
          resources = [ "ingresses/status" ];
          verbs = [ "update" ];
        }
      ];
      clusterRoleBindings.traefik = {
        roleRef = {
          apiGroup = "rbac.authorization.k8s.io";
          kind = "ClusterRole";
          name = "traefik";
        };
        subjects = [
          {
            kind = "ServiceAccount";
            name = "traefik";
            namespace = "platform-ingress";
          }
        ];
      };
      deployments.traefik = {
        metadata.namespace = "platform-ingress";
        spec = {
          # One pod owns the host port; a rolling update would deadlock on it.
          strategy.type = "Recreate";
          selector.matchLabels.app = "traefik";
          template = {
            metadata.labels.app = "traefik";
            spec = {
              serviceAccountName = "traefik";
              containers.traefik = {
                image =
                  (platformLib.image {
                    name = "traefik";
                    contents = [ pkgs.traefik ];
                    entrypoint = [
                      "traefik"
                      "--entrypoints.websecure.address=:${toString traefikPort}"
                      "--entrypoints.websecure.http.tls=true"
                      # Uploads and long requests: no entrypoint read deadline.
                      "--entrypoints.websecure.transport.respondingTimeouts.readTimeout=0"
                      "--providers.kubernetesingress=true"
                      "--providers.kubernetesingress.ingressclass=traefik"
                      "--log.level=WARN"
                    ];
                  }).ref;
                ports = [
                  {
                    containerPort = traefikPort;
                    # Loopback only on the host; the public NIC never sees it.
                    hostPort = 9443;
                    hostIP = "127.0.0.1";
                    protocol = "TCP";
                  }
                ];
              };
            };
          };
        };
      };
    };
  };
}
