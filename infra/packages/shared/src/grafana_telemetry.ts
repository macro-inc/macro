import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

// All dev ECS services run the shared telemetry sidecars. Production follows in a later rollout.
export const grafanaTelemetryEnabled = pulumi.getStack() === 'dev';

// Only the ingestion token is stored here; never grant tasks the Grafana OAuth bundle.
export const grafanaIngestSecretArn = grafanaTelemetryEnabled
  ? aws.secretsmanager.getSecretOutput({ name: 'observability/dev-ingest' }).arn
  : undefined;

// Grafana's OTLP ingest (the observability cluster's edge), for collectors
// configured from Pulumi. The ECS sidecar's Alloy file has its own copy.
export const GRAFANA_OTLP_INGEST_URL = 'https://otlp.macro-internal.com';
