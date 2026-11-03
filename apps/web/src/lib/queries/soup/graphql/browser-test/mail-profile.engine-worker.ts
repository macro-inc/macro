/// <reference lib="webworker" />
import { installCacheEngineWorker } from '../../../../graphql-cache/worker/cache-engine-runtime';
import { CacheWorkerCore } from '../../../../graphql-cache/worker/worker-core';

let channel: BroadcastChannel | undefined;
installCacheEngineWorker({
  hooks: {
    onEvent(event) {
      if (event.kind === 'activation-started')
        channel = new BroadcastChannel(
          `soup-mail-profile:${event.activation.scope}`
        );
    },
  },
  createCore(options) {
    const core = new CacheWorkerCore(options);
    return {
      prepare: () => core.prepare(),
      addPort: (port) => core.addPort(port),
      drain: () => core.drain(),
      async handleRequest(port, request) {
        const started = performance.now();
        await core.handleRequest(port, request);
        channel?.postMessage({
          kind: request.kind,
          ...(request.kind === 'entity-filter'
            ? {
                limit: request.request.limit,
                through: Boolean(request.request.mail?.through),
              }
            : {}),
          durationMs: performance.now() - started,
        });
      },
    };
  },
});
