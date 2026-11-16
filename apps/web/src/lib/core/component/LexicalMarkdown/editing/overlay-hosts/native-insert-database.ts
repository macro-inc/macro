import { toast } from '@core/component/Toast/Toast';
import { trackMention, untrackMention } from '@core/signal/mention';
import { Telemetry } from '@macro-inc/observability';
import { createDatabase } from '@queries/storage/databases';
import type { ActionContext } from '../../plugins/actions/types';

/** Service order shared with Source: create, recheck the anchored target, track. */
export async function createAndTrackDatabase(
  context: ActionContext | undefined,
  current: () => boolean
) {
  const requestContext = Telemetry.captureContext();
  const created = await createDatabase({
    name: 'Untitled database',
    source: 'slash-menu',
  });
  if (created.isErr()) {
    toast.failure('Your database could not be created. Try again.');
    return;
  }
  // Source retains the created database if the user removed its pending insert.
  if (!current()) return;
  const source = context?.sourceDocumentId;
  const mentionUuid =
    source &&
    !context?.disableMentionTracking &&
    context?.sourceBlockName !== 'channel' &&
    context?.sourceBlockName !== 'chat'
      ? await requestContext.run(() =>
          trackMention(source, 'database', created.value)
        )
      : undefined;
  return {
    id: created.value,
    mentionUuid,
    untrack: async () => {
      if (source && mentionUuid)
        await requestContext.run(() => untrackMention(source, mentionUuid));
    },
  };
}
