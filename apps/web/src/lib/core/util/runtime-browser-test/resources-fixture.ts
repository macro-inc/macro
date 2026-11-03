import { startRuntimeResourceSampling } from '@app/observability/runtime-resources';
import { initializeUiOperationTelemetry } from '@app/observability/ui-operation';
import { Telemetry } from '@macro-inc/observability';
import {
  createWebTracingProvider,
  StackContextManager,
} from '@macro-inc/observability/web';

const config = {
  serviceName: 'runtime-resource-fixture',
  environment: 'test',
  tracesUrl: `${location.origin}/traces`,
  contextManager: new StackContextManager(),
  enabled: async () => true,
};
await Telemetry.init({
  ...config,
  tracingProvider: (resource, user, sampled) =>
    createWebTracingProvider(config, resource, user, sampled),
});
const disposeObserver = initializeUiOperationTelemetry();
const dispose = startRuntimeResourceSampling();
document.getElementById('block')?.addEventListener('click', () => {
  const until = performance.now() + 150;
  while (performance.now() < until) {
    /* Intentional measured long task. */
  }
});
import.meta.hot?.dispose(() => {
  dispose();
  disposeObserver();
});
document.body.dataset.ready = 'true';
