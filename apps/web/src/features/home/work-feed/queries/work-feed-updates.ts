import {
  type WorkFeedPatchFieldsFragment,
  WorkFeedUpdatesDocument,
  type WorkFeedUpdatesSubscription,
  type WorkFeedUpdatesSubscriptionVariables,
} from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import { pipe, subscribe } from 'wonka';
import type { WorkFeedScope } from '../core/work-feed';
import { encodeWorkFeedScope } from './decode';

export type WorkFeedUpdatesHandlers = {
  /** One server batch, to apply together. */
  patches: (patches: WorkFeedPatchFieldsFragment[]) => void;
  /** The stream errored or ended: changes may be missed until resubscribed. */
  interrupted: () => void;
};

/** Follow one feed's live changes; returns the unsubscribe function. */
export function subscribeToWorkFeedUpdates(
  client: Client,
  scope: WorkFeedScope,
  handlers: WorkFeedUpdatesHandlers
): () => void {
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    handlers.interrupted();
  };
  const { unsubscribe } = pipe(
    client.subscription<
      WorkFeedUpdatesSubscription,
      WorkFeedUpdatesSubscriptionVariables
    >(WorkFeedUpdatesDocument, { scope: encodeWorkFeedScope(scope) }),
    subscribe((result) => {
      if (result.error) {
        end();
        return;
      }
      const patches = result.data?.workFeedUpdates;
      if (!patches || patches.length === 0) return;
      handlers.patches(patches);
    })
  );
  return () => {
    ended = true;
    unsubscribe();
  };
}
