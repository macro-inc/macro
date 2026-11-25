import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

// Prod projects whose ECS services also send to Grafana. Grafana takes every
// span before its own sampling, and prod emits about 37 times dev's, so add
// projects a few at a time while the cluster's ingest has headroom
// (infra/stacks/observability/README.md, "ECS dual export").
const PROD_GRAFANA_PROJECTS = [
  'contacts-service',
  'image-proxy-service',
  'notification-service',
  'whatsapp-session-service',
];

const pulumiStack = pulumi.getStack();

// Every dev ECS service runs the shared telemetry sidecars.
export const grafanaTelemetryEnabled =
  pulumiStack === 'dev' ||
  (pulumiStack === 'prod' &&
    PROD_GRAFANA_PROJECTS.includes(pulumi.getProject()));

// Dev and prod share this ingestion-only token: it can write telemetry and
// read nothing. Never grant tasks the Grafana OAuth bundle.
export const grafanaIngestSecretArn = grafanaTelemetryEnabled
  ? aws.secretsmanager.getSecretOutput({ name: 'observability/dev-ingest' }).arn
  : undefined;
