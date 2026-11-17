# CloudWatch alarms on the cluster's target groups, to the stack's alarm topic:
# the outside check that doesn't depend on anything in the cluster. They notify
# only when `settings.alarms.notify` is on (at cutover); before that they still
# change state and show in the console.
{ lib, settings, ... }:
let
  inherit (lib.tf) ref;
  topic = ref "data.aws_sns_topic.alarms.arn";
  alarm =
    name: extra:
    {
      namespace = "AWS/ApplicationELB";
      period = 60;
      evaluation_periods = 2;
      actions_enabled = settings.alarms.notify;
      alarm_actions = [ topic ];
      ok_actions = [ topic ];
      dimensions = {
        LoadBalancer = ref "data.aws_lb.observability.arn_suffix";
        TargetGroup = ref "aws_lb_target_group.${name}.arn_suffix";
      };
    }
    // extra;
  perHost =
    suffix: f:
    lib.mapAttrs' (name: host: lib.nameValuePair "${name}_${suffix}" (f name host)) settings.hosts;
in
{
  resource.aws_cloudwatch_metric_alarm =
    perHost "healthy" (
      name: host:
      alarm name {
        alarm_name = "observability-k8s-${name}-healthy";
        alarm_description = "No healthy edge nginx pod behind ${host.hostname}.";
        metric_name = "HealthyHostCount";
        statistic = "Minimum";
        comparison_operator = "LessThanThreshold";
        threshold = 1;
        # No data means no healthy target reported.
        treat_missing_data = "breaching";
      }
    )
    // perHost "5xx" (
      name: host:
      alarm name {
        alarm_name = "observability-k8s-${name}-5xx";
        alarm_description = "The cluster behind ${host.hostname} is returning 5xx responses.";
        metric_name = "HTTPCode_Target_5XX_Count";
        statistic = "Sum";
        period = 300;
        comparison_operator = "GreaterThanThreshold";
        threshold = settings.alarms.target5xxPer5Min;
        treat_missing_data = "notBreaching";
      }
    );
}
