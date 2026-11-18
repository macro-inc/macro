# The AI authorship dashboard is plain JSON (gitai-dashboard.json) so it can
# also be imported by hand; tooling/gitai/README.md describes it.
{ pkgs, ... }:
{
  services.grafana.provision.dashboards.settings.providers = [
    {
      name = "gitai";
      orgId = 1;
      folder = "AI authorship";
      type = "file";
      disableDeletion = true;
      allowUiUpdates = false;
      options.path = pkgs.linkFarm "gitai-dashboard" [
        {
          name = "gitai.json";
          path = ./gitai-dashboard.json;
        }
      ];
    }
  ];
}
