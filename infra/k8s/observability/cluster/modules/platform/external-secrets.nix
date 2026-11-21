# External Secrets Operator copies keys of the Secrets Manager secret into
# Kubernetes Secrets. Its role (Pod Identity, service account
# `external-secrets/external-secrets`) reads only that secret and Grafana's
# RDS-managed database secret.
#
# An app reads a key with an ExternalSecret in its own namespace:
#
#   spec.secretStoreRef = { kind = "ClusterSecretStore"; name = config.macro.cluster.secretStore; };
#   spec.data = [{ secretKey = "otlp_token"; remoteRef = { key = config.macro.cluster.secretsManagerSecret; property = "otlp_token"; }; }];
{ charts, config, ... }:
let
  cluster = config.macro.cluster;
in
{
  applications.external-secrets = {
    namespace = "external-secrets";
    createNamespace = true;

    helm.releases.external-secrets = {
      chart = charts.external-secrets.external-secrets;
      values = {
        serviceAccount.name = "external-secrets";
        # The controller reads AWS with its own Pod Identity for any store
        # without an auth block, so creating a SecretStore is as good as
        # reading the secret. Keep that out of the namespace edit and admin
        # roles; only cluster admins create stores.
        rbac = {
          aggregateToEdit = false;
          aggregateToAdmin = false;
        };
        # Its own cert controller issues the webhook certificate at runtime.
        webhook.certManager.enabled = false;
      };
    };

    # No typed options for this CRD; JSON is YAML.
    yamls = [
      (builtins.toJSON {
        apiVersion = "external-secrets.io/v1";
        kind = "ClusterSecretStore";
        metadata = {
          name = cluster.secretStore;
          annotations = {
            # After the operator and its webhook are healthy.
            "argocd.argoproj.io/sync-wave" = "1";
            "argocd.argoproj.io/sync-options" = "SkipDryRunOnMissingResource=true";
          };
        };
        spec = {
          provider.aws = {
            service = "SecretsManager";
            inherit (cluster) region;
            # No auth block: the controller's Pod Identity credentials.
          };
          # Only ExternalSecrets in the observability namespace may use it.
          conditions = [ { namespaces = [ "observability" ]; } ];
        };
      })
    ];
  };
}
