# The `observability` namespace, where Loki, Tempo, Mimir, Grafana, ingest and
# the edge run, each as its own application. Nothing talks in or out of a pod
# here unless a NetworkPolicy allows it: every app adds the policies for its
# own traffic in its own application (for example "loki accepts 3100 from
# ingest and the query gateway").
#
# Policies that more than one app needs live here, selected by pod label:
# - every pod may resolve DNS;
# - pods labelled `observability.macro.com/aws-apis: "true"` may reach AWS
#   APIs and S3 on 443 and the Pod Identity agent for credentials.
{ lib, ... }:
let
  namespace = "observability";
  dns = {
    to = [
      {
        namespaceSelector.matchLabels."kubernetes.io/metadata.name" = "kube-system";
        podSelector.matchLabels.k8s-app = "kube-dns";
      }
    ];
    ports = [
      {
        protocol = "UDP";
        port = 53;
      }
      {
        protocol = "TCP";
        port = 53;
      }
    ];
  };
in
{
  # Shared by the namespaces that default-deny (here and alloy-node.nix).
  options.macro.networkPolicy.allowDns = lib.mkOption {
    type = lib.types.attrs;
    readOnly = true;
    default = dns;
    description = "Egress rule that allows DNS to CoreDNS.";
  };

  config.applications.observability-namespace = {
    inherit namespace;
    createNamespace = true;

    resources = {
      namespaces.${namespace}.metadata.labels = {
        "pod-security.kubernetes.io/enforce" = "baseline";
        "pod-security.kubernetes.io/warn" = "restricted";
        "pod-security.kubernetes.io/audit" = "restricted";
      };

      networkPolicies = {
        default-deny.spec = {
          podSelector = { };
          policyTypes = [
            "Ingress"
            "Egress"
          ];
        };

        allow-dns.spec = {
          podSelector = { };
          policyTypes = [ "Egress" ];
          egress = [ dns ];
        };

        allow-aws-apis.spec = {
          podSelector.matchLabels."observability.macro.com/aws-apis" = "true";
          policyTypes = [ "Egress" ];
          egress = [
            # STS, Secrets Manager, CloudWatch, SNS and S3 (gateway endpoint,
            # public prefix list): all HTTPS, none with a fixed address.
            {
              ports = [
                {
                  protocol = "TCP";
                  port = 443;
                }
              ];
            }
            # EKS Pod Identity agent on every node.
            {
              to = [ { ipBlock.cidr = "169.254.170.23/32"; } ];
              ports = [
                {
                  protocol = "TCP";
                  port = 80;
                }
              ];
            }
          ];
        };
      };
    };
  };
}
