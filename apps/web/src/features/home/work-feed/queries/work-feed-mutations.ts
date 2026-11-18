import {
  MarkWorkFeedItemsDoneDocument,
  UndoWorkFeedItemsDoneDocument,
  type WorkFeedPatchFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import type { WorkFeedScope } from '../core/work-feed';
import { encodeWorkFeedScope } from './decode';

/** The reasons a viewer observed on one item, as done acknowledges them. */
export type WorkFeedDoneItem = { itemId: string; revision: string };

/** Mark items done; resolves to the token that reverses exactly this done. */
export async function markWorkFeedItemsDone(
  client: Client,
  items: readonly WorkFeedDoneItem[]
): Promise<{ undoToken: string }> {
  const result = await client
    .mutation(MarkWorkFeedItemsDoneDocument, {
      input: {
        items: items.map((item) => ({
          id: item.itemId,
          revision: item.revision,
        })),
      },
    })
    .toPromise();
  const payload = result.data?.markWorkFeedItemsDone;
  if (result.error || !payload) {
    throw result.error ?? new Error('Marking work feed items done failed');
  }
  return { undoToken: payload.undoToken };
}

/** Reverse one done; resolves to the restored items' places in `scope`. */
export async function undoWorkFeedItemsDone(
  client: Client,
  undoToken: string,
  scope: WorkFeedScope
): Promise<WorkFeedPatchFieldsFragment[]> {
  const result = await client
    .mutation(UndoWorkFeedItemsDoneDocument, {
      input: { undoToken, scope: encodeWorkFeedScope(scope) },
    })
    .toPromise();
  const payload = result.data?.undoWorkFeedItemsDone;
  if (result.error || !payload) {
    throw result.error ?? new Error('Undoing work feed done failed');
  }
  return payload.patches;
}
