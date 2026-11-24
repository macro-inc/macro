import { t } from '@app/lib/i18n';
import { unreadFilterFn } from '@entity/utils/filter';
import ArchiveIcon from '@icon/system/regular/archive.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { SessionStatusGlyph } from '../../../components/session-status-glyph/session-status-glyph';
import type { ConversationActions } from '../../../context/conversation-actions';
import { conversationState } from '../../../core/conversation-state';
import type { AgentsMode } from '../../../core/mode';
import type { AgentConversationEntity } from '../../../core/recent-conversations';
import { literalSearchRange } from '../../../core/search-match';
import { sessionRowStatus } from '../../../core/session-status';
import { conversationCodeDetails } from '../../../queries/conversation-code-details';
import { CodeDetailsContent } from '../code-details-drawer/content';
import { CodeDetailsRoot } from '../code-details-drawer/root';
import { CodeDetailsTrigger } from '../code-details-drawer/trigger';

export function PhoneConversationRow(props: {
  conversation: AgentConversationEntity;
  archived?: boolean;
  mode: AgentsMode;
  waiting?: boolean;
  search?: string;
  actions: ConversationActions;
  onOpen: (event: MouseEvent) => void;
}) {
  const code = () => {
    if (props.conversation.type !== 'agent_session' || props.mode !== 'code')
      return undefined;
    const details = conversationCodeDetails(props.conversation);
    return details?.pullRequest || details?.branch ? details : undefined;
  };
  const state = () =>
    props.conversation.type === 'agent_session'
      ? conversationState(
          props.conversation.status,
          props.conversation.turnState
        )
      : 'dormant';
  const status = () =>
    sessionRowStatus(
      state(),
      props.conversation.type === 'agent_session' &&
        props.conversation.turnState === 'failed',
      unreadFilterFn(props.conversation),
      !!props.waiting
    );
  const title = () =>
    props.conversation.name ||
    (props.conversation.type === 'agent_session'
      ? t('agentWork.untitledConversation')
      : t('agentWork.untitledChat'));
  const match = () => literalSearchRange(title(), props.search);
  return (
    <div
      data-press-surface
      class="soup-list-entity flex h-[46px] w-full min-w-0 shrink-0 items-center gap-2 px-3 text-ink"
    >
      <Button
        appearance="bare"
        class="flex h-full min-w-0 flex-1 items-center gap-2 p-0 text-left font-normal focus-visible:outline-2 focus-visible:outline-edge-focus"
        onClick={props.onOpen}
      >
        <span class="flex size-5 shrink-0 items-center justify-center">
          <Show
            when={props.archived}
            fallback={<SessionStatusGlyph state={status()} />}
          >
            <ArchiveIcon class="size-3.5 text-ink-muted" />
          </Show>
        </span>
        <span class="min-w-0 flex-1 truncate text-base font-normal">
          <Show when={match()} fallback={title()}>
            {(range) => (
              <>
                {title().slice(0, range().start)}
                <mark class="rounded-sm bg-active text-inherit font-normal">
                  {title().slice(range().start, range().end)}
                </mark>
                {title().slice(range().end)}
              </>
            )}
          </Show>
        </span>
      </Button>
      <Show when={code()} fallback={<span class="w-11 shrink-0" />}>
        {(details) => (
          <CodeDetailsRoot details={details()} actions={props.actions}>
            <CodeDetailsTrigger class="size-11" />
            <CodeDetailsContent />
          </CodeDetailsRoot>
        )}
      </Show>
    </div>
  );
}
