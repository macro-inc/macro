# Resources the Pulumi `observability` stack owns, read as data sources. This
# layer never imports or changes them; it only adds resources next to them
# (subnets, route table associations, listener rules, a listener certificate,
# DNS records and security group rules).
{ lib, settings, ... }:
let
  inherit (lib.tf) ref;
  inherit (settings) existing;
  vpcFilter = [
    {
      name = "vpc-id";
      values = [ (ref "data.aws_vpc.observability.id") ];
    }
  ];
in
{
  data = {
    aws_vpc.observability.tags = existing.tags;

    # The host's private subnet in us-east-2a; the cluster's third AZ.
    aws_subnet.private_a.filter = vpcFilter ++ [
      {
        name = "cidr-block";
        values = [ existing.privateSubnetCidr ];
      }
    ];

    # The single NAT and the private route table behind it, which also carries
    # the S3 gateway endpoint.
    aws_nat_gateway.observability = {
      vpc_id = ref "data.aws_vpc.observability.id";
      state = "available";
    };
    aws_route_table.private.filter = vpcFilter ++ [
      {
        name = "route.nat-gateway-id";
        values = [ (ref "data.aws_nat_gateway.observability.id") ];
      }
    ];

    aws_lb.observability.tags = existing.tags;
    aws_lb_listener.https = {
      load_balancer_arn = ref "data.aws_lb.observability.arn";
      port = 443;
    };

    aws_route53_zone.public = {
      name = existing.zone;
      private_zone = false;
    };

    aws_sns_topic.alarms.name = existing.alarmTopic;

    # Metadata only: a data source on the secret never reads its value.
    aws_secretsmanager_secret.observability.name = existing.secret;
  };

  locals = {
    alb_security_group_id = ref "one(data.aws_lb.observability.security_groups)";
    private_subnet_ids = [
      (ref "data.aws_subnet.private_a.id")
      (ref "aws_subnet.private_b.id")
      (ref "aws_subnet.private_c.id")
    ];
  };
}
