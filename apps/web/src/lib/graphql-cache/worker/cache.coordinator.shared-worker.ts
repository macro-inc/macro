/// <reference lib="webworker" />

import { CoordinatorRouter } from './coordinator-router';

declare const self: SharedWorkerGlobalScope;

const router = new CoordinatorRouter();

self.onconnect = (event: MessageEvent) => {
  const port = event.ports[0];
  if (port) router.connect(port);
};
