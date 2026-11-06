# Building blocks for infra/platform: OCI images built from store paths and the
# translation from a workload description to Kubernetes resources.
{
  pkgs,
  nix2container,
  registry,
}:
let
  inherit (pkgs) lib;
  n2c = nix2container.packages.${pkgs.stdenv.hostPlatform.system}.nix2container;

  # Postgres and the JVMs refuse to run as a uid without a passwd entry. Every
  # workload that sets a user runs as 1000 (`workloadResources`).
  accounts = pkgs.runCommand "image-accounts" { } ''
    mkdir -p $out/etc
    cat > $out/etc/passwd <<EOF
    root:x:0:0::/root:/bin/sh
    app:x:1000:1000::/tmp:/bin/sh
    nobody:x:65534:65534::/nonexistent:/bin/sh
    EOF
    cat > $out/etc/group <<EOF
    root:x:0:
    app:x:1000:
    nogroup:x:65534:
    EOF
  '';
in
rec {
  # An OCI image in the platform registry. Each store path in its closure is
  # its own layer, up to `maxLayers`, so images share the layers they have in
  # common and a rebuilt service pushes only what changed. `ref` is what a pod
  # spec names: its tag is the image's store hash, known at eval time.
  image =
    {
      name,
      entrypoint,
      env ? { },
      workingDir ? null,
      contents ? [ ],
    }:
    let
      drv = n2c.buildImage {
        name = "${registry}/macro/${name}";
        maxLayers = 40;
        copyToRoot = [
          accounts
          (pkgs.buildEnv {
            name = "${name}-root";
            paths = [
              pkgs.busybox
              pkgs.cacert
            ]
            ++ contents;
            pathsToLink = [
              "/bin"
              "/etc/ssl"
              "/share"
            ];
          })
        ];
        config = {
          # PID 1 ignores signals it has no handler for; without an init the
          # kubelet waits out the whole grace period on every rollout.
          entrypoint = [
            "${pkgs.dumb-init}/bin/dumb-init"
            "--"
          ]
          ++ entrypoint;
          Env = lib.mapAttrsToList (k: v: "${k}=${v}") (
            {
              PATH = "/bin";
              SSL_CERT_FILE = "/etc/ssl/certs/ca-bundle.crt";
            }
            // env
          );
        }
        // lib.optionalAttrs (workingDir != null) { WorkingDir = workingDir; };
      };
    in
    drv // { ref = drv.imageRefUnsafe; };

  # Pushes `images` (name -> image) to the registry, skipping any it already
  # holds. Skopeo itself skips layers the registry has, so a rebuilt service
  # costs one layer upload.
  pushImages =
    images:
    let
      skopeoArgs = "--dest-tls-verify=false --retry-times=3";
      lines = lib.concatMapStringsSep "\n" (
        i: "${i.imageName} ${i.imageTag} ${i.copyTo}/bin/copy-to"
      ) (lib.attrValues images);
    in
    pkgs.writeShellScriptBin "push-images" ''
      printf '${lines}\n' | sort -u | ${pkgs.findutils}/bin/xargs -P 8 -L 1 sh -c '
        repo="''${0#*/}"
        manifest="http://''${0%%/*}/v2/$repo/manifests/$1"
        accept="application/vnd.oci.image.manifest.v1+json"
        ${pkgs.curl}/bin/curl -fsS -o /dev/null -I -H "Accept: $accept" "$manifest" 2>/dev/null \
          || exec "$2" "docker://$0:$1" ${skopeoArgs}
      '
    '';

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
    pkgs.runCommand name { nativeBuildInputs = [ pkgs.patchelf pkgs.binutils ]; } ''
      install -Dm755 ${binary} $out/bin/${name}
      # Debug info is most of a debug build's size. Panics and traces keep
      # their symbol names; only line numbers go.
      strip --strip-debug $out/bin/${name}
      patchelf --set-interpreter ${pkgs.glibc}/lib/ld-linux-x86-64.so.2 \
        --set-rpath ${lib.makeLibraryPath [ pkgs.openssl pkgs.stdenv.cc.cc.lib ]} \
        $out/bin/${name}
    '';

  # Workload description -> Kubernetes resources (nixidy `resources` shape). Mirrors what compose expressed: one Deployment (Recreate, one
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
                periodSeconds = w.readiness.period or 2;
                timeoutSeconds = 10;
                failureThreshold = 3;
              };
          }
        else
          { };
      resources = instance.size.resources.${name} or instance.size.resources.default;
      serviceNames = [ name ] ++ (w.aliases or [ ]);
      # Argo CD applies a wave and waits for it to be healthy before the next:
      # data plane, then provisioning, then everything that depends on them.
      wave = toString (w.wave or (if w.infra or false then -2 else 0));
      metadata = {
        inherit labels;
        annotations."argocd.argoproj.io/sync-wave" = wave;
      };
      isJob = w.job or false;
      # Job specs are immutable and must re-run for a new build or env.
      jobName = "${name}-${
        builtins.substring 0 10 (
          builtins.hashString "sha256" "${builtins.unsafeDiscardStringContext w.image.ref}${instance.envRevision}"
        )
      }";
      podSpec = {
        enableServiceLinks = false;
        terminationGracePeriodSeconds = w.terminationGracePeriod or 30;
        securityContext = lib.optionalAttrs (w ? user) {
          runAsUser = w.user;
          runAsGroup = w.user;
          fsGroup = w.user;
          # Otherwise every mount recursively re-permissions the volume,
          # and Postgres refuses a group-writable data directory.
          fsGroupChangePolicy = "OnRootMismatch";
        };
        containers.${name} = container;
        volumes = podVolumes;
      };
      container = {
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
        # Scratch space that survives container restarts within a pod.
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
        ++ lib.mapAttrsToList (
          f: spec:
          {
            name = "file-${f}";
            mountPath = spec.mountPath;
            readOnly = true;
          }
          // lib.optionalAttrs (spec ? subPath) { inherit (spec) subPath; }
        ) files;
      }
      // probe;
      podVolumes = [
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
        // (if spec ? secret then { secret.secretName = spec.secret; } else { configMap.name = spec.configMap; })
      ) files;
    in
    lib.optionalAttrs isJob {
      jobs.${jobName} = {
        metadata = metadata // {
          labels = labels // {
            "macro.com/job" = name;
          };
        };
        spec = {
          backoffLimit = 10;
          template = {
            metadata.labels = labels // {
              "macro.com/job" = name;
            };
            spec = podSpec // {
              restartPolicy = "OnFailure";
            };
          };
        };
      };
    }
    // lib.optionalAttrs (!isJob) {
      deployments.${name} = {
        inherit metadata;
        spec = {
          # KEDA owns a scaled workload's count; a replica count here would have
          # Argo CD's self-heal fight it.
          ${if (w.scaleOnQueue or null) != null then null else "replicas"} =
            instance.size.replicas.${name} or 1;
          # Single-writer volumes must never see two pods; everything else
          # rolls without downtime, the new pod ready before the old one stops.
          strategy =
            if volumes != { } || (w.singleton or false) then
              { type = "Recreate"; }
            else
              {
                type = "RollingUpdate";
                rollingUpdate = {
                  maxSurge = 1;
                  maxUnavailable = 0;
                };
              };
          progressDeadlineSeconds = 1800;
          selector.matchLabels = selector;
          template = {
            metadata = {
              inherit labels;
              # Only workloads that load the shared env roll when it changes;
              # the data plane stays up.
              annotations = lib.optionalAttrs (w.sharedEnv or false) {
                "macro.com/env-revision" = instance.envRevision;
              };
            };
            spec = podSpec;
          };
        };
      };
      persistentVolumeClaims = lib.mapAttrs' (v: _: {
        name = "${name}-${v}";
        value = {
          inherit metadata;
          spec = {
            accessModes = [ "ReadWriteOnce" ];
            resources.requests.storage = instance.size.storage.${name} or instance.size.storage.default;
          };
        };
      }) volumes;
      services = lib.optionalAttrs (ports != [ ]) (
        lib.genAttrs serviceNames (_: {
          inherit metadata;
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
