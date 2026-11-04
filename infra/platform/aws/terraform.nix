# Everything outside the cluster on AWS, as terranix (rendered to OpenTofu
# JSON). Inside the cluster, infra/platform is identical to local: only the size
# profile differs. Nodes run stock NixOS and receive their configuration from
# infra/platform/nixos/k3s-node.nix.
{ lib, config, ... }:
let
  cfg = config.macro;
  azs = [
    "${cfg.region}a"
    "${cfg.region}b"
    "${cfg.region}c"
  ];
  common = {
    Project = "macro-platform";
    Cluster = cfg.cluster;
  };
  named = name: common // { Name = "${cfg.cluster}-${name}"; };
in
{
  options.macro = {
    cluster = lib.mkOption { type = lib.types.str; };
    region = lib.mkOption {
      type = lib.types.str;
      default = "us-east-1";
    };
    domain = lib.mkOption {
      type = lib.types.str;
      description = "Instances are served at <instance>.<domain>.";
    };
    zoneId = lib.mkOption { type = lib.types.str; };
    serverCount = lib.mkOption {
      type = lib.types.int;
      default = 3;
    };
    serverType = lib.mkOption {
      type = lib.types.str;
      default = "m6i.xlarge";
    };
    agentCount = lib.mkOption {
      type = lib.types.int;
      default = 3;
    };
    agentType = lib.mkOption {
      type = lib.types.str;
      default = "m6i.4xlarge";
    };
    adminCidrs = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      description = "Who may reach the API server and SSH.";
    };
  };

  config = {
    terraform.required_providers = {
      aws = {
        source = "hashicorp/aws";
        version = "~> 6.0";
      };
      random = {
        source = "hashicorp/random";
        version = "~> 3.6";
      };
    };
    provider.aws.region = cfg.region;

    # The cluster has its own network: it shares nothing with existing stacks.
    resource.aws_vpc.main = {
      cidr_block = "10.60.0.0/16";
      enable_dns_hostnames = true;
      tags = named "vpc";
    };
    resource.aws_internet_gateway.main = {
      vpc_id = "\${aws_vpc.main.id}";
      tags = named "igw";
    };
    resource.aws_route_table.public = {
      vpc_id = "\${aws_vpc.main.id}";
      route = [
        {
          cidr_block = "0.0.0.0/0";
          gateway_id = "\${aws_internet_gateway.main.id}";
          carrier_gateway_id = null;
          core_network_arn = null;
          destination_prefix_list_id = null;
          egress_only_gateway_id = null;
          ipv6_cidr_block = null;
          local_gateway_id = null;
          nat_gateway_id = null;
          network_interface_id = null;
          transit_gateway_id = null;
          vpc_endpoint_id = null;
          vpc_peering_connection_id = null;
        }
      ];
      tags = named "public";
    };
    resource.aws_subnet = lib.listToAttrs (
      lib.imap0 (i: az: {
        name = "public_${toString i}";
        value = {
          vpc_id = "\${aws_vpc.main.id}";
          availability_zone = az;
          cidr_block = "10.60.${toString i}.0/24";
          map_public_ip_on_launch = true;
          tags = named "public-${toString i}";
        };
      }) azs
    );
    resource.aws_route_table_association = lib.listToAttrs (
      lib.imap0 (i: _: {
        name = "public_${toString i}";
        value = {
          subnet_id = "\${aws_subnet.public_${toString i}.id}";
          route_table_id = "\${aws_route_table.public.id}";
        };
      }) azs
    );

    resource.aws_security_group.nodes = {
      name = "${cfg.cluster}-nodes";
      vpc_id = "\${aws_vpc.main.id}";
      tags = named "nodes";
    };
    resource.aws_vpc_security_group_ingress_rule =
      {
        nodes_internal = {
          security_group_id = "\${aws_security_group.nodes.id}";
          referenced_security_group_id = "\${aws_security_group.nodes.id}";
          ip_protocol = "-1";
        };
        ingress_https = {
          security_group_id = "\${aws_security_group.nodes.id}";
          cidr_ipv4 = "0.0.0.0/0";
          ip_protocol = "tcp";
          from_port = 443;
          to_port = 443;
        };
      }
      // lib.listToAttrs (
        lib.concatLists (
          lib.imap0 (i: cidr: [
            {
              name = "admin_api_${toString i}";
              value = {
                security_group_id = "\${aws_security_group.nodes.id}";
                cidr_ipv4 = cidr;
                ip_protocol = "tcp";
                from_port = 6443;
                to_port = 6443;
              };
            }
            {
              name = "admin_ssh_${toString i}";
              value = {
                security_group_id = "\${aws_security_group.nodes.id}";
                cidr_ipv4 = cidr;
                ip_protocol = "tcp";
                from_port = 22;
                to_port = 22;
              };
            }
          ]) cfg.adminCidrs
        )
      );
    resource.aws_vpc_security_group_egress_rule.all = {
      security_group_id = "\${aws_security_group.nodes.id}";
      cidr_ipv4 = "0.0.0.0/0";
      ip_protocol = "-1";
    };

    # Stock NixOS; `nixos-rebuild --target-host` applies the node configuration.
    data.aws_ami.nixos = {
      most_recent = true;
      owners = [ "427812963091" ];
      filter = [
        {
          name = "name";
          values = [ "nixos/*" ];
        }
        {
          name = "architecture";
          values = [ "x86_64" ];
        }
      ];
    };

    resource.aws_instance = lib.listToAttrs (
      (lib.genList (i: {
        name = "server_${toString i}";
        value = {
          ami = "\${data.aws_ami.nixos.id}";
          instance_type = cfg.serverType;
          subnet_id = "\${aws_subnet.public_${toString (lib.mod i (lib.length azs))}.id}";
          vpc_security_group_ids = [ "\${aws_security_group.nodes.id}" ];
          iam_instance_profile = "\${aws_iam_instance_profile.nodes.name}";
          root_block_device = {
            volume_size = 200;
            volume_type = "gp3";
          };
          tags = named "server-${toString i}";
        };
      }) cfg.serverCount)
      ++ (lib.genList (i: {
        name = "agent_${toString i}";
        value = {
          ami = "\${data.aws_ami.nixos.id}";
          instance_type = cfg.agentType;
          subnet_id = "\${aws_subnet.public_${toString (lib.mod i (lib.length azs))}.id}";
          vpc_security_group_ids = [ "\${aws_security_group.nodes.id}" ];
          iam_instance_profile = "\${aws_iam_instance_profile.nodes.name}";
          root_block_device = {
            volume_size = 500;
            volume_type = "gp3";
          };
          tags = named "agent-${toString i}";
        };
      }) cfg.agentCount)
    );

    # Nodes read store paths from the binary cache and nothing else.
    resource.aws_iam_role.nodes = {
      name = "${cfg.cluster}-nodes";
      assume_role_policy = builtins.toJSON {
        Version = "2012-10-17";
        Statement = [
          {
            Effect = "Allow";
            Action = "sts:AssumeRole";
            Principal.Service = "ec2.amazonaws.com";
          }
        ];
      };
      tags = common;
    };
    resource.aws_iam_role_policy.nodes_cache = {
      name = "binary-cache-read";
      role = "\${aws_iam_role.nodes.id}";
      policy = builtins.toJSON {
        Version = "2012-10-17";
        Statement = [
          {
            Effect = "Allow";
            Action = [
              "s3:GetObject"
              "s3:GetBucketLocation"
              "s3:ListBucket"
            ];
            Resource = [
              "\${aws_s3_bucket.nix_cache.arn}"
              "\${aws_s3_bucket.nix_cache.arn}/*"
            ];
          }
        ];
      };
    };
    resource.aws_iam_instance_profile.nodes = {
      name = "${cfg.cluster}-nodes";
      role = "\${aws_iam_role.nodes.name}";
    };

    resource.aws_s3_bucket = {
      nix_cache = {
        bucket = "${cfg.cluster}-nix-cache";
        tags = common;
      };
      backups = {
        bucket = "${cfg.cluster}-backups";
        tags = common;
      };
    };
    resource.aws_s3_bucket_versioning.backups = {
      bucket = "\${aws_s3_bucket.backups.id}";
      versioning_configuration.status = "Enabled";
    };
    resource.aws_s3_bucket_public_access_block = {
      nix_cache = {
        bucket = "\${aws_s3_bucket.nix_cache.id}";
        block_public_acls = true;
        block_public_policy = true;
        ignore_public_acls = true;
        restrict_public_buckets = true;
      };
      backups = {
        bucket = "\${aws_s3_bucket.backups.id}";
        block_public_acls = true;
        block_public_policy = true;
        ignore_public_acls = true;
        restrict_public_buckets = true;
      };
    };

    # Traefik terminates TLS, as on every cluster; the NLB only forwards TCP.
    resource.aws_lb.ingress = {
      name = "${cfg.cluster}-ingress";
      load_balancer_type = "network";
      subnets = lib.imap0 (i: _: "\${aws_subnet.public_${toString i}.id}") azs;
      security_groups = [ "\${aws_security_group.nodes.id}" ];
      tags = common;
    };
    resource.aws_lb_target_group.ingress = {
      name = "${cfg.cluster}-ingress";
      port = 443;
      protocol = "TCP";
      vpc_id = "\${aws_vpc.main.id}";
      tags = common;
    };
    resource.aws_lb_listener.https = {
      load_balancer_arn = "\${aws_lb.ingress.arn}";
      port = 443;
      protocol = "TCP";
      default_action = [
        {
          type = "forward";
          target_group_arn = "\${aws_lb_target_group.ingress.arn}";
        }
      ];
    };
    resource.aws_lb_target_group_attachment = lib.listToAttrs (
      lib.genList (i: {
        name = "agent_${toString i}";
        value = {
          target_group_arn = "\${aws_lb_target_group.ingress.arn}";
          target_id = "\${aws_instance.agent_${toString i}.id}";
          port = 443;
        };
      }) cfg.agentCount
    );
    resource.aws_route53_record.wildcard = {
      zone_id = cfg.zoneId;
      name = "*.${cfg.domain}";
      type = "CNAME";
      ttl = 60;
      records = [ "\${aws_lb.ingress.dns_name}" ];
    };

    # Nodes join with this; `nixos-rebuild` installs it at /run/keys/k3s-token.
    resource.random_password.k3s_token = {
      length = 64;
      special = false;
    };

    output = {
      server_ips.value = lib.genList (i: "\${aws_instance.server_${toString i}.public_ip}") cfg.serverCount;
      agent_ips.value = lib.genList (i: "\${aws_instance.agent_${toString i}.public_ip}") cfg.agentCount;
      nix_cache_bucket.value = "\${aws_s3_bucket.nix_cache.bucket}";
      k3s_token = {
        value = "\${random_password.k3s_token.result}";
        sensitive = true;
      };
    };
  };
}
