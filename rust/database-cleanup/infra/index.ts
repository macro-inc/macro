import * as pulumi from '@pulumi/pulumi';
import { get_coparse_api_vpc } from './resources/vpc';
import { DATABASE_URL, stack } from './resources/shared';
import { TableCleanupLambda } from './table-cleanup-lambda';

export const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'database-cleanup',
};

export const vpc = get_coparse_api_vpc();

const jobToDocumentProcessResultCleanupLambda = new TableCleanupLambda(
  `job-to-dpr`,
  {
    tags,
    vpc,
    envVars: {
      DATABASE_URL: pulumi.interpolate`${DATABASE_URL}`,
      TABLE_NAME: `JobToDocumentProcessResult`,
      MAX_AGE_HOURS: '1',
      ENVIRONMENT: stack,
      RUST_LOG: `table_cleanup_handler=trace`,
    },
  },
);

export const jobToDocumentProcessResultCleanupLambdaRoleArn =
  jobToDocumentProcessResultCleanupLambda.role.arn;
export const jobToDocumentProcessResultCleanupLambdaName =
  jobToDocumentProcessResultCleanupLambda.lambda.name;
export const jobToDocumentProcessResultCleanupLambdaRuleArn =
  jobToDocumentProcessResultCleanupLambda.rule.arn;

// This cleans the UploadJob table. It used to be named `DocxUploadJob`
const docxUploadJobCleanupLambda = new TableCleanupLambda(`docx-upload-job`, {
  tags,
  vpc,
  envVars: {
    DATABASE_URL: pulumi.interpolate`${DATABASE_URL}`,
    TABLE_NAME: `UploadJob`,
    MAX_AGE_HOURS: '1',
    ENVIRONMENT: stack,
    RUST_LOG: `table_cleanup_handler=trace`,
  },
});

export const docxUploadJobCleanupLambdaRoleArn =
  docxUploadJobCleanupLambda.role.arn;
export const docxUploadJobCleanupLambdaName =
  docxUploadJobCleanupLambda.lambda.name;
export const docxUploadJobCleanupLambdaRuleArn =
  docxUploadJobCleanupLambda.rule.arn;
