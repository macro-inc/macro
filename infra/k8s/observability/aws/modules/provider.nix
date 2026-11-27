# OpenTofu, the AWS provider and the S3 state backend. `stateKey` picks the
# state object; `null` keeps the state local (the bootstrap's first apply only).
{
  lib,
  pkgs,
  settings,
  stateKey,
  ...
}:
{
  terraform = {
    required_version = ">= 1.10";
    # The flake provides the provider binary; this pins it to the same version
    # so `tofu init` never downloads another one.
    required_providers.aws = {
      source = "hashicorp/aws";
      version = "= ${pkgs.terraform-providers.hashicorp_aws.version}";
    };
    backend = lib.mkIf (stateKey != null) {
      s3 = {
        inherit (settings) region;
        bucket = settings.state.bucket;
        key = stateKey;
        encrypt = true;
        # OpenTofu's native S3 lock: a `.tflock` object next to the state.
        use_lockfile = true;
      };
    };
  };

  provider.aws = {
    inherit (settings) region;
    allowed_account_ids = [ settings.accountId ];
    default_tags.tags = settings.tags;
  };
}
