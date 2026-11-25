# What a Datadog metric or tag is called in Mimir: its dots become underscores,
# except `env`, which is `deployment_environment` as on every other series.
{ lib }:
let
  underscores = lib.replaceStrings [ "." ] [ "_" ];
in
{
  metric = underscores;
  label = tag: if tag == "env" then "deployment_environment" else underscores tag;
}
