# CloudWatch Logs to Loki: an Amazon Data Firehose stream in production's region
# (`settings.firehose`) that posts to the cluster's edge, and the role
# CloudWatch Logs uses to write to it. Log groups opt in with a subscription
# filter whose destination is `firehose_stream_arn` and role
# `cloudwatch_logs_role_arn` (outputs.nix); a log group takes two filters, and
# today's take one (Datadog's). Pulumi's Lambda component adds them for the
# groups a stack owns; ./log-subscriptions.nix for the ones no stack owns.
#
# Nothing flows until a log group subscribes and the access key secret has a
# value (README "Secrets"). Without one, every post is refused and lands in
# the failed-records bucket.
{ lib, settings, ... }:
let
  inherit (lib.tf) ref;
  iam = import ./iam.nix;
  fh = settings.firehose;
  provider = "aws.production";
  account = settings.accountId;
  bucketArn = ref "aws_s3_bucket.firehose_failed.arn";
  logGroup = "/aws/kinesisfirehose/${fh.stream}";
in
{
  resource = {
    # Firehose's HTTP endpoint key, as `{"api_key": "<OTLP token>"}`; the value
    # is set by hand, never here.
    aws_secretsmanager_secret.firehose_access_key = {
      inherit provider;
      name = fh.secret;
      description = "Amazon Data Firehose access key for the observability cluster's edge: {\"api_key\": OTLP token}; source Doppler observability/prd OTLP_TOKEN";
    };

    # Records Firehose gave up on. Private, encrypted, TLS only, expiring.
    aws_s3_bucket.firehose_failed = {
      inherit provider;
      bucket = fh.failedBucket;
      lifecycle.prevent_destroy = true;
    };
    aws_s3_bucket_ownership_controls.firehose_failed = {
      inherit provider;
      bucket = ref "aws_s3_bucket.firehose_failed.id";
      rule.object_ownership = "BucketOwnerEnforced";
    };
    aws_s3_bucket_public_access_block.firehose_failed = {
      inherit provider;
      bucket = ref "aws_s3_bucket.firehose_failed.id";
      block_public_acls = true;
      block_public_policy = true;
      ignore_public_acls = true;
      restrict_public_buckets = true;
    };
    aws_s3_bucket_server_side_encryption_configuration.firehose_failed = {
      inherit provider;
      bucket = ref "aws_s3_bucket.firehose_failed.id";
      rule = [ { apply_server_side_encryption_by_default.sse_algorithm = "AES256"; } ];
    };
    aws_s3_bucket_lifecycle_configuration.firehose_failed = {
      inherit provider;
      bucket = ref "aws_s3_bucket.firehose_failed.id";
      rule = [
        {
          id = "expire";
          status = "Enabled";
          filter = { };
          expiration.days = fh.failedDays;
          abort_incomplete_multipart_upload.days_after_initiation = 1;
        }
      ];
    };
    aws_s3_bucket_policy.firehose_failed = {
      inherit provider;
      bucket = ref "aws_s3_bucket.firehose_failed.id";
      policy = builtins.toJSON {
        Version = "2012-10-17";
        Statement = [
          {
            Sid = "DenyInsecureTransport";
            Effect = "Deny";
            Principal = "*";
            Action = "s3:*";
            Resource = [
              bucketArn
              "${bucketArn}/*"
            ];
            Condition.Bool."aws:SecureTransport" = "false";
          }
        ];
      };
    };

    # Firehose's own delivery errors (refused posts, timeouts).
    aws_cloudwatch_log_group.firehose = {
      inherit provider;
      name = logGroup;
      retention_in_days = fh.errorLogDays;
    };
    aws_cloudwatch_log_stream = {
      firehose_delivery = {
        inherit provider;
        name = "DestinationDelivery";
        log_group_name = ref "aws_cloudwatch_log_group.firehose.name";
      };
      firehose_backup = {
        inherit provider;
        name = "BackupDelivery";
        log_group_name = ref "aws_cloudwatch_log_group.firehose.name";
      };
    };

    aws_iam_role = {
      firehose = {
        name = "observability-k8s-firehose-delivery";
        assume_role_policy = builtins.toJSON {
          Version = "2012-10-17";
          Statement = [
            {
              Effect = "Allow";
              Principal.Service = "firehose.amazonaws.com";
              Action = "sts:AssumeRole";
              Condition.StringEquals."aws:SourceAccount" = account;
            }
          ];
        };
      };
      # CloudWatch Logs takes this role to write a subscribed group's events.
      cloudwatch_to_firehose = {
        name = "observability-k8s-cloudwatch-logs";
        assume_role_policy = builtins.toJSON {
          Version = "2012-10-17";
          Statement = [
            {
              Effect = "Allow";
              Principal.Service = "logs.amazonaws.com";
              Action = "sts:AssumeRole";
              Condition.StringLike."aws:SourceArn" = "arn:aws:logs:${fh.region}:${account}:*";
            }
          ];
        };
      };
    };

    aws_iam_role_policy = {
      firehose = {
        name = "delivery";
        role = ref "aws_iam_role.firehose.id";
        policy = builtins.toJSON (
          iam.policy [
            {
              Effect = "Allow";
              Action = [
                "s3:GetBucketLocation"
                "s3:ListBucket"
                "s3:ListBucketMultipartUploads"
              ];
              Resource = bucketArn;
            }
            {
              Effect = "Allow";
              Action = [
                "s3:PutObject"
                "s3:AbortMultipartUpload"
              ];
              Resource = "${bucketArn}/*";
            }
            {
              Effect = "Allow";
              Action = "secretsmanager:GetSecretValue";
              Resource = ref "aws_secretsmanager_secret.firehose_access_key.arn";
            }
            {
              Effect = "Allow";
              Action = "logs:PutLogEvents";
              Resource = "arn:aws:logs:${fh.region}:${account}:log-group:${logGroup}:*";
            }
          ]
        );
      };
      cloudwatch_to_firehose = {
        name = "put-records";
        role = ref "aws_iam_role.cloudwatch_to_firehose.id";
        policy = builtins.toJSON (
          iam.policy [
            {
              Effect = "Allow";
              Action = [
                "firehose:PutRecord"
                "firehose:PutRecordBatch"
              ];
              Resource = ref "aws_kinesis_firehose_delivery_stream.cloudwatch_logs.arn";
            }
          ]
        );
      };
    };

    aws_kinesis_firehose_delivery_stream.cloudwatch_logs = {
      inherit provider;
      name = fh.stream;
      destination = "http_endpoint";
      server_side_encryption = {
        enabled = true;
        key_type = "AWS_OWNED_CMK";
      };
      http_endpoint_configuration = {
        inherit (fh) url;
        name = "Observability cluster";
        role_arn = ref "aws_iam_role.firehose.arn";
        buffering_size = fh.bufferMiB;
        buffering_interval = fh.bufferSeconds;
        retry_duration = fh.retrySeconds;
        s3_backup_mode = "FailedDataOnly";
        request_configuration.content_encoding = "GZIP";
        secrets_manager_configuration = {
          enabled = true;
          secret_arn = ref "aws_secretsmanager_secret.firehose_access_key.arn";
          role_arn = ref "aws_iam_role.firehose.arn";
        };
        cloudwatch_logging_options = {
          enabled = true;
          log_group_name = ref "aws_cloudwatch_log_group.firehose.name";
          log_stream_name = ref "aws_cloudwatch_log_stream.firehose_delivery.name";
        };
        s3_configuration = {
          role_arn = ref "aws_iam_role.firehose.arn";
          bucket_arn = bucketArn;
          compression_format = "GZIP";
          error_output_prefix = "errors/";
          cloudwatch_logging_options = {
            enabled = true;
            log_group_name = ref "aws_cloudwatch_log_group.firehose.name";
            log_stream_name = ref "aws_cloudwatch_log_stream.firehose_backup.name";
          };
        };
      };
      # The role's policy must exist before Firehose checks it can write.
      depends_on = [ "aws_iam_role_policy.firehose" ];
    };
  };
}
