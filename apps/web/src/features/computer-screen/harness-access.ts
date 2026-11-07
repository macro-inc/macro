import type { Harness } from '@service-storage/generated/schemas/harness';

/** The Screen pane and its entry points use the runtime's effective access. */
export function hasHarnessEditAccess(harness: Harness | undefined): boolean {
  return harness?.access === 'user' || harness?.access === 'owner';
}
