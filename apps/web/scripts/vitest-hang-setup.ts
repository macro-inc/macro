import { appendFileSync } from 'node:fs';
import { afterAll } from 'vitest';

const originalGlobalSetTimeout = globalThis.setTimeout;
const originalGlobalSetInterval = globalThis.setInterval;
const originalWindowSetTimeout = window.setTimeout;
const originalWindowSetInterval = window.setInterval;
let timerTraceActive = true;

// #region agent log
appendFileSync(
  '/opt/cursor/logs/debug.log',
  `${JSON.stringify({ hypothesisId: 'L,M', location: 'scripts/vitest-hang-setup.ts:before-test-module', message: 'test module import starting', data: { resources: process.getActiveResourcesInfo() }, timestamp: Date.now() })}\n`
);
// #endregion

function logTimerCreation(kind: 'setTimeout' | 'setInterval', delay: unknown) {
  // #region agent log
  appendFileSync(
    '/opt/cursor/logs/debug.log',
    `${JSON.stringify({ hypothesisId: 'L', location: 'scripts/vitest-hang-setup.ts:timer', message: 'static route import created timer', data: { kind, delay: typeof delay === 'number' ? delay : null, stack: new Error().stack?.split('\n').slice(2, 10) }, timestamp: Date.now() })}\n`
  );
  // #endregion
}

globalThis.setTimeout = ((...args: Parameters<typeof originalGlobalSetTimeout>) => {
  logTimerCreation('setTimeout', args[1]);
  return Reflect.apply(originalGlobalSetTimeout, globalThis, args);
}) as typeof globalThis.setTimeout;
globalThis.setInterval = ((
  ...args: Parameters<typeof originalGlobalSetInterval>
) => {
  logTimerCreation('setInterval', args[1]);
  return Reflect.apply(originalGlobalSetInterval, globalThis, args);
}) as typeof globalThis.setInterval;
window.setTimeout = ((...args: Parameters<typeof originalWindowSetTimeout>) => {
  logTimerCreation('setTimeout', args[1]);
  return Reflect.apply(originalWindowSetTimeout, window, args);
}) as typeof window.setTimeout;
window.setInterval = ((...args: Parameters<typeof originalWindowSetInterval>) => {
  logTimerCreation('setInterval', args[1]);
  return Reflect.apply(originalWindowSetInterval, window, args);
}) as typeof window.setInterval;

export function stopTimerTrace() {
  if (!timerTraceActive) return;
  timerTraceActive = false;
  globalThis.setTimeout = originalGlobalSetTimeout;
  globalThis.setInterval = originalGlobalSetInterval;
  window.setTimeout = originalWindowSetTimeout;
  window.setInterval = originalWindowSetInterval;
}

afterAll(() => {
  stopTimerTrace();
  // #region agent log
  appendFileSync(
    '/opt/cursor/logs/debug.log',
    `${JSON.stringify({ hypothesisId: 'L,M', location: 'scripts/vitest-hang-setup.ts:afterAll', message: 'test file finished', data: { resources: process.getActiveResourcesInfo() }, timestamp: Date.now() })}\n`
  );
  // #endregion
});
