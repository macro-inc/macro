# The cluster behind the existing ALB: one IP target group per hostname (the
# cluster's AWS Load Balancer Controller registers the edge nginx pods through
# TargetGroupBinding) and the security group rules that let the ALB reach the
# pods. With `settings.switched`, a listener rule per hostname too; the Pulumi
# stack's rule (priority 1) wins until it drops those names (README "The
# switch"). The hostnames' DNS records and certificate stay the stack's.
{ lib, settings, ... }:
let
  inherit (lib.tf) ref;
  inherit (settings) edge hosts;
  forHosts = f: lib.mapAttrs f hosts;
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
