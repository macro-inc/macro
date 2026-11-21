# New buckets for Loki, Tempo and Mimir, configured as the host's telemetry
# buckets: private, encrypted, TLS only, and no expiry rule (each backend owns
# its own retention; an S3 lifecycle rule would delete live blocks).
{ lib, settings, ... }:
let
  inherit (lib.tf) ref;
  bucketRef = name: attr: ref "aws_s3_bucket.${name}.${attr}";
  forBuckets = f: lib.mapAttrs f settings.buckets;

  # While `mimirBackfill.enable` is on the host copies its Prometheus blocks
  # straight into Mimir's bucket (settings.nix): its role may list and write
  # Mimir's tenant prefix, nothing else.
  backfill = settings.mimirBackfill;
  backfillStatements = lib.optionals backfill.enable [
    {
      Sid = "HostBackfillList";
      Effect = "Allow";
      Principal.AWS = ref "local.host_role_arn";
      Action = "s3:ListBucket";
      Resource = bucketRef "mimir" "arn";
      Condition.StringLike."s3:prefix" = [ "${backfill.prefix}*" ];
    }
    {
      Sid = "HostBackfillWrite";
      Effect = "Allow";
      Principal.AWS = ref "local.host_role_arn";
      Action = [
        "s3:PutObject"
        "s3:AbortMultipartUpload"
        "s3:ListMultipartUploadParts"
      ];
      Resource = "${bucketRef "mimir" "arn"}/${backfill.prefix}*";
    }
  ];
in
{
  resource = {
    aws_s3_bucket = forBuckets (
      _: bucket: {
        inherit bucket;
        force_destroy = false;
        lifecycle.prevent_destroy = true;
      }
    );

    aws_s3_bucket_ownership_controls = forBuckets (
      name: _: {
        bucket = bucketRef name "id";
        rule.object_ownership = "BucketOwnerEnforced";
      }
    );

    aws_s3_bucket_public_access_block = forBuckets (
      name: _: {
        bucket = bucketRef name "id";
        block_public_acls = true;
        block_public_policy = true;
        ignore_public_acls = true;
        restrict_public_buckets = true;
      }
    );

    aws_s3_bucket_server_side_encryption_configuration = forBuckets (
      name: _: {
        bucket = bucketRef name "id";
        rule = [ { apply_server_side_encryption_by_default.sse_algorithm = "AES256"; } ];
      }
    );

    aws_s3_bucket_policy = forBuckets (
      name: _: {
        bucket = bucketRef name "id";
        policy = builtins.toJSON {
          Version = "2012-10-17";
          Statement = [
            {
              Sid = "DenyInsecureTransport";
              Effect = "Deny";
              Principal = "*";
              Action = "s3:*";
              Resource = [
                (bucketRef name "arn")
                "${bucketRef name "arn"}/*"
              ];
              Condition.Bool."aws:SecureTransport" = "false";
            }
          ]
          ++ lib.optionals (name == "mimir") backfillStatements;
        };
        depends_on = [ "aws_s3_bucket_public_access_block.${name}" ];
      }
    );

    aws_s3_bucket_lifecycle_configuration = forBuckets (
      name: _: {
        bucket = bucketRef name "id";
        rule = [
          {
            id = "abort-incomplete-uploads";
            status = "Enabled";
            filter.prefix = "";
            abort_incomplete_multipart_upload.days_after_initiation = 1;
          }
        ];
      }
    );
  };
}
