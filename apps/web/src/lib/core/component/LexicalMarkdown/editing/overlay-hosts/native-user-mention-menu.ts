import type { EditorView } from '@macro-inc/lexical-wasm-view';
import {
  dispatchApplicationCommand,
  dispatchApplicationCommandSettled,
} from '../../plugins/group-b/command';
import {
  handleUserMentionWithInsertion,
  type UserMentionInsertion,
} from '../../utils/mentionsUtils';
import type { MentionMenuHost } from './mentions';

/** Real source facts captured at the shared controller's host initialization. */
export type NativeUserMentionSource = Pick<
  UserMentionInsertion,
  'blockName' | 'onUserMention' | 'disableMentionTracking'
> & { readonly sourceDocumentId: string };

export function createNativeUserMentionMenuHost(
  view: EditorView,
  source: NativeUserMentionSource,
  alive: () => boolean
): MentionMenuHost {
  const { blockName, sourceDocumentId, onUserMention, disableMentionTracking } =
    source;
  const active = () => alive() && view.isMounted;
  return {
    root: () => (active() ? view.root : null),
    closeSearch() {
      if (active())
        dispatchApplicationCommand(view, 'group-a.search-close', {});
    },
    async select(item) {
      if (item.kind !== 'user')
        throw new Error('This native mention stage supports user choices only');
      if (!active()) return;
      const removal = await dispatchApplicationCommandSettled(
        view,
        'group-a.search-remove',
        {}
      );
      if (removal.status === 'error') throw removal.error;
      if (removal.status === 'cancelled' || !active()) return;
      // Completed-but-unhandled REMOVE is legitimate when no search remains.
      await handleUserMentionWithInsertion(item.data, () => ({
        blockName,
        blockId: sourceDocumentId,
        onUserMention,
        disableMentionTracking,
        insert(buildPayload) {
          if (!active()) return;
          const payload = buildPayload();
          return dispatchApplicationCommandSettled(
            view,
            'group-a.insert-user-mention',
            {
              userId: payload.userId,
              email: payload.email,
              ...(payload.displayName === undefined
                ? {}
                : { displayName: payload.displayName }),
              ...(payload.mentionUuid === undefined
                ? {}
                : { mentionUuid: payload.mentionUuid }),
            }
          ).then((result) => {
            if (result.status === 'error') throw result.error;
            if (result.status === 'cancelled') return;
            // Completed-but-unhandled is distinct from actual close cancellation.
          });
        },
      }));
    },
  };
}
