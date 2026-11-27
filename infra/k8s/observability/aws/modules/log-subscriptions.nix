# The second subscription filter on production log groups no Pulumi stack
# owns (`settings.firehose.unownedLogGroups`), to the Firehose stream in
# ./firehose.nix. Datadog's filter on each group stays as it is. Removing a
# group from the list deletes only this filter.
{ lib, settings, ... }:
let
  inherit (lib.tf) ref;
  fh = settings.firehose;
  key = group: lib.replaceStrings [ "/" "." ] [ "_" "_" ] (lib.removePrefix "/aws/lambda/" group);
in
{
  resource.aws_cloudwatch_log_subscription_filter = lib.mapAttrs' (
    group: pattern:
    lib.nameValuePair (key group) {
      provider = "aws.production";
      name = "grafana";
      log_group_name = group;
      filter_pattern = pattern;
      destination_arn = ref "aws_kinesis_firehose_delivery_stream.cloudwatch_logs.arn";
      role_arn = ref "aws_iam_role.cloudwatch_to_firehose.arn";
      # The role's policy must exist before CloudWatch Logs checks it.
      depends_on = [ "aws_iam_role_policy.cloudwatch_to_firehose" ];
    }
  ) fh.unownedLogGroups;
}
