# Grafana's database: RDS Postgres, Multi-AZ, reachable only from the cluster.
# RDS generates the master password and keeps it in a Secrets Manager secret it
# manages, so no password is in this config or its state; External Secrets
# reads that secret into the cluster.
{ lib, settings, ... }:
let
  inherit (lib.tf) ref;
  db = settings.grafanaDb;
in
{
  resource = {
    aws_db_subnet_group.grafana = {
      name = db.identifier;
      subnet_ids = ref "local.private_subnet_ids";
    };

    aws_security_group.grafana_db = {
      name = "${db.identifier}-db";
      description = "Grafana Postgres; only the EKS cluster pods and nodes";
      vpc_id = ref "data.aws_vpc.observability.id";
    };
    aws_vpc_security_group_ingress_rule.grafana_db_from_cluster = {
      security_group_id = ref "aws_security_group.grafana_db.id";
      referenced_security_group_id = ref "aws_eks_cluster.observability.vpc_config[0].cluster_security_group_id";
      ip_protocol = "tcp";
      from_port = 5432;
      to_port = 5432;
      description = "Postgres from the EKS cluster security group";
    };

    aws_db_instance.grafana = {
      inherit (db) identifier;
      engine = "postgres";
      engine_version = db.engineVersion;
      instance_class = db.instanceClass;
      allocated_storage = db.storageGiB;
      storage_type = "gp3";
      storage_encrypted = true;
      multi_az = true;
      db_name = db.name;
      username = db.username;
      manage_master_user_password = true;
      db_subnet_group_name = ref "aws_db_subnet_group.grafana.name";
      vpc_security_group_ids = [ (ref "aws_security_group.grafana_db.id") ];
      publicly_accessible = false;
      auto_minor_version_upgrade = true;
      backup_retention_period = 7;
      backup_window = "03:00-03:30";
      maintenance_window = "sun:04:00-sun:04:30";
      copy_tags_to_snapshot = true;
      deletion_protection = true;
      skip_final_snapshot = false;
      final_snapshot_identifier = "${db.identifier}-final";
      # Changes wait for the maintenance window unless applied by hand.
      apply_immediately = false;
      lifecycle.prevent_destroy = true;
    };

    # The RDS-managed secret keeps managed rotation (no Lambda); this only
    # sets its schedule, without rotating now.
    aws_secretsmanager_secret_rotation.grafana_db = {
      secret_id = ref "aws_db_instance.grafana.master_user_secret[0].secret_arn";
      rotate_immediately = false;
      rotation_rules = {
        schedule_expression = db.passwordRotation.schedule;
        duration = db.passwordRotation.window;
      };
    };
  };
}
