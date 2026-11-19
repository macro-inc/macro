import { usePipedreamConnectedSlugs } from '@queries/pipedream-connectors';
import type { Accessor } from 'solid-js';

/** The viewer's connected app slugs, undefined until they load. */
export function createRoutineConnectedApps(
  enabled: Accessor<boolean>
): Accessor<ReadonlySet<string> | undefined> {
  const connections = usePipedreamConnectedSlugs({ enabled });
  return () => (connections.ready() ? connections.slugs() : undefined);
}
