import { execSync } from 'node:child_process';
import * as aws from '@pulumi/aws';
import { Runtime } from '@pulumi/aws/lambda';
import * as command from '@pulumi/command';
import * as datadog from '@pulumi/datadog';
import * as pulumi from '@pulumi/pulumi';
import * as datadogEntity from './datadog-entity.json';
import { hasItems } from '../../packages/utils';

// Import the program's configuration
const config = new pulumi.Config();
const localPath: string = config.require('path');

// Make sure there are items in the `localPath`
if (!hasItems(localPath)) {
  throw new Error('Local path of build output is empty');
}

const indexDocument = config.get('indexDocument') || 'index.html';

// Get current Stack name
const stack = pulumi.getStack();

if (!process.env.CI && stack === 'prod') {
  throw new Error(
    'You are trying to deploy to prod without the CI environment variable set'
  );
}

// Create an S3 bucket and configure it as a website
const webAppAssets = new aws.s3.Bucket(`web-app-assets-${stack}`, {
  website: {
    indexDocument: indexDocument,
  },
  loggings:
    stack === 'prod' || stack === 'compare-prod'
      ? [
          {
            targetBucket: 'macro-logging-bucket',
            targetPrefix: `web-app-${stack}`,
          },
        ]
      : undefined,
});

// Configure ownership controls for the new S3 bucket
const ownershipControls = new aws.s3.BucketOwnershipControls(
  `ownership-controls-${stack}`,
  {
    bucket: webAppAssets.bucket,
    rule: {
      objectOwnership: 'ObjectWriter',
    },
  }
);

// Configure public ACL block on the new S3 bucket
const publicAccessBlock = new aws.s3.BucketPublicAccessBlock(
  `public-access-block-${stack}`,
  {
    bucket: webAppAssets.bucket,
    blockPublicAcls: false,
  }
);

// Stage web delivery and a native/OTA archive separately. Web delivery keeps
// the Brotli sidecar for targeted S3 upload; native clients need the raw WASM
// only, so their archive copy removes the sidecar before FileArchive snapshots it.
const buildOutputPath = './output/app';
const appArchiveOutputPath = './output/app-archive';
const assetRetentionDays = 7;
const shellQuote = (value: string): string =>
  "'" + value.split("'").join("'\\''") + "'";
execSync('rm -rf ./output', { stdio: 'inherit' });
execSync(
  `mkdir -p ${shellQuote(buildOutputPath)} ${shellQuote(appArchiveOutputPath)}`,
  { stdio: 'inherit' }
);
execSync(`cp -r ${shellQuote(localPath)}/* ${shellQuote(buildOutputPath)}`, {
  stdio: 'inherit',
});
execSync(
  `cp -r ${shellQuote(localPath)}/* ${shellQuote(appArchiveOutputPath)}`,
  { stdio: 'inherit' }
);
execSync(
  `find ${shellQuote(appArchiveOutputPath)} -type f -name 'cache_wasm_bg*.wasm.br' -delete`,
  { stdio: 'inherit' }
);

const appArchive = new pulumi.asset.FileArchive(appArchiveOutputPath);
new aws.s3.BucketObjectv2(
  'app-archive',
  {
    bucket: webAppAssets.bucket,
    key: 'app/app-archive.zip',
    source: appArchive,
    acl: 'public-read',
  },
  {
    dependsOn: [ownershipControls, publicAccessBlock],
  }
);
// Copy the index.html to the routing lambda
execSync(
  `cp ${shellQuote(`${buildOutputPath}/index.html`)} ./appRouteLambda/index.html`,
  { stdio: 'inherit' }
);

const syncAssetsCommand = new command.local.Command(
  'sync-assets-command',
  {
    // The publisher uploads assets first, then index.html and sw.js. It keeps
    // previous chunks so open tabs can finish loading their original build.
    create: pulumi.interpolate`bash ../../../apps/web/scripts/deploy/publish-to-s3.sh ./output/app s3://${webAppAssets.bucket}/app`,
    triggers: [Date.now()],
  },
  {
    dependsOn: [webAppAssets, ownershipControls, publicAccessBlock],
    replaceOnChanges: ['*'],
  }
);

// First, create an IAM role and attach the AWSLambdaBasicExecutionRole policy
const lambdaRole = new aws.iam.Role('content-encoding-header-lambda-role', {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: ['lambda.amazonaws.com', 'edgelambda.amazonaws.com'],
  }),
});

new aws.iam.RolePolicyAttachment('lambdaRoleAttach', {
  role: lambdaRole,
  policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
});

const encodingLambdaEdgeFunction = new aws.lambda.Function(
  'content-encoding-origin-response-lambda',
  {
    code: new pulumi.asset.FileArchive('./contentEncodingLambda'), // path to your lambda function code archive
    role: lambdaRole.arn,
    handler: 'index.handler',
    runtime: Runtime.NodeJS22dX,
    name: `content-encoding-origin-response-lambda-${stack}`,
    // do not throttle prod
    reservedConcurrentExecutions: stack === 'prod' ? undefined : 25,
    publish: true,
  }
);

const encodingLambdaVersion: pulumi.Output<String> =
  encodingLambdaEdgeFunction.version.apply((v: string) => v);

const appRouteLambda = new aws.lambda.Function(
  'app-route-lambda',
  {
    code: new pulumi.asset.FileArchive('./appRouteLambda'),
    role: lambdaRole.arn,
    handler: 'index.handler',
    runtime: Runtime.NodeJS22dX,
    name: `app-route-lambda-${stack}`,
    // do not throttle prod
    reservedConcurrentExecutions: stack === 'prod' ? undefined : 100,
    publish: true,
    environment: {
      variables: {
        PREVIEW_URL: `https://${stack === 'dev' ? 'dev-' : ''}gateway.macro.com/dss/documents/preview`,
      },
    },
  },
  { dependsOn: [syncAssetsCommand] }
);

// Both HTML entry points must publish successfully before retiring any asset.
new command.local.Command(
  'prune-retired-assets-command',
  {
    create: pulumi.interpolate`bun ../../../apps/web/scripts/deploy/prune-retired-assets.ts ./output/app s3://${webAppAssets.bucket}/app ${assetRetentionDays}`,
    triggers: [Date.now()],
  },
  {
    dependsOn: [syncAssetsCommand, appRouteLambda],
    replaceOnChanges: ['*'],
  }
);

const appRouteFunctionUrl = new aws.lambda.FunctionUrl('app-route-lambda-url', {
  functionName: appRouteLambda.name,
  authorizationType: 'NONE',
});

new datadog.SoftwareCatalog('service_v3', {
  entity: JSON.stringify(datadogEntity),
});

if (stack === 'prod') {
  // invalidate cloudfront cache
  const macroWebsiteStack = new pulumi.StackReference('website-infra', {
    name: `macro-inc/website-infra/${stack}`,
  });
  const macroWebsiteCdnId = macroWebsiteStack
    .getOutput('cdnId')
    .apply<string>((id) => id);
  new command.local.Command(
    'invalidate-cache',
    {
      create: pulumi.interpolate`aws cloudfront create-invalidation --distribution-id ${macroWebsiteCdnId} --paths "/app" "/app/*"`,
      triggers: [Date.now()],
    },
    {
      dependsOn: [syncAssetsCommand, appRouteLambda],
      replaceOnChanges: ['*'],
    }
  );
}

// Export the URLs and hostnames of the bucket and distribution.
export const originURL = pulumi.interpolate`http://${webAppAssets.websiteEndpoint}`;
export const contentEncodingLambda = pulumi.interpolate`${encodingLambdaEdgeFunction.arn}:${encodingLambdaVersion}`;
export const macroWebAppBucketId = webAppAssets.id;
export const macroWebAppBucketArn = webAppAssets.arn;
export const macroWebAppBucketWebsiteEndpoint = webAppAssets.websiteEndpoint;
export const contentEncodingResponseEdgeLambda = pulumi.interpolate`${encodingLambdaEdgeFunction.arn}:${encodingLambdaVersion}`;
export const appRouteLambdaId = pulumi.interpolate`${appRouteLambda.id}`;
export const appRouteUrl = pulumi.interpolate`${appRouteFunctionUrl.functionUrl}`;
