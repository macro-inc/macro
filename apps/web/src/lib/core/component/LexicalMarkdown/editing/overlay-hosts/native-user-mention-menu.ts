import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { selectionMessage } from '@macro-inc/lexical-wasm-view/view/session-port';
import { match } from 'ts-pattern';
import {
  type AgentSessionMentionInsertion,
  type CrmMentionInsertion,
  handleAgentSessionMentionWithInsertion,
  handleBookingLinkMentionWithInsertion,
  handleCalendarEventMentionWithInsertion,
  handleCrmMentionWithInsertion,
  handleDateMentionWithInsertion,
  handleEntityMentionWithInsertion,
  handleExternalChatMentionWithInsertion,
  handleGroupMentionWithInsertion,
  handleRoutineMentionWithInsertion,
  tracksMentions,
} from '../../component/menu/MentionsMenu/utils/mentionHandlers';
import {
  dispatchApplicationCommandIfSessionEdit,
  dispatchApplicationCommandSettled,
} from '../../plugins/group-b/command';
import type {
  HandlerDependencies,
  MentionItem,
} from '../../utils/mentionsUtils';
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
  /**
   * Source removes the search first, then inserts at the model selection that
   * is current once any tracking or sharing I/O settles. Menu close does not
   * cancel it; edit access and the captured key generation are checked at each
   * write, and a retired generation inserts nothing
   * (C-NATIVE-GENERATION-RETIRE-NO-RETARGET-01).
   */
  async function withRemovedSearch(
    insert: (
      command: (name: string, buildPayload: () => unknown) => Promise<boolean>
    ) => Promise<void>
  ): Promise<void> {
    const generation = view.mirror.keyGeneration;
    if (!active() || generation === null) return;
    const port = view.port;
    if (!port.inputSettledIfSessionEdit)
      throw new Error('Mentions require settled session edit admission');
    const inputSettled = port.inputSettledIfSessionEdit.bind(port);
    const current = () => active() && view.mirror.keyGeneration === generation;
    const command = async (name: string, buildPayload: () => unknown) => {
      if (!current()) return false;
      const result = await inputSettled(
        () => ({
          name,
          json: JSON.stringify(buildPayload()),
          generation,
          selection: selectionMessage({ kind: 'keep' }),
        }),
        { admit: current }
      );
      if (result.status === 'error') throw result.error;
      return result.status === 'success';
    };
    if (!(await command('group-a.search-remove', () => ({}))) || !current())
      return;
    await insert(command);
  }
  const tracks = () =>
    tracksMentions({
      blockId: sourceDocumentId,
      blockName,
      disableMentionTracking,
    });
  function write(
    command: (name: string, buildPayload: () => unknown) => Promise<boolean>,
    name: string
  ) {
    return {
      async insert(buildPayload: () => unknown) {
        await command(name, buildPayload);
      },
    };
  }
  function agentSessionInsertion(
    command: (name: string, buildPayload: () => unknown) => Promise<boolean>
  ): AgentSessionMentionInsertion {
    return {
      blockId: sourceDocumentId,
      tracksMentions: tracks,
      ...write(command, 'group-b.insert-agent-session-mention'),
    };
  }
  function crmInsertion(
    command: (name: string, buildPayload: () => unknown) => Promise<boolean>
  ): CrmMentionInsertion {
    return {
      blockId: sourceDocumentId,
      tracksMentions: tracks,
      ...write(command, 'group-b.insert-document-mention'),
    };
  }
  function selectOther(item: Exclude<MentionItem, { kind: 'user' }>) {
    return withRemovedSearch((command) => {
      const document = () => write(command, 'group-b.insert-document-mention');
      return match(item)
        .with({ kind: 'entity' }, (entity) =>
          handleEntityMentionWithInsertion(entity, () => ({
            blockId: sourceDocumentId,
            onDocumentMention: source.onDocumentMention,
            onEmailMention: source.onEmailMention,
            // Source handleEntityMention routes agent_session and CRM entities too.
            selectAgent: (session) =>
              handleAgentSessionMentionWithInsertion(session, () =>
                agentSessionInsertion(command)
              ),
            selectCrm: (crm) =>
              handleCrmMentionWithInsertion(crm, () => crmInsertion(command)),
            tracksMentions: tracks,
            ...document(),
          }))
        )
        .with({ kind: 'date' }, (date) =>
          handleDateMentionWithInsertion(date.data, () =>
            write(command, 'group-a.insert-date-mention')
          )
        )
        .with({ kind: 'agentSession' }, (session) =>
          handleAgentSessionMentionWithInsertion(
            { id: session.id, name: session.data.name },
            () => agentSessionInsertion(command)
          )
        )
        .with({ kind: 'bookingLink' }, (booking) =>
          handleBookingLinkMentionWithInsertion(booking, () =>
            write(command, 'group-b.insert-booking-link-mention')
          )
        )
        .with({ kind: 'group' }, (group) =>
          handleGroupMentionWithInsertion(group.data, () =>
            write(command, 'group-b.insert-group-mention')
          )
        )
        .with({ kind: 'calendarEvent' }, (event) =>
          handleCalendarEventMentionWithInsertion(event, document)
        )
        .with({ kind: 'externalChat' }, (chat) =>
          handleExternalChatMentionWithInsertion(chat.data, document)
        )
        .with({ kind: 'routine' }, (routine) =>
          handleRoutineMentionWithInsertion(routine.data, document)
        )
        .exhaustive();
    });
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
      if (item.kind !== 'user') return await selectOther(item);
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
