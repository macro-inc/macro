# Building blocks for the local Kubernetes platform: OCI images built from store paths and the
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
  # Make the addressing scheme explicit while retaining the immutable store hash.
  imageReference =
    drv:
    let
      imageTag = "build.${drv.imageTag}";
    in
    drv
    // {
      inherit imageTag;
      ref = builtins.unsafeDiscardStringContext "${drv.imageName}:${imageTag}";
    };
  jobName =
    instance: name: w:
    "${name}-${
      builtins.substring 0 10 (
        builtins.hashString "sha256" (
          builtins.toJSON {
            image = builtins.unsafeDiscardStringContext w.image.ref;
            workload = builtins.removeAttrs w [ "image" ];
            inherit (instance) envRevision secrets size;
            builder = builtins.hashFile "sha256" ./lib.nix;
          }
        )
      )
    }";
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
      extraRoot ? [ ],
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
        ]
        ++ extraRoot;
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
    imageReference drv;

  # Pushes `images` (name -> image) to the registry, skipping any it already
  # holds. Skopeo itself skips layers the registry has, so a rebuilt service
  # costs one layer upload.
  pushImages =
    images:
    let
      skopeoArgs = "--dest-tls-verify=false --retry-times=3";
      lines = lib.concatMapStringsSep "\n" (i: "${i.imageName} ${i.imageTag} ${i.copyTo}/bin/copy-to") (
        lib.attrValues images
      );
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
        app = name;
        "macro.local/managed" = "true";
        "app.kubernetes.io/name" = name;
        "app.kubernetes.io/part-of" = "macro";
        "macro.com/instance" = instance.name;
        "macro.com/tier" = if w.infra or false then "infra" else "app";
      };
      selector = {
        app = name;
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
                periodSeconds = w.readiness.period or 1;
                timeoutSeconds = 10;
                failureThreshold = 3;
              };
          }
        else
          { };
      resources = instance.size.resources.${name} or instance.size.resources.default;
      serviceNames = [ name ] ++ (w.aliases or [ ]);
      metadata = {
        inherit labels;

      };
      isJob = w.job or false;
      # Job specs are immutable and must re-run for a new build or env.
      podSpec = {
        enableServiceLinks = false;
        initContainers = w.initContainers or { };
        terminationGracePeriodSeconds = w.terminationGracePeriod or 2;
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
        imagePullPolicy = "IfNotPresent";
        args = w.args or [ ];
        # A value is a string, `{ fieldRef = "status.podIP"; }`, or
        # `{ secret = "KEY"; }` (a key of the instance's macro-env).
        command = w.command or [ ];
        env = lib.mapAttrsToList (
          k: v:
          if builtins.isAttrs v && v ? secret then
            {
              name = k;
              valueFrom.secretKeyRef = {
                name = instance.secrets;
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
        envFrom = lib.optional (w.sharedEnv or false) { secretRef.name = instance.secrets; };
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
        ++ (w.mounts or [ ])
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
      // probe
      // lib.optionalAttrs (w ? lifecycle) { inherit (w) lifecycle; };
      podVolumes = [
        {
          name = "tmp";
          emptyDir = { };
        }
      ]
      ++ (w.podVolumes or [ ])
      ++ lib.mapAttrsToList (v: _: {
        name = "vol-${v}";
        persistentVolumeClaim.claimName = w.claims.${v} or "${name}-${v}";
      }) volumes
      ++ lib.mapAttrsToList (
        f: spec:
        {
          name = "file-${f}";
        }
        // (
          if spec ? secret then { secret.secretName = spec.secret; } else { configMap.name = spec.configMap; }
        )
      ) files;
    in
    lib.optionalAttrs isJob {
      jobs.${jobName instance name w} = {
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
          replicas = instance.size.replicas.${name} or 1;
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
          revisionHistoryLimit = 0;
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
        name = w.claims.${v} or "${name}-${v}";
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
            publishNotReadyAddresses = w.publishNotReady or false;
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
