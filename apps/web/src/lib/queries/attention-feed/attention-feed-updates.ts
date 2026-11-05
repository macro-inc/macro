import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import type { Client } from '@urql/core';
import { pipe, subscribe } from 'wonka';

export type AttentionFeedUpdatesHandlers<Patch> = {
  /** One server batch, to apply together. */
  patches: (patches: readonly Patch[]) => void;
  /** The stream errored or ended: changes may be missed until resubscribed. */
  interrupted: () => void;
};

/** One feed's live stream: its document and the batch each result carries. */
export type AttentionFeedUpdates<
  Data,
  Patch,
  Variables extends Record<string, unknown>,
> = {
  document: TypedDocumentNode<Data, Variables>;
  patches: (data: Data) => readonly Patch[] | undefined;
};

/** Follow one feed's live changes; returns the unsubscribe function. */
export function subscribeToAttentionFeedUpdates<
  Data,
  Patch,
  Variables extends Record<string, unknown>,
>(
  client: Client,
  updates: AttentionFeedUpdates<Data, Patch, Variables>,
  variables: Variables,
  handlers: AttentionFeedUpdatesHandlers<Patch>
): () => void {
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    handlers.interrupted();
  };
  const { unsubscribe } = pipe(
    client.subscription(updates.document, variables),
    subscribe((result) => {
      if (result.error) {
        end();
        return;
      }
      const patches = result.data ? updates.patches(result.data) : undefined;
      if (!patches || patches.length === 0) return;
      handlers.patches(patches);
    })
  );
  return () => {
    ended = true;
    unsubscribe();
  };
}
