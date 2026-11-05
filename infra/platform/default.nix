# Entry point for infra/platform. `instance` renders one Macro instance (one
# namespace, one Argo CD Application); `cluster` renders what each cluster runs
# once (ingress, Argo CD, the forge). Both are nixidy environments: rendered
# YAML that `cargo x platform` commits to the deploy repo for Argo CD to sync.
{
  pkgs,
  nixidy,
  nix2container,
  terranix,
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
rec {
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
      # The Helm chart for self-hosters, generated from this instance's manifests.
      # Render it from the instance named `selfhost`.
      chart =
        { version ? "0.0.0-dev", chartRegistry ? "${registry}/macro" }:
        pkgs.runCommand "macro-chart-${version}"
          {
            nativeBuildInputs = [
              pkgs.yq-go
              pkgs.jq
              pkgs.python3
            ];
            size = builtins.toJSON size;
            passAsFile = [ "size" ];
          }
          ''
            for f in ${manifests}/${namespace}/*.yaml; do
              yq -o=json "$f"
            done | jq -s '{ items: . }' > items.json
            python3 ${./selfhost/generate_chart.py} items.json "$sizePath" "$out" \
              ${version} ${chartRegistry}
          '';
      # Pushes the named workloads' images, or every image.
      push =
        names:
        platformLib.pushImages (
          lib.mapAttrs (_: w: w.image) (if names == null then components else lib.getAttrs names components)
        );
    };

  # Fails if the local and prod sizes render anything different but size. Stub
  # artifacts keep it free of builds: rendering needs image references, not images.
  parity =
    let
      stub = pkgs.emptyDirectory;
      binaryNames = map builtins.head (
        lib.filter builtins.isList (
          builtins.split "bin = \"([a-z_]+)\"" (builtins.readFile ./components.nix)
        )
      );
      render =
        size:
        (instance {
          name = "parity";
          host = "parity.example.com";
          inherit size;
          frontend = stub;
          binaries = lib.genAttrs (binaryNames ++ [
            "kms_gateway"
            "queue_gateway"
            "xtask_local"
          ]) (_: stub);
          node = lib.genAttrs [
            "lexical"
            "websocket"
            "sync-bundle"
            "analytics-bundle"
            "ai-editing-bundle"
            "opensearch-helpers"
          ] (_: stub);
        }).manifests;
    in
    pkgs.runCommand "platform-parity"
      {
        nativeBuildInputs = [
          pkgs.yq-go
          pkgs.python3
        ];
      }
      ''
        mkdir local prod
        for f in ${render instances.sizes.local}/macro-parity/*.yaml; do
          yq -o=json "$f" > "local/$(basename "$f" .yaml).json"
        done
        for f in ${render instances.sizes.prod}/macro-parity/*.yaml; do
          yq -o=json "$f" > "prod/$(basename "$f" .yaml).json"
        done
        python3 ${./parity/check_parity.py} local prod | tee $out
      '';

  # What sits outside the cluster on AWS, rendered for OpenTofu. Nothing here applies
  # anything: `awsCheck` validates offline, with no credentials.
  aws =
    settings:
    terranix.lib.terranixConfiguration {
      system = pkgs.stdenv.hostPlatform.system;
      modules = [
        ./aws/terraform.nix
        { macro = settings; }
      ];
    };

  awsCheck =
    let
      config = aws {
        cluster = "macro-check";
        domain = "example.com";
        zoneId = "Z0000000000000";
      };
      tofu = pkgs.opentofu.withPlugins (providers: [
        providers.hashicorp_aws
        providers.hashicorp_random
      ]);
    in
    pkgs.runCommand "platform-aws-check" { nativeBuildInputs = [ tofu ]; } ''
      cp ${config} config.tf.json
      export HOME=$TMPDIR
      tofu init -backend=false -input=false > /dev/null
      tofu validate -no-color | tee $out
    '';

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
