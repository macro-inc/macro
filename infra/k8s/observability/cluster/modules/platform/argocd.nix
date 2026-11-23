# Argo CD, managing itself: this application syncs manifests/prod/argocd, the
# `apps` application (nixidy's app of apps) syncs every Application under
# manifests/prod/apps. Bootstrapped once by scripts/bootstrap.sh.
#
# The UI and API are at `macro.argocd.hostname` through the edge (README
# "Argo CD"). Sign-in is Google only, through Argo CD's Dex, for accounts in
# `macro.argocd.googleDomain`, and every account is read-only: changes ship by
# merging to main, and cluster admins have kubectl (`argocd --core`).
{
  charts,
  config,
  lib,
  ...
}:
let
  inherit (config.nixidy.target) repository;
  cfg = config.macro.argocd;
  cluster = config.macro.cluster;
  # Grafana's Google OAuth client, from the cluster secret bundle. Argo CD
  # fills `$<secret>:<key>` in dex.config from Secrets labelled part-of argocd.
  googleSecret = "argocd-google";
  googleKey = key: "\$${googleSecret}:${key}";
in
{
  options.macro.argocd = with lib; {
    hostname = mkOption {
      type = types.str;
      description = "Where Argo CD's UI and API are served; Google redirects to https://<hostname>/api/dex/callback.";
    };
    googleDomain = mkOption {
      type = types.str;
      default = "macro.com";
      description = "The Google Workspace domain whose accounts may sign in.";
    };
  };

  config.applications.argocd = {
    namespace = "argocd";
    createNamespace = true;

    helm.releases.argocd = {
      chart = charts.argoproj.argo-cd;
      values = {
        global.domain = cfg.hostname;

        dex.enabled = true;
        notifications.enabled = false;

        configs = {
          # The ALB ends TLS; the edge speaks plain HTTP to the server.
          params."server.insecure" = true;
          cm = {
            # No local accounts: the initial admin password stops working.
            "admin.enabled" = false;
            "dex.config" = builtins.toJSON {
              connectors = [
                {
                  type = "google";
                  id = "google";
                  name = "Google";
                  config = {
                    clientID = googleKey "google_client_id";
                    clientSecret = googleKey "google_client_secret";
                    # Dex rejects any account whose `hd` claim isn't listed.
                    hostedDomains = [ cfg.googleDomain ];
                  };
                }
              ];
            };
            # Applications here are plain YAML; nothing renders on the server.
            # (`jsonnet.enable` would turn off plain directories too.)
            "kustomize.enable" = "false";
            "helm.enable" = "false";
          };
          # Every signed-in account; nothing grants more.
          rbac."policy.default" = "role:readonly";
          # The monorepo is public, so no credentials. A depth-1 fetch keeps
          # the repo server's clone small; the whole history is several GB.
          repositories.macro = {
            name = "macro";
            type = "git";
            url = repository;
            depth = "1";
          };
        };
      };
    };

    yamls = [
      (builtins.toJSON {
        apiVersion = "external-secrets.io/v1";
        kind = "ExternalSecret";
        metadata = {
          name = googleSecret;
          # The CRD comes from the external-secrets application.
          annotations."argocd.argoproj.io/sync-options" = "SkipDryRunOnMissingResource=true";
        };
        spec = {
          refreshInterval = "1h";
          secretStoreRef = {
            kind = "ClusterSecretStore";
            name = cluster.secretStore;
          };
          target = {
            name = googleSecret;
            creationPolicy = "Owner";
            template = {
              engineVersion = "v2";
              metadata.labels."app.kubernetes.io/part-of" = "argocd";
            };
          };
          data =
            map
              (property: {
                secretKey = property;
                remoteRef = {
                  key = cluster.secretsManagerSecret;
                  inherit property;
                };
              })
              [
                "google_client_id"
                "google_client_secret"
              ];
        };
      })
    ];
  };
}
