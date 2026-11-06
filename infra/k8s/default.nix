# Direct-apply Kubernetes declarations. Image/workload builders reuse #9918.
{
  pkgs,
  nixidy,
  nix2container,
  packages,
  crane,
  fenix,
}:
let
  inherit (pkgs) lib;
in
rec {
  tools = pkgs.symlinkJoin {
    name = "macro-local-kubernetes-tools";
    paths = [
      pkgs.kind
      pkgs.kubectl
    ];
  };
  clusterConfig = import ./cluster.nix { inherit pkgs; };
  instance =
    {
      name,
      host ? "localhost",
      slot ? 0,
      registry ? "localhost:32550",
      envRevision ? "reference",
      devBinaries ? null,
      frontend ? null,
      enableGmail ? false,
      seeded ? true,
      expose ? true,
      size ? { },
      secrets ? "macro-env",
      ingress ? { },
    }:
    let
      namespace = "macro-kube-${name}";
      platformLib = import ./lib.nix { inherit pkgs nix2container registry; };
      platformPkgs = import ./packages.nix {
        inherit
          pkgs
          packages
          platformLib
          nix2container
          crane
          fenix
          ;
      };
      settings = {
        size = lib.recursiveUpdate {
          resources.default = { };
          storage.default = "10Gi";
          replicas = { };
        } size;
        inherit
          name
          namespace
          host
          slot
          registry
          envRevision
          enableGmail
          devBinaries
          seeded
          expose
          secrets
          ingress
          ;
      };
      components = import ./components.nix {
        inherit
          pkgs
          lib
          platformLib
          platformPkgs
          packages
          ;
        instance = settings;
        frontend = if frontend == null then platformPkgs.frontend else frontend;
      };
      workloadResources = lib.foldl' lib.recursiveUpdate { } (
        lib.mapAttrsToList (
          n: w:
          platformLib.workloadResources {
            instance = settings;
            name = n;
            inherit w;
          }
        ) components
      );
      resources = lib.recursiveUpdate workloadResources {
        roles.bootstrap-reader = {
          metadata.labels."macro.local/managed" = "true";
          rules = [
            {
              apiGroups = [ "batch" ];
              resources = [ "jobs" ];
              verbs = [
                "get"
                "list"
                "watch"
              ];
            }
          ];
        };
        roleBindings.bootstrap-reader = {
          metadata.labels."macro.local/managed" = "true";
          roleRef = {
            apiGroup = "rbac.authorization.k8s.io";
            kind = "Role";
            name = "bootstrap-reader";
          };
          subjects = [
            {
              kind = "ServiceAccount";
              name = "default";
              inherit namespace;
            }
          ];
        };
        services.proxy.spec =
          ingress.service or (lib.optionalAttrs expose {
            type = "NodePort";
            ports = [
              {
                name = "p8443";
                port = 8443;
                targetPort = 8443;
                nodePort = 30443 + slot;
                protocol = "TCP";
              }
            ];
          });
      };
      env = nixidy.lib.mkEnv {
        inherit pkgs;
        modules = [
          {
            nixidy.k8sVersion = "1.35";
            applications.${namespace} = {
              inherit namespace resources;
              output.path = namespace;
            };
          }
        ];
      };
      # Consume nixidy's typed layout and renderer directly. No delivery repository
      # or Application resources are evaluated or emitted.
      renderer = import "${nixidy}/modules/build/render.nix" { inherit lib pkgs; };
      files = env.config.build.layout.${namespace};
      manifests = pkgs.runCommand "macro-kubernetes-${name}" { } ''
        mkdir -p $out
        ${lib.concatMapStringsSep "\n" (renderer.renderFile namespace) files}
      '';
      # Persistent data is declared and applied, but never belongs to the pruned
      # workload set: removing a service must not delete its retained volume.
      claims = pkgs.runCommand "macro-kubernetes-${name}-claims" { } ''
        mkdir -p $out
        for file in ${manifests}/PersistentVolumeClaim-*.yaml; do
          ln -s "$file" "$out/$(basename "$file")"
        done
      '';
      workloads = pkgs.runCommand "macro-kubernetes-${name}-workloads" { } ''
        mkdir -p $out
        for file in ${manifests}/*.yaml; do
          case "$(basename "$file")" in PersistentVolumeClaim-*) continue;; esac
          ln -s "$file" "$out/$(basename "$file")"
        done
      '';
      images = (lib.mapAttrs (_: w: w.image) components) // platformPkgs.utilityImages;
      push = names: platformLib.pushImages (if names == null then images else lib.getAttrs names images);
      bundle = pkgs.linkFarm "macro-instance-${name}" [
        {
          name = "claims";
          path = claims;
        }
        {
          name = "workloads";
          path = workloads;
        }
        {
          name = "manifests";
          path = manifests;
        }
        {
          name = "push";
          path = push null;
        }
      ];
    in
    {
      inherit
        namespace
        components
        resources
        manifests
        images
        push
        bundle
        ;
      builds = platformPkgs;
    };
}
