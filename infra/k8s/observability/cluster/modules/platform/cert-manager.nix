# cert-manager issues the load balancer controller's webhook certificate. The
# controller's chart otherwise generates one with `genCA` at render time, which
# makes every render differ and the committed manifests impossible to check.
{ charts, ... }:
{
  applications.cert-manager = {
    namespace = "cert-manager";
    createNamespace = true;

    helm.releases.cert-manager = {
      chart = charts.jetstack.cert-manager;
      values = {
        crds = {
          enabled = true;
          keep = true;
        };
        # A post-install Helm hook that only waits for the webhook; Argo CD's
        # health checks and retries already do that.
        startupapicheck.enabled = false;
      };
    };
  };
}
