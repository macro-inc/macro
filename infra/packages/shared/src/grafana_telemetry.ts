import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

// All dev ECS services run the shared telemetry sidecars. Production follows in a later rollout.
export const grafanaTelemetryEnabled = pulumi.getStack() === 'dev';

// Only the ingestion token is stored here; never grant tasks the Grafana OAuth bundle.
export const grafanaIngestSecretArn = grafanaTelemetryEnabled
  ? aws.secretsmanager.getSecretOutput({ name: 'observability/dev-ingest' }).arn
  : undefined;
