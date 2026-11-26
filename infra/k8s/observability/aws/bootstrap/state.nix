# The bucket that holds this layer's OpenTofu state, including this config's
# own. The first apply runs with local state and then moves it into the bucket
# (`nix run .#bootstrap`, README "First apply").
{ lib, settings, ... }:
let
  inherit (lib.tf) ref;
  bucket = attr: ref "aws_s3_bucket.state.${attr}";
in
{
  resource = {
    aws_s3_bucket.state = {
      inherit (settings.state) bucket;
      force_destroy = false;
      lifecycle.prevent_destroy = true;
    };

    aws_s3_bucket_ownership_controls.state = {
      bucket = bucket "id";
      rule.object_ownership = "BucketOwnerEnforced";
    };

    aws_s3_bucket_public_access_block.state = {
      bucket = bucket "id";
      block_public_acls = true;
      block_public_policy = true;
      ignore_public_acls = true;
      restrict_public_buckets = true;
    };

    # Every state write is a new version: a bad apply can be rolled back.
    aws_s3_bucket_versioning.state = {
      bucket = bucket "id";
      versioning_configuration.status = "Enabled";
    };

    aws_s3_bucket_server_side_encryption_configuration.state = {
      bucket = bucket "id";
      rule = [ { apply_server_side_encryption_by_default.sse_algorithm = "AES256"; } ];
    };

    aws_s3_bucket_lifecycle_configuration.state = {
      bucket = bucket "id";
      rule = [
        {
          id = "expire-old-versions";
          status = "Enabled";
          filter.prefix = "";
          noncurrent_version_expiration = {
            noncurrent_days = 90;
            newer_noncurrent_versions = 20;
          };
          abort_incomplete_multipart_upload.days_after_initiation = 1;
        }
      ];
      depends_on = [ "aws_s3_bucket_versioning.state" ];
    };

    aws_s3_bucket_policy.state = {
      bucket = bucket "id";
      policy = builtins.toJSON {
        Version = "2012-10-17";
        Statement = [
          {
            Sid = "DenyInsecureTransport";
            Effect = "Deny";
            Principal = "*";
            Action = "s3:*";
            Resource = [
              (bucket "arn")
              "${bucket "arn"}/*"
            ];
            Condition.Bool."aws:SecureTransport" = "false";
          }
        ];
      };
      depends_on = [ "aws_s3_bucket_public_access_block.state" ];
    };
  };

  output.state_bucket.value = bucket "bucket";
}
