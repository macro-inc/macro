# One IAM role per service account, bound with EKS Pod Identity. The same
# least-privilege split as the host's systemd units: each backend reaches only
# its own bucket. Loki and Tempo may also use the host's bucket of their kind,
# which they take over at the switch.
{ lib, settings, ... }:
let
  inherit (lib.tf) ref;
  iam = import ./iam.nix;
  sa = settings.serviceAccounts;

  newBucket = name: ref "aws_s3_bucket.${name}.arn";
  hostBucket = kind: ref "local.host_bucket_arns.${kind}";
  bucketAccess = arns: [
    {
      Effect = "Allow";
      Action = [
        "s3:ListBucket"
        "s3:GetBucketLocation"
        "s3:ListBucketMultipartUploads"
      ];
      Resource = arns;
    }
    {
      Effect = "Allow";
      Action = [
        "s3:GetObject"
        "s3:PutObject"
        "s3:DeleteObject"
        "s3:AbortMultipartUpload"
        "s3:ListMultipartUploadParts"
      ];
      Resource = map (arn: "${arn}/*") arns;
    }
  ];

  # Inline policy per role; `null` for a role that only takes a managed policy.
  policies = {
    loki = bucketAccess [
      (newBucket "loki")
      (hostBucket "logs")
    ];
    tempo = bucketAccess [
      (newBucket "tempo")
      (hostBucket "traces")
    ];
    mimir = bucketAccess [ (newBucket "mimir") ];

    # As the host's Grafana: CloudWatch reads for the prod alert rules and
    # dashboards (prod is us-east-1), and the team email contact point.
    grafana = [
      {
        Effect = "Allow";
        Action = [
          "cloudwatch:ListMetrics"
          "cloudwatch:GetMetricData"
          "cloudwatch:GetMetricStatistics"
        ];
        Resource = "*";
        Condition.StringEquals."aws:RequestedRegion" = [
          "us-east-1"
          "us-east-2"
        ];
      }
      {
        Effect = "Allow";
        Action = [ "sns:Publish" ];
        Resource = ref "data.aws_sns_topic.alarms.arn";
      }
    ];

    externalSecrets = [
      {
        Effect = "Allow";
        Action = [
          "secretsmanager:GetSecretValue"
          "secretsmanager:DescribeSecret"
        ];
        Resource = [
          (ref "data.aws_secretsmanager_secret.observability.arn")
          (ref "aws_db_instance.grafana.master_user_secret[0].secret_arn")
          "arn:aws:secretsmanager:${settings.region}:${settings.accountId}:secret:${settings.clusterSecretPrefix}*"
        ];
      }
    ];

    # Only TargetGroupBinding: register and deregister pod IPs in this
    # layer's target groups. The controller creates no load balancers, and
    # the security group rules for ALB -> pods are in modules/edge.nix.
    loadBalancerController = [
      {
        Effect = "Allow";
        Action = [
          "elasticloadbalancing:Describe*"
          "ec2:DescribeAvailabilityZones"
          "ec2:DescribeInstances"
          "ec2:DescribeNetworkInterfaces"
          "ec2:DescribeSecurityGroups"
          "ec2:DescribeSubnets"
          "ec2:DescribeVpcs"
        ];
        Resource = "*";
      }
      {
        Effect = "Allow";
        Action = [
          "elasticloadbalancing:RegisterTargets"
          "elasticloadbalancing:DeregisterTargets"
        ];
        Resource = lib.mapAttrsToList (name: _: ref "aws_lb_target_group.${name}.arn") settings.hosts;
      }
    ];

    ebsCsi = null;
  };

  roleName = key: "observability-k8s-${sa.${key}.name}";

  role = key: {
    name = roleName key;
    assume_role_policy = builtins.toJSON {
      Version = "2012-10-17";
      Statement = [
        {
          Effect = "Allow";
          Principal.Service = "pods.eks.amazonaws.com";
          Action = [
            "sts:AssumeRole"
            "sts:TagSession"
          ];
          # Pod Identity's session tags: only this cluster's one service
          # account can take the role, even if another association named it.
          Condition.StringEquals = {
            "aws:RequestTag/eks-cluster-arn" =
              "arn:aws:eks:${settings.region}:${settings.accountId}:cluster/${settings.cluster.name}";
            "aws:RequestTag/kubernetes-namespace" = sa.${key}.namespace;
            "aws:RequestTag/kubernetes-service-account" = sa.${key}.name;
          };
        }
      ];
    };
  };

  forRoles = f: lib.mapAttrs' (key: value: lib.nameValuePair "pod_${key}" (f key value));
in
{
  resource = {
    aws_iam_role = forRoles (key: _: role key) sa;

    aws_iam_role_policy = forRoles (key: statements: {
      name = roleName key;
      role = ref "aws_iam_role.pod_${key}.id";
      policy = builtins.toJSON (iam.policy statements);
    }) (lib.filterAttrs (_: statements: statements != null) policies);

    aws_iam_role_policy_attachment.pod_ebsCsi = {
      role = ref "aws_iam_role.pod_ebsCsi.name";
      policy_arn = iam.managed "service-role/AmazonEBSCSIDriverPolicy";
    };

    # The EBS CSI driver's association is made by its add-on (modules/eks.nix).
    aws_eks_pod_identity_association = forRoles (key: account: {
      cluster_name = ref "aws_eks_cluster.observability.name";
      inherit (account) namespace;
      service_account = account.name;
      role_arn = ref "aws_iam_role.pod_${key}.arn";
    }) (removeAttrs sa [ "ebsCsi" ]);
  };
}
