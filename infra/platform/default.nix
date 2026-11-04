# Entry point for infra/platform. `instance` renders one Macro instance (one
# namespace, one Argo CD Application); `cluster` renders what each cluster runs
# once (ingress, Argo CD, the forge). Both are nixidy environments: rendered
# YAML that `cargo x platform` commits to the deploy repo for Argo CD to sync.
{
  pkgs,
  nixidy,
  nix2container,
}:
let
  inherit (pkgs) lib;
  # What differs between clusters besides instance sizes: where images live.
  registry = "localhost:5000";
  # The rendered-manifests repo, in this cluster's forge. Secrets never go here.
  deployRepository = "http://gitea-http.forge.svc.cluster.local:3000/platform/deploy.git";

  platformLib = import ./lib.nix { inherit pkgs nix2container registry; };
  platformPkgs = import ./packages.nix { inherit pkgs; };
  instances = import ./instances.nix;

  render =
    {
      env,
      rootPath,
      modules,
    }:
    (nixidy.lib.mkEnvs {
      inherit pkgs;
      envs.${env}.modules = [
        {
          nixidy = {
            target = {
              repository = deployRepository;
              branch = "main";
              inherit rootPath;
            };
            # `platform down` deletes an Application; its resources go with it.
            defaults = {
              finalizer = "foreground";
              syncPolicy.autoSync = {
                enable = true;
                prune = true;
                selfHeal = true;
              };
            };
          };
        }
      ]
      ++ modules;
    }).${env}.environmentPackage;
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
        env = name;
        rootPath = "./instances/${name}";
        modules = [
          {
            applications.${namespace} = {
              inherit namespace;
              resources = lib.foldl' lib.recursiveUpdate {
                namespaces.${namespace}.metadata = {
                  inherit labels;
                  annotations."argocd.argoproj.io/sync-wave" = "-3";
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
          }
        ];
      };
    in
    {
      inherit manifests namespace components;
      images = lib.mapAttrs (_: w: w.image) components;
      # Pushes the named workloads' images, or every image.
      push =
        names:
        platformLib.pushImages (
          lib.mapAttrs (_: w: w.image) (if names == null then components else lib.getAttrs names components)
        );
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

  cluster = import ./cluster.nix {
    inherit
      pkgs
      lib
      platformLib
      render
      ;
  };
}
