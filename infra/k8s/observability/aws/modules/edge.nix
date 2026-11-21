# The cluster behind the existing ALB: one IP target group per hostname (the
# cluster's AWS Load Balancer Controller registers the edge nginx pods through
# TargetGroupBinding) and the security group rules that let the ALB reach the
# pods. With `settings.switched`, a listener rule per hostname too; the Pulumi
# stack's rule (priority 1) wins until it drops those names (README "The
# switch"). The switched hostnames' DNS records and certificate stay the
# stack's; a host with `own` gets its own here: a DNS-validated certificate
# added to the stack's listener and an alias record to the ALB.
{ lib, settings, ... }:
let
  inherit (lib.tf) ref;
  inherit (settings) edge hosts;
  forHosts = f: lib.mapAttrs f hosts;
  ownHosts = lib.filterAttrs (_: host: host.own or false) hosts;
  forOwnHosts = f: lib.mapAttrs f ownHosts;
  zoneId = ref "data.aws_route53_zone.public.zone_id";
  validation = name: field: ref "one(aws_acm_certificate.${name}.domain_validation_options).${field}";
in
{
  resource = {
    aws_acm_certificate = forOwnHosts (
      _: host: {
        domain_name = host.hostname;
        validation_method = "DNS";
        lifecycle.create_before_destroy = true;
      }
    );
    # A certificate for one hostname has one validation record.
    aws_route53_record =
      lib.mapAttrs' (
        name: _:
        lib.nameValuePair "${name}_validation" {
          zone_id = zoneId;
          name = validation name "resource_record_name";
          type = validation name "resource_record_type";
          records = [ (validation name "resource_record_value") ];
          ttl = 300;
        }
      ) ownHosts
      // forOwnHosts (
        _: host: {
          zone_id = zoneId;
          name = host.hostname;
          type = "A";
          alias = {
            name = ref "data.aws_lb.observability.dns_name";
            zone_id = ref "data.aws_lb.observability.zone_id";
            evaluate_target_health = true;
          };
        }
      );
    aws_acm_certificate_validation = forOwnHosts (
      name: _: {
        certificate_arn = ref "aws_acm_certificate.${name}.arn";
        validation_record_fqdns = [ (ref "aws_route53_record.${name}_validation.fqdn") ];
      }
    );
    # The listener picks a certificate by SNI; its default stays the stack's.
    aws_lb_listener_certificate = forOwnHosts (
      name: _: {
        listener_arn = ref "data.aws_lb_listener.https.arn";
        certificate_arn = ref "aws_acm_certificate_validation.${name}.certificate_arn";
      }
    );

    aws_lb_target_group = forHosts (
      _: host: {
        name = host.targetGroup;
        target_type = "ip";
        port = edge.port;
        protocol = "HTTP";
        vpc_id = ref "data.aws_vpc.observability.id";
        deregistration_delay = 30;
        health_check = {
          path = edge.healthPath;
          matcher = "200";
          interval = 15;
          healthy_threshold = 2;
          unhealthy_threshold = 2;
        };
      }
    );

    aws_lb_listener_rule = lib.optionalAttrs settings.switched (
      forHosts (
        name: host: {
          listener_arn = ref "data.aws_lb_listener.https.arn";
          inherit (host) priority;
          condition = [ { host_header.values = [ host.hostname ]; } ];
          action = [
            {
              type = "forward";
              target_group_arn = ref "aws_lb_target_group.${name}.arn";
            }
          ];
        }
      )
    );

    # The ALB's security group allows egress only to what is listed; this adds
    # the cluster on the edge port, as the stack does for the host on 8080.
    aws_vpc_security_group_egress_rule.alb_to_edge = {
      security_group_id = ref "local.alb_security_group_id";
      referenced_security_group_id = ref "aws_eks_cluster.observability.vpc_config[0].cluster_security_group_id";
      ip_protocol = "tcp";
      from_port = edge.port;
      to_port = edge.port;
      description = "ALB to the EKS edge nginx pods";
    };
    # Pods use the cluster security group (no security groups for pods).
    aws_vpc_security_group_ingress_rule.edge_from_alb = {
      security_group_id = ref "aws_eks_cluster.observability.vpc_config[0].cluster_security_group_id";
      referenced_security_group_id = ref "local.alb_security_group_id";
      ip_protocol = "tcp";
      from_port = edge.port;
      to_port = edge.port;
      description = "Edge nginx pods from the observability ALB";
    };
  };
}
