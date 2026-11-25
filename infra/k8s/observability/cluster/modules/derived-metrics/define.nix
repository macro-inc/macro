# Completes the definitions of spans.nix and logs.nix: defaults, the `env` tag
# every metric has, and what it and its labels are called in Mimir (dots become
# underscores; `env` is `deployment_environment` as on every other series).
{ lib }:
let
  underscores = lib.replaceStrings [ "." ] [ "_" ];
  label = tag: if tag == "env" then "deployment_environment" else underscores tag;
in
lib.mapAttrsToList (
  name: definition:
  let
    metric = {
      inherit name;
      where = [ ];
      value = null;
      tags = { };
    }
    // definition;
    tags = {
      env = [
        "deployment.environment"
        "deployment.environment.name"
      ];
    }
    // metric.tags;
  in
  metric
  // {
    inherit tags;
    metric = underscores name + lib.optionalString (metric.value == "duration") "_seconds";
    kind = if metric.value == null then "count" else "distribution";
    labels = lib.mapAttrs (tag: _: label tag) tags;
  }
)
