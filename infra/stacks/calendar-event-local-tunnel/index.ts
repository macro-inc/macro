import * as pulumi from '@pulumi/pulumi';
import { stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { CalendarEventLocalTunnel } from './calendar-event-local-tunnel';

const tags = {
  environment: stack,
  tech_lead: 'gabriel',
  project: 'calendar-event-local-tunnel',
};

// Dev-only: the tunnel exists so locally running stacks can receive real
// Google Calendar push notifications; there is nothing for it to relay in
// prod. The prod stack stays an empty no-op so environment-wide deploy runs
// succeed.
let tunnel: CalendarEventLocalTunnel | undefined;

if (stack === 'dev') {
  const coparse_api_vpc = get_coparse_api_vpc();

  const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
    name: `macro-inc/document-storage/${stack}`,
  });

  const cloudStorageClusterArn: pulumi.Output<string> = cloudStorageStack
    .getOutput('cloudStorageClusterArn')
    .apply((arn) => arn as string);

  const cloudStorageClusterName: pulumi.Output<string> = cloudStorageStack
    .getOutput('cloudStorageClusterName')
    .apply((arn) => arn as string);

  tunnel = new CalendarEventLocalTunnel(
    `calendar-event-local-tunnel-${stack}`,
    {
      ecsClusterArn: cloudStorageClusterArn,
      cloudStorageClusterName: cloudStorageClusterName,
      vpc: coparse_api_vpc,
      platform: {
        family: 'linux',
        architecture: 'amd64',
      },
      serviceContainerPort: 8080,
      healthCheckPath: '/health',
      containerEnvVars: [
        {
          name: 'ENVIRONMENT',
          value: stack,
        },
        // OpenTelemetry / Datadog tracing configuration
        {
          name: 'DD_SERVICE',
          value: 'calendar-event-local-tunnel',
        },
        {
          name: 'DD_ENV',
          value: stack,
        },
      ],
      isPrivate: false,
      tags,
    }
  );
}

export const calendarEventLocalTunnelUrl = tunnel
  ? pulumi.interpolate`${tunnel.domain}`
  : undefined;
