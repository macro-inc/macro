# The cluster behind the existing ALB: one IP target group per hostname (the
# cluster's AWS Load Balancer Controller registers the edge nginx pods through
# TargetGroupBinding), the -next listener rules, a certificate for the -next
# names added to the listener, their DNS records, and the security group rules
# that let the ALB reach the pods. Cutover to the plain hostnames is a later
# change (PR 7); nothing here touches today's grafana., otlp. or oncall. rules.
{ lib, settings, ... }:
let
  inherit (lib.tf) ref;
  inherit (settings) edge hosts;
  hostnames = lib.mapAttrsToList (_: host: host.hostname) hosts;
  forHosts = f: lib.mapAttrs f hosts;
  # The validation record ACM asks for, for one hostname.
  validation =
    hostname: attr:
    ref "one([for o in aws_acm_certificate.next.domain_validation_options : o.${attr} if o.domain_name == \"${hostname}\"])";
in
{
  resource = {
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

    aws_lb_listener_rule = forHosts (
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
    );

    aws_acm_certificate.next = {
      domain_name = builtins.head hostnames;
      subject_alternative_names = builtins.tail hostnames;
      validation_method = "DNS";
      lifecycle.create_before_destroy = true;
    };

    aws_route53_record =
      lib.mapAttrs' (
        name: host:
        lib.nameValuePair "validation_${name}" {
          zone_id = ref "data.aws_route53_zone.public.zone_id";
          name = validation host.hostname "resource_record_name";
          type = validation host.hostname "resource_record_type";
          records = [ (validation host.hostname "resource_record_value") ];
          ttl = 300;
          allow_overwrite = false;
        }
      ) hosts
      // forHosts (
        _: host: {
          zone_id = ref "data.aws_route53_zone.public.zone_id";
          name = host.hostname;
          type = "A";
          alias = {
            name = ref "data.aws_lb.observability.dns_name";
            zone_id = ref "data.aws_lb.observability.zone_id";
            evaluate_target_health = true;
          };
        }
      );

    aws_acm_certificate_validation.next = {
      certificate_arn = ref "aws_acm_certificate.next.arn";
      validation_record_fqdns = lib.mapAttrsToList (
        name: _: ref "aws_route53_record.validation_${name}.fqdn"
      ) hosts;
    };

    # Served by SNI next to the stack's own certificate.
    aws_lb_listener_certificate.next = {
      listener_arn = ref "data.aws_lb_listener.https.arn";
      certificate_arn = ref "aws_acm_certificate_validation.next.certificate_arn";
    };

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
