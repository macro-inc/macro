# What the cluster layer (infra/k8s/observability/cluster) needs from this one.
# None of it is secret. `nix run .#tofu -- main output` prints it after apply.
{ lib, settings, ... }:
let
  inherit (lib.tf) ref;
  out = description: value: { inherit description value; };
in
{
  output = {
    region = out "AWS region of the cluster and its resources." settings.region;
    vpc_id = out "The observability VPC (owned by the Pulumi stack)." (
      ref "data.aws_vpc.observability.id"
    );
    cluster_name = out "EKS cluster name." (ref "aws_eks_cluster.observability.name");
    cluster_endpoint = out "EKS API endpoint." (ref "aws_eks_cluster.observability.endpoint");
    admin_role_arn = out "The cluster admin role (README, \"Cluster access\")." (
      ref "aws_iam_role.admin.arn"
    );
    cluster_security_group_id = out "Security group on the nodes and pods." (
      ref "aws_eks_cluster.observability.vpc_config[0].cluster_security_group_id"
    );
    edge_zones = out "Zones the edge nginx pods must run in (the ALB's zones)." settings.existing.albZones;
    alb_source_cidrs = out "Where ALB traffic and health checks to the pods come from (allow in NetworkPolicy)." settings.existing.albSubnetCidrs;
    target_group_arns = out "TargetGroupBinding targets, by host." (
      lib.mapAttrs (name: _: ref "aws_lb_target_group.${name}.arn") settings.hosts
    );
    buckets = out "Object storage bucket per backend, used until the switch (Mimir's for good)." (
      lib.mapAttrs (name: _: ref "aws_s3_bucket.${name}.bucket") settings.buckets
    );
    host_buckets =
      out
        "The host's Loki (`logs`) and Tempo (`traces`) buckets, which Loki and Tempo take over at the switch."
        (
          lib.mapAttrs (
            kind: _: ref "trimprefix(local.host_bucket_arns.${kind}, \"arn:aws:s3:::\")"
          ) settings.existing.bucketPrefixes
        );
    pod_identity_role_arns = out "Role bound to each service account." (
      lib.mapAttrs' (
        key: account:
        lib.nameValuePair "${account.namespace}/${account.name}" (ref "aws_iam_role.pod_${key}.arn")
      ) settings.serviceAccounts
    );
    grafana_db_address = out "Grafana's Postgres host." (ref "aws_db_instance.grafana.address");
    grafana_db_port = out "Grafana's Postgres port." (ref "aws_db_instance.grafana.port");
    grafana_db_name = out "Grafana's database name." settings.grafanaDb.name;
    grafana_db_secret_arn = out "RDS-managed Secrets Manager secret holding Grafana's database username and password." (
      ref "aws_db_instance.grafana.master_user_secret[0].secret_arn"
    );
    observability_secret_arn = out "The host's secret bundle, read by External Secrets." (
      ref "data.aws_secretsmanager_secret.observability.arn"
    );
  };
}
