# Resources the Pulumi `observability` stack owns, read as data sources. This
# layer never imports or changes them; it only adds resources next to them
# (subnets, route table associations, security group rules, and at the switch
# listener rules); the cluster's Loki and Tempo roles get access to the host's
# buckets.
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

    # The stack's tagged buckets, for the host's Loki and Tempo buckets (their
    # names end in a random suffix). Exactly one of each must match.
    aws_resourcegroupstaggingapi_resources.host_buckets = {
      resource_type_filters = [ "s3" ];
      tag_filter = lib.mapAttrsToList (key: value: {
        inherit key;
        values = [ value ];
      }) existing.tags;
      lifecycle.postcondition = lib.mapAttrsToList (kind: prefix: {
        condition = "\${length([for r in self.resource_tag_mapping_list : r if startswith(r.resource_arn, \"arn:aws:s3:::${prefix}\")]) == 1}";
        error_message = "Expected exactly one bucket of the observability stack named ${prefix}*, for the host's ${kind}.";
      }) existing.bucketPrefixes;
    };
  }
  // lib.optionalAttrs settings.mimirBackfill.enable {
    # The host's instance role, which writes its Prometheus blocks into Mimir's
    # bucket while `mimirBackfill.enable` is on (modules/buckets.nix): the
    # role of the stack's one running instance. The dev stack's host and the
    # deploy's smoke hosts carry other tags.
    aws_instances.host = {
      instance_tags = existing.tags;
      instance_state_names = [ "running" ];
      lifecycle.postcondition = [
        {
          condition = "\${length(self.ids) == 1}";
          error_message = "Expected exactly one running instance of the observability stack, the host; is a deploy replacing it?";
        }
      ];
    };
    aws_instance.host.instance_id = ref "one(data.aws_instances.host.ids)";
    aws_iam_instance_profile.host.name = ref "data.aws_instance.host.iam_instance_profile";
  };

  locals =
    lib.optionalAttrs settings.mimirBackfill.enable {
      host_role_arn = ref "data.aws_iam_instance_profile.host.role_arn";
    }
    // {
      # The host's bucket ARNs by kind (`logs`, `traces`).
      host_bucket_arns = lib.mapAttrs (
        _: prefix:
        ref "one([for r in data.aws_resourcegroupstaggingapi_resources.host_buckets.resource_tag_mapping_list : r.resource_arn if startswith(r.resource_arn, \"arn:aws:s3:::${prefix}\")])"
      ) existing.bucketPrefixes;
      alb_security_group_id = ref "one(data.aws_lb.observability.security_groups)";
      private_subnet_ids = [
        (ref "data.aws_subnet.private_a.id")
        (ref "aws_subnet.private_b.id")
        (ref "aws_subnet.private_c.id")
      ];
    };
}
