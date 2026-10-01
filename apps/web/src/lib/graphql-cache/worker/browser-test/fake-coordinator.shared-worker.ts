/// <reference lib="webworker" />

import { installSharedCacheCoordinatorWorker } from '../cache-coordinator-runtime';
import { CoordinatorRouter } from '../coordinator-router';

declare const self: SharedWorkerGlobalScope;

const router = new CoordinatorRouter();
installSharedCacheCoordinatorWorker(self, router);
let telemetry: BroadcastChannel | undefined;

setInterval(() => {
  const snapshot = router.snapshot();
  if (!snapshot) return;
  telemetry ??= new BroadcastChannel(`graphql-cache-wp08:${snapshot.scope}`);
  telemetry.postMessage({
    kind: 'coordinator-snapshot',
    ownerEpoch: snapshot.ownerEpoch,
    snapshot,
  });
}, 100);
