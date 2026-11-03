# Building blocks for infra/platform: store-path container images and the
# translation from a workload description to Kubernetes resources.
{ pkgs, nix-snapshotter }:
let
  inherit (pkgs) lib;
  inherit ((pkgs.extend nix-snapshotter.overlays.default).nix-snapshotter) buildImage;

  # Postgres and the JVMs refuse to run as a uid without a passwd entry, but an
  # image cannot ship /etc/passwd: the root is store-path symlinks, and
  # containerd refuses to follow them when it resolves the user ("path escapes
  # from parent"). nss_wrapper supplies the entry at runtime instead, for
  # whatever uid the pod runs as.
  withAccount =
    name: entrypoint:
    [
      "${pkgs.writeShellScript "${name}-entrypoint" ''
        printf 'app:x:%s:%s::/tmp:/bin/sh\n' "$(id -u)" "$(id -g)" > /tmp/passwd
        printf 'app:x:%s:\n' "$(id -g)" > /tmp/group
        export NSS_WRAPPER_PASSWD=/tmp/passwd NSS_WRAPPER_GROUP=/tmp/group
        export LD_PRELOAD=${pkgs.nss_wrapper}/lib/libnss_wrapper.so
        exec "$@"
      ''}"
    ]
    ++ entrypoint;
in
rec {
  # A container image whose layers are store paths. The node's nix
  # snapshotter bind-mounts them from its own /nix/store (fetching from the
  # binary cache when absent), so an image is a few hundred bytes and needs no
  # registry. `ref` is what a pod spec names.
  image =
    {
      name,
      entrypoint,
      env ? { },
      workingDir ? null,
      contents ? [ ],
    }:
    let
      drv = buildImage {
        inherit name;
        resolvedByNix = true;
        copyToRoot = pkgs.buildEnv {
          name = "${name}-root";
          paths = [
            pkgs.busybox
            pkgs.cacert
          ] ++ contents;
          pathsToLink = [ "/bin" "/etc" "/share" ];
        };
        config = {
          entrypoint = withAccount name entrypoint;
          Env = lib.mapAttrsToList (k: v: "${k}=${v}") (
            {
              PATH = "/bin";
              SSL_CERT_FILE = "/etc/ssl/certs/ca-bundle.crt";
            }
            // env
          );
        } // lib.optionalAttrs (workingDir != null) { WorkingDir = workingDir; };
      };
    in
    drv // { ref = "nix:0${drv}"; };

  # Turn a binary built outside Nix (Cargo in the dev shell, for the fast
  # loop) into a store path with a complete closure. Cargo's output finds
  # OpenSSL only through the dev shell's LD_LIBRARY_PATH, so pin the loader
  # and library path to this nixpkgs' glibc, OpenSSL, and libgcc_s (the only
  # libraries the services link); Nix then records them as references.
  wrapBinary =
    {
      name,
      binary,
    }:
    pkgs.runCommand name { nativeBuildInputs = [ pkgs.patchelf ]; } ''
      install -Dm755 ${binary} $out/bin/${name}
      patchelf --set-interpreter ${pkgs.glibc}/lib/ld-linux-x86-64.so.2 \
        --set-rpath ${lib.makeLibraryPath [ pkgs.openssl pkgs.stdenv.cc.cc.lib ]} \
        $out/bin/${name}
    '';

  # Workload description -> Kubernetes resources (kubenix `kubernetes.resources`
  # shape). Mirrors what compose expressed: one Deployment (Recreate, one
  # replica unless the size says otherwise), a Service named after the
  # workload plus one per alias, readiness from a command or HTTP path, PVCs
  # for volumes, and files mounted from ConfigMaps or Secrets.
  workloadResources =
    {
      instance,
      name,
      w,
    }:
    let
      labels = {
        "app.kubernetes.io/name" = name;
        "app.kubernetes.io/part-of" = "macro";
        "macro.com/instance" = instance.name;
        "macro.com/tier" = if w.infra or false then "infra" else "app";
      };
      selector = {
        "app.kubernetes.io/name" = name;
        "macro.com/instance" = instance.name;
      };
      ports = w.ports or [ ];
      volumes = w.volumes or { };
      files = w.files or { };
      probe =
        if w ? readiness then
          {
            readinessProbe =
              (
                if w.readiness ? http then
                  {
                    httpGet = {
                      path = w.readiness.http;
                      port = w.readiness.port or (builtins.head ports);
                    };
                  }
                else if w.readiness ? tcp then
                  { tcpSocket.port = w.readiness.tcp; }
                else
                  { exec.command = w.readiness.exec; }
              )
              // {
                periodSeconds = w.readiness.period or 5;
                timeoutSeconds = 10;
                failureThreshold = 3;
              };
          }
        else
          { };
      resources = instance.size.resources.${name} or instance.size.resources.default;
      serviceNames = [ name ] ++ (w.aliases or [ ]);
    in
    {
      deployments.${name} = {
        metadata = { inherit labels; };
        spec = {
          replicas = instance.size.replicas.${name} or 1;
          strategy.type = "Recreate";
          progressDeadlineSeconds = 1800;
          selector.matchLabels = selector;
          template = {
            metadata = {
              inherit labels;
              annotations."macro.com/env-revision" = instance.envRevision;
            };
            spec = {
              enableServiceLinks = false;
              securityContext = lib.optionalAttrs (w ? user) {
                runAsUser = w.user;
                runAsGroup = w.user;
                fsGroup = w.user;
              };
              terminationGracePeriodSeconds = w.terminationGracePeriod or 30;
              containers.${name} = {
                image = w.image.ref;
                args = w.args or [ ];
                # A value is a string, `{ fieldRef = "status.podIP"; }`, or
                # `{ secret = "KEY"; }` (a key of the instance's macro-env).
                env = lib.mapAttrsToList (
                  k: v:
                  if builtins.isAttrs v && v ? secret then
                    {
                      name = k;
                      valueFrom.secretKeyRef = {
                        name = "macro-env";
                        key = v.secret;
                      };
                    }
                  else if builtins.isAttrs v then
                    {
                      name = k;
                      valueFrom.fieldRef.fieldPath = v.fieldRef;
                    }
                  else
                    {
                      name = k;
                      value = toString v;
                    }
                ) (w.env or { });
                envFrom = lib.optional (w.sharedEnv or false) { secretRef.name = "macro-env"; };
                ports = map (p: {
                  containerPort = p;
                  protocol = "TCP";
                }) ports;
                inherit resources;
                # A store-path root is read-only and has no /tmp.
                volumeMounts = [
                  {
                    name = "tmp";
                    mountPath = "/tmp";
                  }
                ]
                ++ lib.mapAttrsToList (v: mountPath: {
                    name = "vol-${v}";
                    inherit mountPath;
                  }) volumes
                  ++ lib.mapAttrsToList (f: spec: {
                    name = "file-${f}";
                    mountPath = spec.mountPath;
                    readOnly = true;
                  } // lib.optionalAttrs (spec ? subPath) { inherit (spec) subPath; }) files;
              } // probe;
              volumes = [
                {
                  name = "tmp";
                  emptyDir = { };
                }
              ]
              ++ lib.mapAttrsToList (v: _: {
                  name = "vol-${v}";
                  persistentVolumeClaim.claimName = "${name}-${v}";
                }) volumes
                ++ lib.mapAttrsToList (
                  f: spec:
                  {
                    name = "file-${f}";
                  }
                  // (
                    if spec ? secret then
                      { secret.secretName = spec.secret; }
                    else
                      { configMap.name = spec.configMap; }
                  )
                ) files;
            };
          };
        };
      };
      persistentVolumeClaims = lib.mapAttrs' (v: _: {
        name = "${name}-${v}";
        value = {
          metadata = { inherit labels; };
          spec = {
            accessModes = [ "ReadWriteOnce" ];
            resources.requests.storage = instance.size.storage.${name} or instance.size.storage.default;
          };
        };
      }) volumes;
      services = lib.optionalAttrs (ports != [ ]) (
        lib.genAttrs serviceNames (_: {
          metadata = { inherit labels; };
          spec = {
            inherit selector;
            # Compose DNS resolves a container before it is healthy; Kafka's
            # controller and similar dial themselves during startup.
            publishNotReadyAddresses = true;
            ports = map (p: {
              name = "p${toString p}";
              port = p;
              targetPort = p;
              protocol = "TCP";
            }) ports;
          };
        })
      );
    };
}
