# Reloader rolls a Deployment when a Secret it names changes. Grafana needs
# it: RDS rotates its database password and Grafana reads the password only
# at startup. It acts only on workloads annotated
# `secret.reloader.stakater.com/reload: <secret>,...` and only in
# `observability`.
{ charts, config, ... }:
let
  namespace = "observability";
in
{
  applications.reloader = {
    inherit namespace;

    helm.releases.reloader = {
      chart = charts.stakater.reloader;
      values.reloader = {
        watchGlobally = false;
        # Restarts through a pod template annotation instead of an
        # environment variable, which Argo CD would see as drift and undo.
        reloadStrategy = "annotations";
        # A Secret can appear after its pod started: an ExternalSecret whose
        # key is added to Secrets Manager later creates it then (Grafana's
        # optional ones). Not again for every Secret when Reloader restarts:
        # `syncAfterRestart` stays off.
        reloadOnCreate = true;
        syncAfterRestart = false;
        ignoreConfigMaps = true;
        readOnlyRootFileSystem = true;
        deployment = {
          containerSecurityContext = {
            allowPrivilegeEscalation = false;
            capabilities.drop = [ "ALL" ];
          };
          resources = {
            requests = {
              cpu = "10m";
              memory = "64Mi";
            };
            limits.memory = "256Mi";
          };
        };
      };
    };

    # It only talks to the API server (EKS endpoints on 443; 6443 on kind).
    resources.networkPolicies.reloader.spec = {
      podSelector.matchLabels."app.kubernetes.io/name" = "reloader";
      policyTypes = [
        "Ingress"
        "Egress"
      ];
      egress = [
        {
          ports =
            map
              (port: {
                protocol = "TCP";
                inherit port;
              })
              [
                443
                6443
              ];
        }
      ];
    };
  };
}
