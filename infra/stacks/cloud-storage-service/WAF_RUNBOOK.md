# Cloud Storage WAF Adoption

The production WAF component adopts the existing Web ACL, ALB association, CloudWatch log group, and WAF logging configuration through Pulumi resource `import` options. These resources are also protected. The existing ALB is already managed by the cloud-storage-service stack, and the existing Datadog Forwarder and `ip_safety` rule group are referenced by ARN rather than duplicated.

## Resource Configuration

`Pulumi.prod.yaml` supplies `waf_account_id`, `waf_web_acl_name`, `waf_web_acl_id`, `waf_alb_arn`, `waf_ip_safety_rule_group_arn`, `waf_log_group_name`, and `waf_datadog_forwarder_arn` in the `cloud-storage-service` namespace. The region comes from the existing `aws:region` setting. The component derives the Web ACL ARN from that configuration and uses the configured ACL name in the Datadog pipeline filter and its parser sample.

Pulumi requires a plain string for import IDs, so the association import uses `waf_alb_arn`. The component checks that it matches `cloudStorageService.lb.arn`, the load balancer already managed by this stack, before registering the association. A mismatch fails the preview or update instead of importing an association for a different ALB. WAF configuration is read only when the production component is instantiated; other stacks do not need these keys.

## First Deployment

1. Run `pulumi preview --stack prod` from `infra/stacks/cloud-storage-service` with credentials for the configured `waf_account_id` and Datadog US5.
2. Confirm the Web ACL, association, log group, and logging configuration are imports followed only by in-place updates. Do not proceed if Pulumi proposes a replacement or deletion for any of them.
3. Confirm the association targets the stack-managed `cloudStorageService.lb.arn` and that this is the ALB currently associated with the configured Web ACL.
4. Confirm the existing Lambda policy has no statement named `AllowCloudWatchLogsAwsWafProd`. If it does, import that permission before deployment or rename the statement only after determining ownership.
5. Confirm the log group has capacity for another subscription filter and no existing filter already sends these events to the same Forwarder. CloudWatch subscriptions process only events written after the filter is created; this configuration does not replay retained logs.
6. Review the intended in-place policy changes explicitly: sensitive headers, query strings, URI paths, bodies, and SQL/XSS match details become protected; sampled requests are disabled; Bot Control HTTP-library exceptions become non-terminating counts; and `SQLi_BODY` becomes a label that is blocked everywhere except the exact channel-message POST route. Non-body SQLi rules remain active on that route.

Do not run a separate `pulumi import`: the configuration-derived import IDs in `waf-observability.ts` perform adoption on the first update and remain harmless after the resources are in stack state.

## Datadog Pipeline Order

`LogsPipelineOrder` represents the complete organization-global pipeline order. The stack reads the current order during deployment, removes any existing occurrence of this pipeline, and prepends it. This preserves unrelated pipeline IDs while ensuring its trace, span, and service remappers run before other matching pipelines.

Before the first deployment, confirm no other Pulumi stack manages the singleton Datadog pipeline-order resource. Then:

1. Verify that Datadog placed `Macro Cloud Storage AWS WAF` first in the pipeline order and that matching sample logs are processed.
2. Verify all pre-existing pipeline IDs remain in their original relative order.
3. Coordinate pipeline-order deployments because the Datadog API exposes one organization-global order; concurrent external edits can race an update.

The pipeline filter includes the production Web ACL name so it does not remap unrelated WAF logs. It parses WAF JSON, extracts W3C `traceparent` IDs as lowercase 32-character trace IDs and 16-character span IDs, and uses the trace, span, and service remappers supported by the installed Datadog provider.
