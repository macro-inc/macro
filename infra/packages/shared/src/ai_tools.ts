import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '../../shared';

/**
 * Infrastructure wiring required by services that host the `ai_tools` crate
 * (see `crates/ai_tools/src/build_context.rs`). Callers spread
 * these into their service's IAM role and container environment alongside any
 * service-specific values.
 */
export type AiToolsInfra = {
  secretArns: pulumi.Output<string>[];
  queueArns: pulumi.Output<string>[];
  bucketArns: pulumi.Output<string>[];
};

/**
 * Returns the env vars, secret/queue/bucket ARNs needed by any service that
 * hosts `ai_tools::build_tool_service_context_from_env`. Stack references are
 * namespaced with `ai-tools-` so callers can keep their own references to the
 * same target stacks for unrelated outputs (e.g. cluster info).
 */
export function getAiToolsInfra(): AiToolsInfra {
  const cloudStorageStack = new pulumi.StackReference(
    'ai-tools-cloud-storage-stack',
    { name: `macro-inc/document-storage/${stack}` }
  );
  const cloudStorageServiceStack = new pulumi.StackReference(
    'ai-tools-cloud-storage-service-stack',
    { name: `macro-inc/cloud-storage-service/${stack}` }
  );
  const emailServiceStack = new pulumi.StackReference(
    'ai-tools-email-service-stack',
    { name: `macro-inc/email-service/${stack}` }
  );

  const documentStorageBucketArn: pulumi.Output<string> = cloudStorageStack
    .getOutput('documentStorageBucketArn')
    .apply((v) => v as string);

  const docxUploadBucketArn: pulumi.Output<string> = cloudStorageServiceStack
    .getOutput('docxUploadBucketArn')
    .apply((v) => v as string);

  // Queue names come from the `macro_queues` crate at runtime; we only need the
  // ARNs here for the IAM send/receive grants below.
  const emailScheduledQueueArn: pulumi.Output<string> = emailServiceStack
    .getOutput('scheduledQueueArn')
    .apply((v) => v as string);

  const gmailOpsQueueArn: pulumi.Output<string> = emailServiceStack
    .getOutput('gmailOpsQueueArn')
    .apply((v) => v as string);

  const CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME = `linksharing-private-key-${stack}`;
  const cloudfrontPrivateKeySecretArn: pulumi.Output<string> =
    aws.secretsmanager
      .getSecretOutput({ name: CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME })
      .apply((s) => s.arn);

  const SYNC_SERVICE_AUTH_KEY_SECRET_NAME = `sync-service-key-${stack}`;
  const syncServiceAuthKeyArn: pulumi.Output<string> = aws.secretsmanager
    .getSecretVersionOutput({ secretId: SYNC_SERVICE_AUTH_KEY_SECRET_NAME })
    .apply((s) => s.arn);

  const MCP_CREDENTIALS_KEY_SECRET_NAME = `mcp-credentials-key-${stack}`;
  const mcpCredentialsKeyArn: pulumi.Output<string> = aws.secretsmanager
    .getSecretOutput({ name: MCP_CREDENTIALS_KEY_SECRET_NAME })
    .apply((s) => s.arn);

  return {
    secretArns: [
      syncServiceAuthKeyArn,
      cloudfrontPrivateKeySecretArn,
      mcpCredentialsKeyArn,
    ],
    queueArns: [emailScheduledQueueArn, gmailOpsQueueArn],
    bucketArns: [documentStorageBucketArn, docxUploadBucketArn],
  };
}

/**
 * Role ARNs of every service that hosts `ai_tools`. Resource-side policies
 * (e.g. the doc-storage bucket policy) use this to grant bulk access to the
 * group — adding a new tool-hosting service only requires updating this list.
 */
export function getAiToolsServiceRoleArns(): pulumi.Output<string>[] {
  const mcpServerStack = new pulumi.StackReference(
    'ai-tools-mcp-server-stack',
    { name: `macro-inc/mcp-server/${stack}` }
  );
  const documentCognitionStack = new pulumi.StackReference(
    'ai-tools-document-cognition-stack',
    { name: `macro-inc/document-cognition/${stack}` }
  );
  const agentScheduleServiceStack = new pulumi.StackReference(
    'ai-tools-agent-schedule-service-stack',
    { name: `macro-inc/agent-schedule-service/${stack}` }
  );

  return [
    mcpServerStack.getOutput('mcpServerRoleArn').apply((v) => v as string),
    documentCognitionStack
      .getOutput('documentCognitionServiceRoleArn')
      .apply((v) => v as string),
    agentScheduleServiceStack
      .getOutput('agentScheduleServiceRoleArn')
      .apply((v) => v as string),
  ];
}
