import { ok } from '@core/util/maybeResult';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { createResource } from 'solid-js';
import { notificationServiceClient } from './client';

const _unsubscribeResource = createSingletonRoot(() =>
  createResource(notificationServiceClient.getUnsubscribes, {
    initialValue: ok({ data: [] }),
  })
);
