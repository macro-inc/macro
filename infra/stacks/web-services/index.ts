import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import {
  DATADOG_API_KEY,
  datadogAgentContainer,
  fargateLogRouterSidecarContainer,
} from './resources/datadog';
import { domainResources, route53Record } from './resources/domain';
import { serviceImage } from './resources/image';
import { securityGroups } from './resources/securityGroups';
import { serviceAutoScaling, serviceLoadBalancer } from './resources/service';
import { stack } from './resources/shared';
import { get_coparse_api_vpc } from './resources/vpc';

// Ensure AWS region is specified
aws.config.requireRegion();

if (!process.env.CI && stack === 'prod') {
  throw new Error(
    'You are trying to deploy to prod without the CI environment variable set'
  );
}

const PDF_SERVICE_ALB_IDLE_TIMEOUT = 1000;

export const vpc = get_coparse_api_vpc();

// Create ECS Cluster
const cluster = new aws.ecs.Cluster(`macro-web-services-${stack}`);

const {
  pdfServiceDomain,
  docxServiceDomain,
  hostedZoneId,
  certificateValidation,
} = domainResources(stack);

// ------------------------------------------- DOCX SERVER -------------------------------------------
const DOCX_SERVICE_ALB_IDLE_TIMEOUT = 1000;
const docxServicePort = 8080;
const docxServiceName = 'docx-service';

const docxServerImage = serviceImage({
  stack,
  serviceName: docxServiceName,
  dockerfilePath: '../../docx-server/',
  platform: 'linux/amd64',
});

const docxServerImageUri = docxServerImage.imageUri;

const docxServiceSecurityGroups = securityGroups({
  serviceName: `${docxServiceName}-${stack}`,
  vpcId: vpc.vpcId,
  serviceContainerPort: docxServicePort,
});

const { serviceLB: docxServiceLB, serviceTargetGroup: docxTargetGroup } =
  serviceLoadBalancer({
    stack,
    serviceName: docxServiceName,
    servicePort: docxServicePort,
    vpc,
    securityGroups: docxServiceSecurityGroups,
    healthCheckPath: '/ping-docx',
    idleTimeout: DOCX_SERVICE_ALB_IDLE_TIMEOUT, // to allow for longer operations such as compare
    certificateValidation,
  });

const docxService = new awsx.ecs.FargateService(`${docxServiceName}-${stack}`, {
  name: `${docxServiceName}-${stack}`,
  cluster: cluster.arn,
  networkConfiguration: {
    subnets: vpc.privateSubnetIds,
    securityGroups: [docxServiceSecurityGroups.serviceSg.id],
  },
  taskDefinitionArgs: {
    containers: {
      docx_service: {
        name: docxServiceName,
        image: docxServerImageUri,
        cpu: 4096, // (4 vCPU)
        memory: 8192, // 8 GB
        essential: true,
        environment: [],
        logConfiguration: {
          logDriver: 'awsfirelens',
          options: {
            Name: 'datadog',
            Host: 'http-intake.logs.us5.datadoghq.com',
            apikey: DATADOG_API_KEY,
            dd_service: `${docxServiceName}-${stack}`,
            dd_source: 'fargate',
            dd_tags: 'project:cloudstorage',
            provider: 'ecs',
          },
        },
        portMappings: [
          {
            appProtocol: 'http',
            name: `${docxServiceName}-tcp-${stack}`,
            hostPort: docxServicePort,
            containerPort: docxServicePort,
            targetGroup: docxTargetGroup,
          },
        ],
      },
      log_router: fargateLogRouterSidecarContainer,
      datadog_agent: datadogAgentContainer,
    },
  },
  desiredCount: stack === 'prod' ? 3 : 1,
});

serviceAutoScaling({
  stack,
  serviceName: docxServiceName,
  clusterName: cluster.name,
  fargateServiceName: docxService.service.name,
  minCapacity: stack === 'prod' ? 3 : 1,
  maxCapacity: stack === 'prod' ? 15 : 5,
});

route53Record({
  stack,
  serviceName: docxServiceName,
  hostedZoneId,
  serviceDomain: docxServiceDomain,
  serviceLB: docxServiceLB,
});

// ------------------------------------------- PDF SERVER -------------------------------------------
const pdfServicePort = 4567;
const pdfServiceName = 'pdf-service';

const pdfServerImage = serviceImage({
  stack,
  serviceName: pdfServiceName,
  dockerfilePath: '../../pdf-server/pdfreader/',
  platform: 'linux/amd64',
});

export const pdfServerImageUri = pdfServerImage.imageUri;
export const pdfServerImageUrn = pdfServerImage.urn;

const pdfServiceSecurityGroups = securityGroups({
  serviceName: `${pdfServiceName}-${stack}`,
  vpcId: vpc.vpcId,
  serviceContainerPort: pdfServicePort,
});

const { serviceLB: pdfServerLB, serviceTargetGroup: pdfTargetGroup } =
  serviceLoadBalancer({
    stack,
    serviceName: pdfServiceName,
    servicePort: pdfServicePort,
    vpc,
    securityGroups: pdfServiceSecurityGroups,
    healthCheckPath: '/ping',
    idleTimeout: PDF_SERVICE_ALB_IDLE_TIMEOUT, // to allow for longer operations, such as tested on FAR.pdf
    certificateValidation,
  });

const pdfService = new awsx.ecs.FargateService(`${pdfServiceName}-${stack}`, {
  name: pdfServiceName,
  cluster: cluster.arn,
  networkConfiguration: {
    subnets: vpc.privateSubnetIds,
    securityGroups: [pdfServiceSecurityGroups.serviceSg.id],
  },
  taskDefinitionArgs: {
    containers: {
      pdf_service: {
        name: pdfServiceName,
        image: pdfServerImageUri,
        cpu: 2048, // (2 vCPU)
        memory: 4096, // 4 GB
        essential: true,
        environment: [
          // Sets the max heap size for the service in megabytes
          {
            name: 'JAVA_OPTS',
            // It is recommended to leave at least 10-20% of the available
            // system memory for other processes to better avoid Out of
            // Memory Exceptions
            value: '-Xmx6144m',
          },
          {
            // Maximum number of threads to allow in the pool
            name: 'THREAD_MAX',
            value: '8',
          },
          {
            // Minimum number of threads to allow in the pool
            name: 'THREAD_MIN',
            value: '3',
          },
          {
            // Idle timeout for a thread in miliseconds
            name: 'THREAD_IDLE_MILLIS',
            value: '30000',
          },
        ],
        logConfiguration: {
          logDriver: 'awsfirelens',
          options: {
            Name: 'datadog',
            Host: 'http-intake.logs.us5.datadoghq.com',
            apikey: DATADOG_API_KEY,
            dd_service: `${pdfServiceName}-${stack}`,
            dd_source: 'fargate',
            dd_tags: 'project:cloudstorage',
            provider: 'ecs',
          },
        },
        portMappings: [
          {
            appProtocol: 'http',
            name: `${pdfServiceName}-tcp-${stack}`,
            hostPort: pdfServicePort,
            containerPort: pdfServicePort,
            targetGroup: pdfTargetGroup,
          },
        ],
      },
      log_router: fargateLogRouterSidecarContainer,
      datadog_agent: datadogAgentContainer,
    },
  },
  desiredCount: stack === 'prod' ? 3 : 1,
});

serviceAutoScaling({
  stack,
  serviceName: pdfServiceName,
  clusterName: cluster.name,
  fargateServiceName: pdfService.service.name,
  minCapacity: stack === 'prod' ? 3 : 1,
  maxCapacity: stack === 'prod' ? 15 : 5,
});

export const pdfFargateServiceName = pdfService.service.name;

// ------------------------------------------- ALIAS STUFF -------------------------------------------

const pdfServiceAliasRecord = route53Record({
  stack,
  serviceName: pdfServiceName,
  hostedZoneId,
  serviceDomain: pdfServiceDomain,
  serviceLB: pdfServerLB,
});

export const pdfServiceUrl = pulumi.interpolate`https://${pdfServiceDomain}`;
export const docxServiceUrl = pulumi.interpolate`https://${docxServiceDomain}`;

export const pdfServiceAliasRecordName = pdfServiceAliasRecord.name;
