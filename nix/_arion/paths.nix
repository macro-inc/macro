# Host paths relative to Compose `--project-directory` (the repo root).
#
# These stay strings on purpose: a Nix path would copy the tree into the
# store and freeze bind mounts to that snapshot instead of the live checkout.
{
  context = ".";
  syncSrc = "./services/sync-service/src";
  staticFileCdnConf = "./infra/local/nginx/static-file-cdn.conf";
  fusionauthKickstart = "./infra/stacks/fusionauth-instance/kickstart";
  datadogYaml = "./docker/datadog-agent/datadog.yaml";
  opensearchContext = "infra/local/opensearch";
  dockerfiles = {
    websocket = "docker/websocket-service.Dockerfile";
    sync = "docker/sync-service.Dockerfile";
    aiEditing = "docker/ai-editing-worker.Dockerfile";
    analytics = "docker/analytics-proxy.Dockerfile";
    lexical = "docker/lexical-service.Dockerfile";
    opensearch = "Dockerfile";
  };
}
