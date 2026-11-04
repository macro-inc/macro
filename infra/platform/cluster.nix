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
in
{
  images = {
    traefik = traefikImage;
  };
  push = platformLib.pushImages { traefik = traefikImage; };

  manifests = render {
    env = "cluster";
    rootPath = "./cluster";
    modules = [
      (
        { lib, ... }:
        {
          applications = {
            inherit traefik;

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
