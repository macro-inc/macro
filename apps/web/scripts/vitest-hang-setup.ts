import { appendFileSync } from 'node:fs';
import { afterAll } from 'vitest';

const OriginalBroadcastChannel = globalThis.BroadcastChannel;

// #region agent log
appendFileSync(
  '/opt/cursor/logs/debug.log',
  `${JSON.stringify({ hypothesisId: 'F,G', location: 'scripts/vitest-hang-setup.ts:before-test-module', message: 'test module import starting', data: { broadcastChannelType: typeof OriginalBroadcastChannel, resources: process.getActiveResourcesInfo() }, timestamp: Date.now() })}\n`
);
// #endregion

if (OriginalBroadcastChannel) {
  globalThis.BroadcastChannel = class extends OriginalBroadcastChannel {
    constructor(name: string) {
      super(name);
      // #region agent log
      appendFileSync(
        '/opt/cursor/logs/debug.log',
        `${JSON.stringify({ hypothesisId: 'F', location: 'scripts/vitest-hang-setup.ts:BroadcastChannel', message: 'test module constructed BroadcastChannel', data: { name, resources: process.getActiveResourcesInfo() }, timestamp: Date.now() })}\n`
      );
      // #endregion
    }
  };
}

afterAll(() => {
  if (OriginalBroadcastChannel) {
    globalThis.BroadcastChannel = OriginalBroadcastChannel;
  }
  // #region agent log
  appendFileSync(
    '/opt/cursor/logs/debug.log',
    `${JSON.stringify({ hypothesisId: 'F,G,H', location: 'scripts/vitest-hang-setup.ts:afterAll', message: 'test file finished', data: { resources: process.getActiveResourcesInfo() }, timestamp: Date.now() })}\n`
  );
  // #endregion
});
