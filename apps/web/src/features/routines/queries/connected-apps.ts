import { usePipedreamConnectedSlugs } from '@queries/pipedream-connectors';
import type { Accessor } from 'solid-js';

/** The viewer's connected app slugs, undefined until they load. */
export function createRoutineConnectedApps(): Accessor<
  ReadonlySet<string> | undefined
> {
  const connections = usePipedreamConnectedSlugs();
  return () => (connections.ready() ? connections.slugs() : undefined);
}
