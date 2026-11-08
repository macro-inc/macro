import { Telemetry } from '../../../observability/src/index';
import {
  createWebTracingProvider,
  StackContextManager,
} from '../../../observability/src/web';

/** Local exporter only; no hosted telemetry endpoint or runtime identity. */
export async function startTrace(name = 'lexical.corpus.replay') {
  const config = {
    serviceName: 'lexical-corpus',
    environment: 'local',
    tracesUrl: 'http://localhost:4318/v1/traces',
    enabled: async () => true,
    contextManager: new StackContextManager(),
  };
  await Telemetry.init({
    ...config,
    tracingProvider: (resource, user, sampling) =>
      createWebTracingProvider(config, resource, user, sampling),
  });
  return Telemetry.span(name);
}

export async function flushTrace() {
  await Telemetry.flush();
}
