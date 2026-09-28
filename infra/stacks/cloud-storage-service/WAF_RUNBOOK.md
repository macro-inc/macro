# Cloud Storage WAF Adoption

The production WAF component manages the existing Web ACL, CloudWatch log group, and WAF logging configuration. They were adopted, with their parent component, in [production update #336](https://app.pulumi.com/macro-inc/cloud-storage-service/prod/updates/336) on 2026-09-28 and are protected from deletion. The existing Datadog Forwarder and `ip_safety` rule group are referenced by ARN rather than duplicated. ALB associations are outside this component.

## Current Coverage

A read-only AWS check on 2026-09-28 found no WAF association on the production shared gateway ALB. The configured Web ACL remains associated with the document-processing, document-cognition, and static-file-service ALBs. The old cloud-storage-service ALB association no longer exists and must not be imported.

This component observes requests evaluated by the existing Web ACL; it does not add WAF coverage to the shared gateway. Recheck attachments before deployment. Attaching a WAF to the shared gateway affects multiple services and requires a separate policy review and rollout.

## Correlation

The existing browser `safeFetch` instrumentation already sends W3C `traceparent` headers to Macro services. This component extracts those trace and span IDs from WAF events so a block or challenge can be linked to its browser request without a backend span. No fetch, retry, request-ID, or CORS behavior changes are needed.

Browser telemetry must be enabled for the affected user (`enable-browser-otel` or its build override), and the browser trace must reach Datadog. Deploy this production-only component and verify a new WAF event links to the corresponding trace; merging to main deploys dev and does not enable the production WAF pipeline by itself.

## Resource Configuration

`Pulumi.prod.yaml` supplies `waf_account_id`, `waf_web_acl_name`, `waf_web_acl_id`, `waf_ip_safety_rule_group_arn`, `waf_log_group_name`, and `waf_datadog_forwarder_arn` in the `cloud-storage-service` namespace. The region comes from the existing `aws:region` setting. The component derives the Web ACL ARN from that configuration and uses the derived ARN in the Datadog pipeline filter.

WAF configuration is read only when the production component is instantiated; other stacks do not need these keys.

## Deployment After Adoption

1. Run `pulumi preview --stack prod` from `infra/stacks/cloud-storage-service` with credentials for the configured `waf_account_id` and Datadog US5.
2. Confirm the Web ACL, log group, and logging configuration have only in-place updates or no changes. Do not proceed if Pulumi proposes a replacement or deletion for any of them.
3. Confirm the Web ACL is still attached to the intended ALBs using `aws wafv2 list-resources-for-web-acl`. This stack does not create or change associations.
4. Confirm the Forwarder permission `AllowCloudWatchLogsAwsWafProd` and log subscription remain managed by this component. Do not create duplicate permissions or subscriptions.
5. Confirm the log group has exactly one subscription sending these events to the configured Forwarder. CloudWatch subscriptions process only events written after the filter is created; this configuration does not replay retained logs.
6. Review the intended in-place policy changes explicitly: request bodies, sensitive headers, and query strings receive data protection; URI paths, query strings, and sensitive headers are configured for logging redaction; sampled requests are disabled; both `CategoryHttpLibrary` and `SignalNonBrowserUserAgent` become non-terminating counts; and `SQLi_BODY` becomes a label that is blocked everywhere except the exact channel-message POST route. Non-body SQLi rules remain active on that route.
7. Confirm CloudWatch log retention is unchanged. The component reads and preserves the existing log group retention instead of imposing a new retention period.

The one-time `import` options have been removed now that the resources are in production state. The Web ACL importer accepts `id/name/scope`, but stores only the UUID as the resource ID; retaining that composite import option after CLI adoption makes Pulumi propose a replacement. Existing resources must retain their current logical names and component parent.

## Datadog Pipeline Order

`LogsPipelineOrder` represents the complete organization-global pipeline order. The stack reads the current order during deployment, removes any existing occurrence of this pipeline, and prepends it. This preserves unrelated pipeline IDs while ensuring its trace, span, and service remappers run before other matching pipelines.

Before the first deployment, confirm no other Pulumi stack manages the singleton Datadog pipeline-order resource. Then:

1. Verify that Datadog placed `Macro Cloud Storage AWS WAF` first in the pipeline order and that matching sample logs are processed.
2. Verify all pre-existing pipeline IDs remain in their original relative order.
3. Coordinate pipeline-order deployments because the Datadog API exposes one organization-global order; concurrent external edits can race an update.

The Forwarder delivers WAF events as structured JSON attributes, without a raw `message`. The pipeline matches the exact production `webaclId`, selects the `traceparent` value from `httpRequest.headers` using an array processor, and parses W3C `traceparent` IDs as lowercase 32-character trace IDs and 16-character span IDs, and uses the trace, span, and service remappers supported by the installed Datadog provider.

## Production Verification

Production updates [#337](https://app.pulumi.com/macro-inc/cloud-storage-service/prod/updates/337) and [#338](https://app.pulumi.com/macro-inc/cloud-storage-service/prod/updates/338) enabled forwarding and corrected the pipeline for structured Forwarder events. A controlled SQLi query against the WAF-protected static-file ALB returned 403, reached Datadog, and was searchable by its W3C `trace_id` and `span_id`. Authorization and query data were redacted. The subsequent scoped preview reported 141 unchanged resources.

[AWS logging redaction depends on the rule's match component](https://docs.aws.amazon.com/waf/latest/developerguide/logging-management.html): configuring `UriPath` does not guarantee that every event hides its path. The verification event retained `/`. Body, sensitive-header, and query-string data protection are configured separately at Web ACL level. This test verifies trace metadata on the log; it does not verify linkage to an exported browser span.
