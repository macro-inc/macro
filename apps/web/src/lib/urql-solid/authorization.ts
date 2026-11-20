import { cacheSessionGeneration } from '@graphql-cache/session-generation';

export const crmSnapshotAuthorization = cacheSessionGeneration.state;

/** A dispatch keeps its captured generation through decoding and publication. */
export function captureQueryAuthorization(): () => boolean {
  const generation = cacheSessionGeneration.capture();
  return () => cacheSessionGeneration.isCurrent(generation);
}
