# Cluster facts every module reads, and the defaults every Argo CD application
# gets.
{ config, lib, ... }:
let
  cfg = config.macro.cluster;

  # CRD schemas without their documentation: `description` and `example` carry
  # no meaning for the API server, make up most of the committed YAML, and
  # upstream examples (service-account emails, key placeholders) trip the
  # repository's PII scan. Walks schemas only, since a `properties` map can
  # hold fields with those names.
  stripDocs =
    schema:
    if !builtins.isAttrs schema then
      schema
    else
      lib.mapAttrs
        (
          key: value:
          if key == "properties" || key == "patternProperties" then
            lib.mapAttrs (_: stripDocs) value
          else if key == "items" || key == "additionalProperties" || key == "not" then
            (if builtins.isList value then map stripDocs value else stripDocs value)
          else if key == "allOf" || key == "anyOf" || key == "oneOf" then
            map stripDocs value
          else
            value
        )
        (
          removeAttrs schema [
            "description"
            "example"
          ]
        );

  slimCRD =
    object:
    if object.kind or "" == "CustomResourceDefinition" then
      lib.recursiveUpdate object {
        spec.versions = map (
          version:
          version
          // lib.optionalAttrs (version ? schema.openAPIV3Schema) {
            schema = version.schema // {
              openAPIV3Schema = stripDocs version.schema.openAPIV3Schema;
            };
          }
        ) object.spec.versions;
      }
    else
      object;
in
{
  options.macro.cluster = with lib; {
    autoSync = mkOption {
      type = types.bool;
      default = true;
      description = ''
        Whether Argo CD applies each application as soon as `main` changes.
        Off, every application waits for a sync from the Argo CD UI or CLI,
        which shows its diff first.
      '';
    };
    name = mkOption {
      type = types.str;
      description = "EKS cluster name, as the AWS layer (`infra/k8s/observability/aws`) creates it.";
    };
    region = mkOption {
      type = types.str;
      description = "AWS region of the cluster and of the Secrets Manager secret.";
    };
    kubernetesVersion = mkOption {
      type = types.str;
      example = "1.37.0";
      description = ''
        Kubernetes version the charts render for (`helm template --kube-version`)
        and the manifests are validated against. Bump it with the control plane.
      '';
    };
    vpcTags = mkOption {
      type = types.attrsOf types.str;
      description = ''
        Tags that identify the cluster's VPC. The load balancer controller finds
        the VPC by them, since nodes keep the IMDS hop limit at 1 and pods can't
        read instance metadata.
      '';
    };
    secretsManagerSecret = mkOption {
      type = types.str;
      description = "Secrets Manager secret (JSON) that External Secrets reads for the observability apps.";
    };
    secretStore = mkOption {
      type = types.str;
      readOnly = true;
      default = "secrets-manager";
      description = "Name of the ClusterSecretStore an ExternalSecret references.";
    };
  };

  config.nixidy = {
    applicationImports = [
      (_: {
        # Server-side apply: CRDs such as Argo CD's are too large for the
        # last-applied annotation of client-side apply.
        syncPolicy.syncOptions.serverSideApply = lib.mkDefault true;
        # An application whose CRDs or webhooks come from another application
        # (an Issuer before cert-manager is up) fails its first sync; retry
        # instead of waiting for the next commit.
        syncPolicy.retry = lib.mkDefault {
          limit = 10;
          backoff = {
            duration = "15s";
            factor = 2;
            maxDuration = "5m";
          };
        };
      })
    ];
    chartsDir = ../charts;
    defaults = {
      syncPolicy.autoSync = {
        enable = cfg.autoSync;
        prune = true;
        selfHeal = true;
      };
      helm.transformer = map slimCRD;
      helm.extraOpts = [
        "--kube-version"
        cfg.kubernetesVersion
      ];
    };
  };
}
