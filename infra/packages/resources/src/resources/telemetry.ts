import type { ecs } from '@pulumi/awsx/types/input';
import * as pulumi from '@pulumi/pulumi';
import { grafanaTelemetryEnabled } from '../../../shared';
import {
  datadogAgentContainer,
  fargateLogRouterSidecarContainer,
} from './datadog';
import {
  grafanaTelemetryContainers,
  grafanaTelemetryEnvironment,
} from './grafana';

/** Standard app container and telemetry sidecars, with Grafana copies in dev. */
export function withTelemetry(
  serviceName: string,
  containers: Record<string, ecs.TaskDefinitionContainerDefinitionArgs>,
  sidecars: {
    logRouter?: Partial<ecs.TaskDefinitionContainerDefinitionArgs>;
    datadogAgent?: Partial<ecs.TaskDefinitionContainerDefinitionArgs>;
  } = {}
): Record<string, ecs.TaskDefinitionContainerDefinitionArgs> {
  return {
    ...grafanaTelemetryContainers(serviceName),
    log_router: {
      ...fargateLogRouterSidecarContainer,
      ...sidecars.logRouter,
    },
    datadog_agent: {
      ...datadogAgentContainer,
      ...sidecars.datadogAgent,
    },
    ...Object.fromEntries(
      Object.entries(containers).map(([name, container]) => [
        name,
        grafanaTelemetryEnabled
          ? {
              ...container,
              environment: pulumi
                .output(container.environment)
                .apply((environment) => [
                  ...(environment ?? []),
                  ...grafanaTelemetryEnvironment,
                ]),
            }
          : container,
      ])
    ),
  };
}
