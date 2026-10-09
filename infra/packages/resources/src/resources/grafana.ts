import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ecs } from '@pulumi/awsx/types/input';
import {
  grafanaIngestSecretArn,
  grafanaTelemetryEnabled,
} from '../../../shared';

// Applied automatically with the dev sidecar; never overrides the primary OTLP endpoint.
export const grafanaTelemetryEnvironment = grafanaTelemetryEnabled
  ? [{ name: 'GRAFANA_OTLP_ENDPOINT', value: 'http://127.0.0.1:14317' }]
  : [];

export function grafanaTelemetryContainers(
  serviceName: string
): Record<string, ecs.TaskDefinitionContainerDefinitionArgs> {
  if (!grafanaTelemetryEnabled || !grafanaIngestSecretArn) return {};
  return {
    alloy: {
      name: 'alloy',
      image:
        'grafana/alloy:v1.16.0@sha256:6e00cf7c5a692ff5f24844529416ed017d76fce922f8199004e73d5eca46b6b8',
      essential: false,
      memory: 512,
      memoryReservation: 128,
      stopTimeout: 30,
      user: '473',
      entryPoint: ['/bin/sh', '-ec'],
      command: [
        'umask 077; printf "%s" "$ALLOY_CONFIG" > /tmp/config.alloy; exec /bin/alloy run --stability.level=experimental --server.http.listen-addr=127.0.0.1:12345 --storage.path=/tmp/alloy /tmp/config.alloy',
      ],
      environment: [
        {
          name: 'ALLOY_CONFIG',
          value: readFileSync(join(__dirname, 'ecs-telemetry.alloy'), 'utf8'),
        },
        { name: 'TELEMETRY_SERVICE', value: serviceName },
        { name: 'GOMEMLIMIT', value: '400MiB' },
      ],
      secrets: [
        { name: 'GRAFANA_OTLP_TOKEN', valueFrom: grafanaIngestSecretArn },
      ],
    },
  };
}
