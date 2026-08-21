# Host paths relative to Compose `--project-directory` (the repo root).
#
# These stay strings on purpose: a Nix path would copy the tree into the
# store and freeze bind mounts to that snapshot instead of the live checkout.
{
  context = ".";
  syncSrc = "./services/sync-service";
  websocketSrc = "./services/websocket-service";
  lexicalSrc = "./services/lexical-service";
  staticFileCdnConf = "./infra/local/nginx/static-file-cdn.conf";
  fusionauthKickstart = "./infra/stacks/fusionauth-instance/kickstart";
  datadogYaml = "./docker/datadog-agent/datadog.yaml";
  opensearchEntrypoint = "./nix/_containers/opensearch-entrypoint.sh";
}
