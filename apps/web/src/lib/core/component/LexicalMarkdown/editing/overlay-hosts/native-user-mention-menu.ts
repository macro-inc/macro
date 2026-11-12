import type { EntityItem } from '@core/context/quickAccess';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { selectionMessage } from '@macro-inc/lexical-wasm-view/view/session-port';
import {
  handleEntityMentionWithInsertion,
  tracksMentions,
} from '../../component/menu/MentionsMenu/utils/mentionHandlers';
import {
  dispatchApplicationCommandIfSessionEdit,
  dispatchApplicationCommandSettled,
} from '../../plugins/group-b/command';
import type { HandlerDependencies } from '../../utils/mentionsUtils';
import {
  handleUserMentionWithInsertion,
  type UserMentionInsertion,
} from '../../utils/mentionsUtils';
import type { MentionMenuHost } from './mentions';

/** Real source facts captured at the shared controller's host initialization. */
export type NativeUserMentionSource = Pick<
  UserMentionInsertion,
  'blockName' | 'onUserMention' | 'disableMentionTracking'
> &
  Pick<HandlerDependencies, 'onDocumentMention' | 'onEmailMention'> & {
    readonly sourceDocumentId: string;
  };

export function createNativeUserMentionMenuHost(
  view: EditorView,
  source: NativeUserMentionSource,
  alive: () => boolean
): MentionMenuHost {
  const { blockName, sourceDocumentId, onUserMention, disableMentionTracking } =
    source;
  const active = () => alive() && view.isMounted;
  async function selectEntity(item: EntityItem): Promise<void> {
    const generation = view.mirror.keyGeneration;
    if (!active() || generation === null) return;
    const port = view.port;
    if (!port.inputSettledIfSessionEdit)
      throw new Error('Entity mentions require settled session edit admission');
    const inputSettled = port.inputSettledIfSessionEdit.bind(port);
    const current = () => active() && view.mirror.keyGeneration === generation;
    const command = async (name: string, buildPayload: () => unknown) => {
      if (!current()) return false;
      const result = await inputSettled(
        () => ({
          name,
          json: JSON.stringify(buildPayload()),
          generation,
          // Source insertion uses the actual model selection after tracking I/O.
          selection: selectionMessage({ kind: 'keep' }),
        }),
        { admit: current }
      );
      if (result.status === 'error') throw result.error;
      return result.status === 'success';
    };
    if (!(await command('group-a.search-remove', () => ({}))) || !current())
      return;
    await handleEntityMentionWithInsertion(item, () => ({
      blockId: sourceDocumentId,
      onDocumentMention: source.onDocumentMention,
      onEmailMention: source.onEmailMention,
      tracksMentions: () =>
        tracksMentions({
          blockId: sourceDocumentId,
          blockName,
          disableMentionTracking,
        }),
      async insert(buildPayload) {
        if (!current()) return;
        await command('group-b.insert-document-mention', buildPayload);
      },
    }));
  }
  return {
    root: () => (active() ? view.root : null),
    closeSearch() {
      // Closing the UI writes only under current session edit access.
      if (active())
        dispatchApplicationCommandIfSessionEdit(
          view,
          'group-a.search-close',
          {}
        );
    },
    async select(item) {
      if (item.kind === 'entity') return await selectEntity(item);
      if (item.kind !== 'user')
        throw new Error(
          'This native mention stage supports user and document entity choices only'
        );
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
