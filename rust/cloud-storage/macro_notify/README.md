# Macro Notify

This crate is a utility crate that is used to send notifications in macro.
If you need to send a notification in rust this should be the only way you do so.

## IaC Requirements

Each service will need to import the notification queue arn and name. You will also need to ensure the role for the service has a policy that allows sending messages to the queue.

```typescript
import * as pulumi from "@pulumi/pulumi";
// Get the stack from the shared package
import { getMacroNotify, stack } from '@macro-cloud-infra/shared';

const { notificationQueueName, notificationQueueArn } = getMacroNotify();

// Example policy and role (These would go inside of your specific services class file)
const queuePolicy = new aws.iam.Policy(
  `${BASE_NAME}-sqs-policy`,
  {
    name: `${BASE_NAME}-sqs-policy-${stack}`,
    policy: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: ['sqs:SendMessage'],
          Resource: [pulumi.interpolate`${notificationQueueArn}`],
          Effect: 'Allow',
        },
      ],
    },
  },
);

// This is the role that would get attached to your service
const role = new aws.iam.Role(
  `${BASE_NAME}-role`,
  {
    name: `${BASE_NAME}-role-${stack}`,
    assumeRolePolicy: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Principal: {
            Service: 'ecs-tasks.amazonaws.com',
          },
          Effect: 'Allow',
          Sid: '',
        },
      ],
    },
    tags: this.tags,
    managedPolicyArns: [queuePolicy.arn],
  },
);```
