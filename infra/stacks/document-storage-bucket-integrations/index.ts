/* eslint-disable @typescript-eslint/no-shadow */
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

const getEventRuleArn = (ruleName: string) =>
  pulumi.interpolate`arn:aws:events:${aws.config.region}:569036502058:rule/${ruleName}`;

// Main configuration setup
export const setupS3EventBridgeTriggers = () => {
  const stack = pulumi.getStack();

  // Get storage stack reference
  const documentStorageStack = new pulumi.StackReference(
    'cloud-storage-stack',
    {
      name: `macro-inc/document-storage/${stack}`,
    }
  );

  // Get bucket details
  const bucketId = documentStorageStack
    .getOutput('documentStorageBucketId')
    .apply((id) => id as string);

  // Get Lambda ARNs
  const searchUploadHandlerLambdaArn = new pulumi.StackReference(
    'search-upload',
    { name: `macro-inc/search-upload/${stack}` }
  )
    .getOutput('searchUploadHandlerLambdaArn')
    .apply((id) => id as string);

  const documentTextExtractorLambdaArn = new pulumi.StackReference(
    'document-text-extractor',
    { name: `macro-inc/document-text-extractor/${stack}` }
  )
    .getOutput('documentTextExtractorLambdaArn')
    .apply((id) => id as string);

  // Enable EventBridge notifications for the S3 bucket
  new aws.s3.BucketNotification('eventbridge-notification', {
    bucket: bucketId,
    eventbridge: true,
  });

  const searchUploadDlq = new aws.sqs.Queue(`search-upload-dlq-${stack}`, {
    name: `search-upload-dlq-${stack}`,
    messageRetentionSeconds: 14 * 24 * 60 * 60, // 14 days
  });

  const searchUploadRuleName = `search-upload-rule-${stack}`;
  const textExtractorRuleName = `text-extractor-rule-${stack}`;

  const searchUploadRuleArn = getEventRuleArn(searchUploadRuleName);
  const textExtractorRuleArn = getEventRuleArn(textExtractorRuleName);

  const createDlqPolicy = (
    name: string,
    dlq: aws.sqs.Queue,
    ruleArn: pulumi.Output<string>
  ) => {
    new aws.sqs.QueuePolicy(`${name}-dlq-policy-${stack}`, {
      queueUrl: dlq.url,
      policy: pulumi.all([dlq.arn, ruleArn]).apply(([queueArn, ruleArn]) =>
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { Service: 'events.amazonaws.com' },
              Action: 'sqs:SendMessage',
              Resource: queueArn,
              Condition: {
                ArnEquals: {
                  'aws:SourceArn': ruleArn,
                },
              },
            },
          ],
        })
      ),
    });
  };

  createDlqPolicy('search-upload', searchUploadDlq, searchUploadRuleArn);

  const textExtractorDlq = new aws.sqs.Queue(`text-extractor-dlq-${stack}`, {
    name: `text-extractor-dlq-${stack}`,
    messageRetentionSeconds: 14 * 24 * 60 * 60, // 14 days
  });

  createDlqPolicy('text-extractor', textExtractorDlq, textExtractorRuleArn);

  // Configure EventBridge rules for each Lambda
  pulumi
    .all([bucketId, searchUploadHandlerLambdaArn, searchUploadDlq.arn])
    .apply(([bucketId, lambdaArn, dlqArn]) => {
      // Rule for upload notification Lambda (handles all files)
      const uploadNotificationRule = new aws.cloudwatch.EventRule(
        `search-upload-rule-${stack}`,
        {
          name: searchUploadRuleName,
          description: 'Triggers search upload Lambda for all files',
          eventPattern: JSON.stringify({
            source: ['aws.s3'],
            'detail-type': ['Object Created'],
            detail: {
              bucket: {
                name: [bucketId],
              },
            },
          }),
        }
      );

      // Add the Lambda as a target with DLQ
      new aws.cloudwatch.EventTarget('search-upload-target', {
        rule: uploadNotificationRule.name,
        arn: lambdaArn,
        deadLetterConfig: {
          arn: dlqArn,
        },
      });
    });

  pulumi
    .all([bucketId, documentTextExtractorLambdaArn, textExtractorDlq.arn])
    .apply(([bucketId, extractorArn, dlqArn]) => {
      // Rule for document text extractor Lambda (the lambda will read the db file type to check if it's a PDF)
      const textExtractorRule = new aws.cloudwatch.EventRule(
        `text-extractor-rule-${stack}`,
        {
          name: textExtractorRuleName,
          description: 'Triggers text extractor Lambda for all files',
          eventPattern: JSON.stringify({
            source: ['aws.s3'],
            'detail-type': ['Object Created'],
            detail: {
              bucket: {
                name: [bucketId],
              },
            },
          }),
        }
      );

      // Add the Lambda as a target with DLQ
      new aws.cloudwatch.EventTarget('text-extractor-target', {
        rule: textExtractorRule.name,
        arn: extractorArn,
        deadLetterConfig: {
          arn: dlqArn,
        },
      });
    });

  // Add necessary permissions for EventBridge to invoke Lambda functions
  const createLambdaPermission = (functionArn: string, ruleName: string) => {
    return new aws.lambda.Permission(`eventbridge-permission-${ruleName}`, {
      action: 'lambda:InvokeFunction',
      function: functionArn,
      principal: 'events.amazonaws.com',
      sourceArn: getEventRuleArn(ruleName),
    });
  };

  // Create permissions for all Lambda functions
  pulumi
    .all([searchUploadHandlerLambdaArn, documentTextExtractorLambdaArn])
    .apply(([searchUploadHandlerLambdaArn, extractorArn]) => {
      createLambdaPermission(
        searchUploadHandlerLambdaArn,
        searchUploadRuleName
      );
      createLambdaPermission(extractorArn, textExtractorRuleName);
    });
};

// Execute the setup
setupS3EventBridgeTriggers();
