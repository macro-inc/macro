# What a cluster runs once, shared by its instances: the ingress, Argo CD, and
# the forge that holds source mirrors, the deploy repo, and CI.
{
  pkgs,
  lib,
  platformLib,
  render,
}:
let
  traefikPort = 8443;
  forgeHost = "git.localhost";
  argocdHost = "argocd.localhost";

  traefikImage = platformLib.image {
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
      # Argo CD reports an Ingress as progressing until its status has an address.
      "--providers.kubernetesingress.ingressendpoint.ip=127.0.0.1"
      "--log.level=WARN"
    ];
  };

  # Jobs must reach the forge at the address in its ROOT_URL, which on a dev
  # cluster resolves to loopback. Job containers get a hosts file mapping the name
  # to this Service instead; `--add-host` conflicts with the shared network Docker
  # actions use. Hosted clusters have real DNS and do not need it.
  ingressClusterIP = "10.43.9.43";

  runnerImage = platformLib.image {
    name = "forge-runner";
    contents = [ pkgs.gitea-actions-runner ];
    env.HOME = "/data";
    entrypoint = [
      "/bin/sh"
      "-c"
      ''
        set -e
        cd /data
        # Registers once; the token only matters until `.runner` exists.
        [ -f .runner ] || gitea-runner register --no-interactive \
          --instance http://gitea-http:3000 --token "$REGISTRATION_TOKEN" \
          --name "$POD_NAME" --labels ${runnerLabel}
        until [ -S /var/run/docker.sock ]; do sleep 1; done
        exec gitea-runner daemon --config ${runnerConfig}
      ''
    ];
  };

  # Each job gets a clean Ubuntu container like a hosted runner. A runner runs
  # one job at a time because the job's Nix daemon owns the shared /nix volume;
  # scale with `replicas`, each with its own Docker data and Nix store.
  runnerLabel = "linux-ci:docker://catthehacker/ubuntu:act-24.04";
  runnerConfig = pkgs.writeText "act-runner.yaml" (
    builtins.toJSON {
      log.level = "info";
      runner = {
        file = "/data/.runner";
        capacity = 1;
        timeout = "6h";
        envs = {
          GIT_SSL_CAINFO = "/macro-ca/ca.pem";
          NODE_EXTRA_CA_CERTS = "/macro-ca/ca.pem";
          SSL_CERT_FILE = "/macro-ca/ca-bundle.pem";
        };
        labels = [ runnerLabel ];
      };
      cache.enabled = true;
      container = {
        options = "-v /macro-hosts/hosts:/etc/hosts:ro -v /macro-ca:/macro-ca:ro -v nix:/nix";
        valid_volumes = [
          "nix"
          "/macro-ca"
          "/macro-hosts/hosts"
        ];
        force_pull = false;
      };
    }
  );

  # An ingress to one Service on the shared HTTPS port. `secretName` holds a
  # certificate naming only this host (`platform cluster` issues it): the
  # ingress picks certificates by SNI.
  ingress =
    {
      host,
      service,
      port,
      secretName,
    }:
    {
      spec = {
        ingressClassName = "traefik";
        tls = [
          {
            hosts = [ host ];
            inherit secretName;
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
                  name = service;
                  port.number = port;
                };
              }
            ];
          }
        ];
      };
    };

  traefik = {
    namespace = "platform-ingress";
    createNamespace = true;
    resources = {
      ingressClasses.traefik.spec.controller = "traefik.io/ingress-controller";
      serviceAccounts.traefik = { };
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
      services.traefik.spec = {
        clusterIP = ingressClusterIP;
        selector.app = "traefik";
        ports = [
          {
            name = "websecure";
            port = 9443;
            targetPort = traefikPort;
            protocol = "TCP";
          }
        ];
      };
      deployments.traefik.spec = {
        # One pod owns the host port; a rolling update would deadlock on it.
        strategy.type = "Recreate";
        selector.matchLabels.app = "traefik";
        template = {
          metadata.labels.app = "traefik";
          spec = {
            serviceAccountName = "traefik";
            containers.traefik = {
              image = traefikImage.ref;
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

  forgeRunners = {
    namespace = "forge";
    resources.configMaps.forge-job-hosts.data.hosts = ''
      127.0.0.1 localhost
      ::1 localhost
      ${ingressClusterIP} ${forgeHost}
    '';
    resources.statefulSets.forge-runner.spec = {
      serviceName = "forge-runner";
      replicas = 2;
      selector.matchLabels.app = "forge-runner";
      volumeClaimTemplates = [
        {
          metadata.name = "data";
          spec = {
            accessModes = [ "ReadWriteOnce" ];
            resources.requests.storage = "100Gi";
          };
        }
      ];
      template = {
        metadata.labels.app = "forge-runner";
        spec = {
          containers = {
            runner = {
              image = runnerImage.ref;
              env = [
                {
                  name = "POD_NAME";
                  valueFrom.fieldRef.fieldPath = "metadata.name";
                }
                {
                  name = "REGISTRATION_TOKEN";
                  valueFrom.secretKeyRef = {
                    name = "forge-runner-token";
                    key = "token";
                  };
                }
                {
                  name = "DOCKER_HOST";
                  value = "unix:///var/run/docker.sock";
                }
              ];
              volumeMounts = [
                {
                  name = "data";
                  mountPath = "/data";
                  subPath = "runner";
                }
                {
                  name = "docker-socket";
                  mountPath = "/var/run";
                }
                # The runner copies actions through temp files; images have no /tmp.
                {
                  name = "tmp";
                  mountPath = "/tmp";
                }
              ];
            };
            # The runner starts each job as a container in this daemon. It is
            # the one privileged workload, confined to this namespace's runners.
            docker = {
              image = "docker:29-dind";
              args = [
                "--host=unix:///var/run/docker.sock"
                "--group=0"
                # Inside the overlay, whose MTU is below Docker's default of 1500.
                # With the default, small requests work and large downloads hang.
                "--mtu=1400"
                "--default-network-opt=bridge=com.docker.network.driver.mtu=1400"
              ];
              env = [
                {
                  name = "DOCKER_TLS_CERTDIR";
                  value = "";
                }
              ];
              securityContext.privileged = true;
              volumeMounts = [
                {
                  name = "data";
                  mountPath = "/var/lib/docker";
                  subPath = "docker";
                }
                {
                  name = "docker-socket";
                  mountPath = "/var/run";
                }
                {
                  name = "macro-ca";
                  mountPath = "/macro-ca";
                  readOnly = true;
                }
                {
                  name = "job-hosts";
                  mountPath = "/macro-hosts";
                  readOnly = true;
                }
              ];
            };
          };
          volumes = [
            {
              name = "tmp";
              emptyDir = { };
            }
            {
              name = "docker-socket";
              emptyDir = { };
            }
            {
              name = "macro-ca";
              secret.secretName = "forge-ca";
            }
            {
              name = "job-hosts";
              configMap.name = "forge-job-hosts";
            }
          ];
        };
      };
    };
  };
in
{
  images = {
    traefik = traefikImage;
  };
  push = platformLib.pushImages {
    traefik = traefikImage;
    forge-runner = runnerImage;
  };

  manifests = render {
    env = "cluster";
    rootPath = "./cluster";
    modules = [
      (
        { lib, ... }:
        {
          applications = {
            inherit traefik;
            forge-runners = forgeRunners;

            argocd = {
              namespace = "argocd";
              createNamespace = true;
              # Its CRDs exceed the client-side apply annotation limit.
              syncPolicy.syncOptions.serverSideApply = true;
              helm.releases.argocd = {
                chart = lib.helm.downloadHelmChart {
                  repo = "https://argoproj.github.io/argo-helm/";
                  chart = "argo-cd";
                  version = "10.12.1";
                  chartHash = "sha256-pqvJICzJbjpoZXianfYLmLu9PP5E57jlm+MMdufQYpg=";
                };
                values = {
                  global.domain = argocdHost;
                  # Traefik terminates TLS.
                  configs.params."server.insecure" = true;
                  # Sign-in is the generated admin account; no SSO on a dev cluster.
                  dex.enabled = false;
                  notifications.enabled = false;
                };
              };
              resources.ingresses.argocd = ingress {
                host = argocdHost;
                service = "argocd-server";
                port = 80;
                secretName = "argocd-tls";
              };
            };

            forge = {
              namespace = "forge";
              createNamespace = true;
              helm.releases.gitea = {
                # The chart's `helm test` Pod is not part of the running forge.
                transformer = builtins.filter (o: o.kind != "Pod");
                chart = lib.helm.downloadHelmChart {
                  repo = "https://dl.gitea.com/charts/";
                  chart = "gitea";
                  version = "12.7.0";
                  chartHash = "sha256-DoYl6QV7lw5v8JgnktKIdg+Q2muFsVlWoCErroEIw5k=";
                };
                values = {
                  # SQLite and in-process cache: one replica, no extra services.
                  # Hosted clusters point `database` at managed Postgres.
                  postgresql.enabled = false;
                  postgresql-ha.enabled = false;
                  valkey.enabled = false;
                  valkey-cluster.enabled = false;
                  replicaCount = 1;
                  strategy.type = "Recreate";
                  persistence = {
                    enabled = true;
                    size = "50Gi";
                  };
                  gitea = {
                    # `platform cluster` generates this Secret.
                    admin = {
                      existingSecret = "forge-admin";
                      passwordMode = "keepUpdated";
                    };
                    config = {
                      server = {
                        DOMAIN = forgeHost;
                        ROOT_URL = "https://${forgeHost}:9443/";
                        SSH_DOMAIN = forgeHost;
                      };
                      database.DB_TYPE = "sqlite3";
                      session.PROVIDER = "db";
                      cache.ADAPTER = "memory";
                      queue.TYPE = "level";
                      indexer.ISSUE_INDEXER_TYPE = "bleve";
                      service.DISABLE_REGISTRATION = true;
                      actions = {
                        ENABLED = true;
                        DEFAULT_ACTIONS_URL = "github";
                        # The default also reads .github/workflows, including on
                        # commits without a .gitea/workflows directory. That would
                        # queue deploy workflows for every push of main.
                        WORKFLOW_DIRS = ".gitea/workflows";
                      };
                    };
                  };
                };
              };
              resources.ingresses.forge = ingress {
                host = forgeHost;
                service = "gitea-http";
                port = 3000;
                secretName = "forge-tls";
              };
            };
          };
        }
      )
    ];
  };
}
