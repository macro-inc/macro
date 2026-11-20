# The EKS cluster, its managed node group, add-ons and access entries.
{ lib, settings, ... }:
let
  inherit (lib.tf) ref;
  iam = import ./iam.nix;
  inherit (settings) cluster;

  attach = role: policy: {
    role = ref "aws_iam_role.${role}.name";
    policy_arn = iam.managed policy;
  };

  addonNames = {
    vpc_cni = "vpc-cni";
    kube_proxy = "kube-proxy";
    pod_identity_agent = "eks-pod-identity-agent";
    coredns = "coredns";
    ebs_csi = "aws-ebs-csi-driver";
  };

  addon =
    key: extra:
    {
      cluster_name = ref "aws_eks_cluster.observability.name";
      addon_name = addonNames.${key};
      # The default version for settings.cluster.version, so bumping the
      # cluster also upgrades the add-ons, after the control plane.
      addon_version = ref "data.aws_eks_addon_version.${key}.version";
      resolve_conflicts_on_create = "OVERWRITE";
      resolve_conflicts_on_update = "OVERWRITE";
    }
    // extra;

  # Created before the nodes so they join with networking and Pod Identity.
  beforeNodes = [
    "aws_eks_addon.vpc_cni"
    "aws_eks_addon.kube_proxy"
    "aws_eks_addon.pod_identity_agent"
  ];
in
{
  data.aws_eks_addon_version = lib.mapAttrs (_: name: {
    addon_name = name;
    kubernetes_version = cluster.version;
    most_recent = false;
  }) addonNames;

  variable = {
    public_access_cidrs = {
      type = "list(string)";
      description = "CIDRs allowed to reach the cluster's public API endpoint.";
      validation = [
        {
          condition = ref "length(var.public_access_cidrs) > 0 && !contains(var.public_access_cidrs, \"0.0.0.0/0\")";
          error_message = "List the operators' addresses; 0.0.0.0/0 is not allowed.";
        }
      ];
    };
  };

  resource = {
    # Created before the cluster so EKS doesn't create it with no retention.
    aws_cloudwatch_log_group.cluster = {
      name = "/aws/eks/${cluster.name}/cluster";
      retention_in_days = cluster.logRetentionDays;
    };

    aws_iam_role = {
      cluster = {
        name = "observability-k8s-cluster";
        assume_role_policy = builtins.toJSON (
          iam.trust "eks.amazonaws.com" [
            "sts:AssumeRole"
            "sts:TagSession"
          ]
        );
      };
      node = {
        name = "observability-k8s-node";
        assume_role_policy = builtins.toJSON (iam.trust "ec2.amazonaws.com" [ "sts:AssumeRole" ]);
      };
      # Cluster admin for IAM users tagged `settings.cluster.adminTag`. Only
      # users: a role session's tags can come from whoever assumed it, a
      # user's only from IAM admins. Its one IAM permission is reading this
      # cluster (aws_iam_role_policy.admin); its power is the access entry.
      admin = {
        name = cluster.adminRole;
        max_session_duration = 3600;
        assume_role_policy = builtins.toJSON (
          let
            assumedBy = value: condition: {
              Effect = "Allow";
              Principal.AWS = "arn:aws:iam::${settings.accountId}:root";
              Action = "sts:AssumeRole";
              Condition = {
                StringEquals = {
                  "aws:PrincipalTag/${cluster.adminTag}" = value;
                  "aws:PrincipalType" = "User";
                };
              }
              // condition;
            };
          in
          iam.policy [
            (assumedBy "admin" { Bool."aws:MultiFactorAuthPresent" = "true"; })
            (assumedBy "automation" { })
          ]
        );
      };
    };

    # `update-kubeconfig` from a profile that assumes the admin role.
    aws_iam_role_policy.admin = {
      name = "describe-cluster";
      role = ref "aws_iam_role.admin.id";
      policy = builtins.toJSON (
        iam.policy [
          {
            Effect = "Allow";
            Action = "eks:DescribeCluster";
            Resource = ref "aws_eks_cluster.observability.arn";
          }
        ]
      );
    };

    # Nodes get what the kubelet, the VPC CNI, image pulls and SSM need, and no
    # S3 or Secrets Manager access: workloads use Pod Identity.
    aws_iam_role_policy_attachment = {
      cluster = attach "cluster" "AmazonEKSClusterPolicy";
      node_worker = attach "node" "AmazonEKSWorkerNodePolicy";
      node_cni = attach "node" "AmazonEKS_CNI_Policy";
      node_ecr = attach "node" "AmazonEC2ContainerRegistryPullOnly";
      node_ssm = attach "node" "AmazonSSMManagedInstanceCore";
    };

    aws_eks_cluster.observability = {
      inherit (cluster) name version;
      role_arn = ref "aws_iam_role.cluster.arn";
      vpc_config = {
        subnet_ids = ref "local.private_subnet_ids";
        endpoint_private_access = true;
        endpoint_public_access = true;
        public_access_cidrs = ref "var.public_access_cidrs";
      };
      access_config = {
        authentication_mode = "API";
        # Only the access entries below grant access, not whoever applied.
        bootstrap_cluster_creator_admin_permissions = false;
      };
      # The add-ons below are EKS-managed from the start.
      bootstrap_self_managed_addons = false;
      # At the end of standard support EKS upgrades the cluster instead of
      # moving it to extended support, which costs six times as much.
      upgrade_policy.support_type = "STANDARD";
      enabled_cluster_log_types = [
        "api"
        "audit"
        "authenticator"
      ];
      depends_on = [
        "aws_cloudwatch_log_group.cluster"
        "aws_iam_role_policy_attachment.cluster"
      ];
    };

    aws_eks_access_entry.admin = {
      cluster_name = ref "aws_eks_cluster.observability.name";
      principal_arn = ref "aws_iam_role.admin.arn";
      type = "STANDARD";
    };
    aws_eks_access_policy_association.admin = {
      cluster_name = ref "aws_eks_cluster.observability.name";
      principal_arn = ref "aws_eks_access_entry.admin.principal_arn";
      policy_arn = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy";
      access_scope.type = "cluster";
    };

    aws_eks_addon = {
      vpc_cni = addon "vpc_cni" {
        configuration_values = builtins.toJSON { enableNetworkPolicy = "true"; };
      };
      kube_proxy = addon "kube_proxy" { };
      pod_identity_agent = addon "pod_identity_agent" { };
      coredns = addon "coredns" { depends_on = [ "aws_eks_node_group.observability" ]; };
      ebs_csi = addon "ebs_csi" {
        pod_identity_association = {
          service_account = settings.serviceAccounts.ebsCsi.name;
          role_arn = ref "aws_iam_role.pod_ebsCsi.arn";
        };
        depends_on = [
          "aws_eks_node_group.observability"
          "aws_iam_role_policy_attachment.pod_ebsCsi"
        ];
      };
    };

    # IMDSv2 with hop limit 1: pods can't reach the node's instance role.
    aws_launch_template.node = {
      name = "observability-k8s-node";
      update_default_version = true;
      metadata_options = {
        http_endpoint = "enabled";
        http_tokens = "required";
        http_put_response_hop_limit = 1;
      };
      block_device_mappings = [
        {
          device_name = "/dev/xvda";
          ebs = {
            volume_type = "gp3";
            volume_size = cluster.nodes.diskGiB;
            encrypted = true;
            delete_on_termination = true;
          };
        }
      ];
      tag_specifications = [
        {
          resource_type = "instance";
          tags = settings.tags // {
            Name = "observability-k8s-node";
          };
        }
        {
          resource_type = "volume";
          tags = settings.tags;
        }
      ];
    };

    # One node per AZ: the group spans the three private subnets and the
    # Auto Scaling group balances across them. Updates surge a new node before
    # draining an old one, one at a time.
    aws_eks_node_group.observability = {
      cluster_name = ref "aws_eks_cluster.observability.name";
      node_group_name = "observability";
      node_role_arn = ref "aws_iam_role.node.arn";
      # Nodes follow the control plane in the same apply, one at a time.
      version = ref "aws_eks_cluster.observability.version";
      subnet_ids = ref "local.private_subnet_ids";
      ami_type = cluster.nodes.amiType;
      capacity_type = "ON_DEMAND";
      instance_types = [ cluster.nodes.instanceType ];
      scaling_config = {
        desired_size = cluster.nodes.count;
        min_size = cluster.nodes.count;
        max_size = cluster.nodes.count * 2;
      };
      update_config.max_unavailable = 1;
      launch_template = {
        id = ref "aws_launch_template.node.id";
        version = ref "aws_launch_template.node.latest_version";
      };
      depends_on = beforeNodes ++ [
        # Until these exist the new subnets use the main route table: no NAT.
        "aws_route_table_association.private_b"
        "aws_route_table_association.private_c"
        "aws_iam_role_policy_attachment.node_worker"
        "aws_iam_role_policy_attachment.node_cni"
        "aws_iam_role_policy_attachment.node_ecr"
        "aws_iam_role_policy_attachment.node_ssm"
      ];
    };
  };
}
