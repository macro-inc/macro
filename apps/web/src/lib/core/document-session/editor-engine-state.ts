import { type Accessor, createResource } from 'solid-js';

/** One asynchronous initialization, with synchronous access only after readiness. */
export function createEditorEngineState<Module>(
  enabled: Accessor<boolean | undefined>,
  load: () => Promise<Module>
) {
  const [module, { refetch }] = createResource(() => enabled() === true, load);
  return {
    enabled,
    ready() {
      const active = enabled();
      if (active === undefined) return false;
      if (!active) return true;
      return module.state === 'ready';
    },
    failed: () => enabled() === true && module.state === 'errored',
    module(): Module {
      if (enabled() !== true || module.state !== 'ready')
        throw new Error('Native editor engine is not ready');
      const initialized = module.latest;
      if (initialized === undefined)
        throw new Error('Native editor engine did not initialize');
      return initialized;
    },
    retry: refetch,
  };
}
