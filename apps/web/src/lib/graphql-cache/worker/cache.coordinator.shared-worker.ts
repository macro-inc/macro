/// <reference lib="webworker" />

import { installSharedCacheCoordinatorWorker } from './cache-coordinator-runtime';

declare const self: SharedWorkerGlobalScope;

installSharedCacheCoordinatorWorker(self);
