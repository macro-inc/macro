import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

export const grafanaTelemetryEnabled =
  new pulumi.Config().getBoolean('grafanaTelemetryEnabled') ?? false;

if (grafanaTelemetryEnabled && pulumi.getStack() !== 'dev') {
  throw new Error('Grafana dual export is currently limited to dev');
}

// Only the ingestion token is stored here; never grant tasks the Grafana OAuth bundle.
export const grafanaIngestSecretArn = grafanaTelemetryEnabled
  ? aws.secretsmanager.getSecretOutput({ name: 'observability/dev-ingest' }).arn
  : undefined;
