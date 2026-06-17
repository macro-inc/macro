import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, getServiceUrl, ServiceUrl, stack } from '../../shared';

/**
 * Infrastructure wiring required by services that host the `ai_tools` crate
 * (see `rust/cloud-storage/ai_tools/src/build_context.rs`). Callers spread
 * these into their service's IAM role and container environment alongside any
 * service-specific values.
 */
export type AiToolsInfra = {
  envVars: { name: string; value: pulumi.Output<string> | string }[];
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
  const linksharingStack = new pulumi.StackReference(
    'ai-tools-linksharing-stack',
    { name: `macro-inc/link-sharing/${stack}` }
  );

  const documentStorageBucketId: pulumi.Output<string> = cloudStorageStack
    .getOutput('documentStorageBucketId')
    .apply((v) => v as string);
  const documentStorageBucketArn: pulumi.Output<string> = cloudStorageStack
    .getOutput('documentStorageBucketArn')
    .apply((v) => v as string);

  const docxUploadBucketName: pulumi.Output<string> = cloudStorageServiceStack
    .getOutput('docxUploadBucketName')
    .apply((v) => v as string);
  const docxUploadBucketArn: pulumi.Output<string> = cloudStorageServiceStack
    .getOutput('docxUploadBucketArn')
    .apply((v) => v as string);

  const emailScheduledQueueName: pulumi.Output<string> = emailServiceStack
    .getOutput('scheduledQueueName')
    .apply((v) => v as string);
  const emailScheduledQueueArn: pulumi.Output<string> = emailServiceStack
    .getOutput('scheduledQueueArn')
    .apply((v) => v as string);

  const cloudfrontDistributionUrl: pulumi.Output<string> = linksharingStack
    .getOutput('cloudfrontDistributionUrl')
    .apply((v) => v as string);
  const cloudfrontSignerPublicKeyId: pulumi.Output<string> = linksharingStack
    .getOutput('cloudfrontDistributionPublicKeyId')
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

  const INTERNAL_AUTH_KEY_SECRET_NAME = `document-storage-service-auth-key-${stack}`;
  const internalAuthKey: pulumi.Output<string> = aws.secretsmanager
    .getSecretVersionOutput({ secretId: INTERNAL_AUTH_KEY_SECRET_NAME })
    .apply((s) => s.secretString);

  const SLACK_MCP_CLIENT_ID = aws.secretsmanager
    .getSecretVersionOutput({ secretId: 'slack-mcp-client-id' })
    .apply((secret) => secret.secretString);

  const SLACK_MCP_CLIENT_SECRET = aws.secretsmanager
    .getSecretVersionOutput({ secretId: 'slack-mcp-client-secret' })
    .apply((secret) => secret.secretString);

  const GITHUB_CLIENT_ID = aws.secretsmanager
    .getSecretVersionOutput({ secretId: `github-client-id-${stack}` })
    .apply((secret) => secret.secretString);

  const GITHUB_CLIENT_SECRET = aws.secretsmanager
    .getSecretVersionOutput({ secretId: `github-client-secret-${stack}` })
    .apply((secret) => secret.secretString);

  const OPENAI_API_KEY = aws.secretsmanager
    .getSecretVersionOutput({ secretId: config.require('openai_api_key') })
    .apply((secret) => secret.secretString);

  const ANTHROPIC_API_KEY = aws.secretsmanager
    .getSecretVersionOutput({ secretId: config.require('anthropic_api_key') })
    .apply((secret) => secret.secretString);

  const envVars: AiToolsInfra['envVars'] = [
    {
      name: 'INTERNAL_API_SECRET_KEY',
      value: pulumi.interpolate`${internalAuthKey}`,
    },
    {
      name: 'DOCUMENT_STORAGE_SERVICE_AUTH_KEY',
      value: pulumi.interpolate`${internalAuthKey}`,
    },
    {
      name: ServiceUrl.DOCUMENT_STORAGE_SERVICE_URL,
      value: getServiceUrl(ServiceUrl.DOCUMENT_STORAGE_SERVICE_URL),
    },
    {
      name: ServiceUrl.EMAIL_SERVICE_URL,
      value: getServiceUrl(ServiceUrl.EMAIL_SERVICE_URL),
    },
    {
      name: ServiceUrl.SYNC_SERVICE_URL,
      value: getServiceUrl(ServiceUrl.SYNC_SERVICE_URL),
    },
    {
      name: ServiceUrl.LEXICAL_SERVICE_URL,
      value: getServiceUrl(ServiceUrl.LEXICAL_SERVICE_URL),
    },
    {
      name: ServiceUrl.STATIC_FILE_SERVICE_URL,
      value: getServiceUrl(ServiceUrl.STATIC_FILE_SERVICE_URL),
    },
    { name: 'SYNC_SERVICE_AUTH_KEY', value: SYNC_SERVICE_AUTH_KEY_SECRET_NAME },
    {
      name: 'MCP_CREDENTIALS_KEY_SECRET_NAME',
      value: MCP_CREDENTIALS_KEY_SECRET_NAME,
    },
    {
      name: 'DOCUMENT_STORAGE_BUCKET',
      value: pulumi.interpolate`${documentStorageBucketId}`,
    },
    {
      name: 'DOCX_DOCUMENT_UPLOAD_BUCKET',
      value: pulumi.interpolate`${docxUploadBucketName}`,
    },
    {
      name: 'EMAIL_SCHEDULED_QUEUE',
      value: pulumi.interpolate`${emailScheduledQueueName}`,
    },
    {
      name: 'DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL',
      value: pulumi.interpolate`${cloudfrontDistributionUrl}`,
    },
    {
      name: 'DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID',
      value: pulumi.interpolate`${cloudfrontSignerPublicKeyId}`,
    },
    {
      name: 'DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME',
      value: CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME,
    },
    {
      name: 'SLACK_MCP_CLIENT_ID',
      value: pulumi.interpolate`${SLACK_MCP_CLIENT_ID}`,
    },
    {
      name: 'SLACK_MCP_CLIENT_SECRET',
      value: pulumi.interpolate`${SLACK_MCP_CLIENT_SECRET}`,
    },
    {
      name: 'GITHUB_CLIENT_SECRET',
      value: pulumi.interpolate`${GITHUB_CLIENT_SECRET}`,
    },
    {
      name: 'GITHUB_CLIENT_ID',
      value: pulumi.interpolate`${GITHUB_CLIENT_ID}`,
    },
    {
      name: 'OPENAI_API_KEY',
      value: pulumi.interpolate`${OPENAI_API_KEY}`,
    },
    {
      name: 'ANTHROPIC_API_KEY',
      value: pulumi.interpolate`${ANTHROPIC_API_KEY}`,
    },
  ];

  return {
    envVars,
    secretArns: [
      syncServiceAuthKeyArn,
      cloudfrontPrivateKeySecretArn,
      mcpCredentialsKeyArn,
    ],
    queueArns: [emailScheduledQueueArn],
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
