import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

// Prod projects whose ECS services also send to Grafana. Grafana takes every
// span before its own sampling, and prod emits about 37 times dev's, so add
// projects a few at a time while the cluster's ingest has headroom
// (infra/stacks/observability/README.md, "ECS dual export").
// To stop one, set it to `false`: that keeps its execution role's access to the
// token, which ECS needs to replace tasks of a revision that still has Alloy.
// Delete the entry after the revision without Alloy is steady.
const PROD_GRAFANA_PROJECTS: Record<string, boolean> = {
  'authentication-service': true,
  'calendar-service': true,
  'contacts-service': true,
  'convert-service': true,
  'image-proxy-service': true,
  'lexical-service': true,
  'notification-service': true,
  'static-file-service': true,
  'unfurl-service': true,
  'whatsapp-session-service': true,
};

const pulumiStack = pulumi.getStack();
const prodEnabled =
  pulumiStack === 'prod'
    ? PROD_GRAFANA_PROJECTS[pulumi.getProject()]
    : undefined;

// Every dev ECS service runs the shared telemetry sidecars.
export const grafanaTelemetryEnabled =
  pulumiStack === 'dev' || prodEnabled === true;

// Dev and prod share this ingestion-only token: it can write telemetry and
// read nothing. Never grant tasks the Grafana OAuth bundle.
export const grafanaIngestSecretArn =
  pulumiStack === 'dev' || prodEnabled !== undefined
    ? aws.secretsmanager.getSecretOutput({ name: 'observability/dev-ingest' })
        .arn
    : undefined;
