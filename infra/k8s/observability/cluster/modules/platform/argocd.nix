# Argo CD, managing itself: this application syncs manifests/prod/argocd, the
# `apps` application (nixidy's app of apps) syncs every Application under
# manifests/prod/apps. Bootstrapped once by scripts/bootstrap.sh.
{ charts, config, ... }:
let
  inherit (config.nixidy.target) repository;
in
{
  applications.argocd = {
    namespace = "argocd";
    createNamespace = true;

    helm.releases.argocd = {
      chart = charts.argoproj.argo-cd;
      values = {
        # No public UI: reached with `kubectl port-forward` through an EKS
        # access entry.
        global.domain = "localhost:8080";

        dex.enabled = false;
        notifications.enabled = false;

        configs = {
          cm = {
            "admin.enabled" = true;
            # Applications here are plain YAML; nothing renders on the server.
            # (`jsonnet.enable` would turn off plain directories too.)
            "kustomize.enable" = "false";
            "helm.enable" = "false";
          };
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
  };
}
