import { formatLocale, t } from '@app/lib/i18n';
import { unreadFilterFn } from '@entity/utils/filter';
import RoutineIcon from '@icon/system/regular/clock-clockwise.svg';
import { Show } from 'solid-js';
import { ConversationRowRoot } from '../../../components/conversation-row/root';
import { ConversationRowStatus } from '../../../components/conversation-row/status';
import { ConversationRowTitle } from '../../../components/conversation-row/title';
import { ConversationRowTrailing } from '../../../components/conversation-row/trailing';
import type { ConversationActions } from '../../../context/conversation-actions';
import {
  type ConversationSort,
  sortConversationTimestamp,
} from '../../../core/conversation-list';
import { conversationState } from '../../../core/conversation-state';
import { compactAge } from '../../../core/format-age';
import type { AgentsMode } from '../../../core/mode';
import type { AgentConversationEntity } from '../../../core/recent-conversations';
import { conversationCodeDetails } from '../../../queries/conversation-code-details';
import { ConversationCodeLink } from '../conversation-code-link/conversation-code-link';

export function ConversationRow(props: {
  conversation: AgentConversationEntity;
  mode: AgentsMode;
  sort: ConversationSort;
  waiting?: boolean;
  active?: boolean;
  actions: ConversationActions;
  onOpen: (event: MouseEvent) => void;
}) {
  const state = () =>
    props.conversation.type === 'agent_session'
      ? conversationState(
          props.conversation.status,
          props.conversation.turnState
        )
      : 'dormant';
  const failed = () =>
    props.conversation.type === 'agent_session' &&
    props.conversation.turnState === 'failed';
  const details = () =>
    props.conversation.type === 'agent_session' && props.mode === 'code'
      ? conversationCodeDetails(props.conversation)
      : undefined;
  const title = () =>
    props.conversation.name ||
    (props.conversation.type === 'agent_session'
      ? t('agentWork.untitledConversation')
      : t('agentWork.untitledChat'));

  return (
    <ConversationRowRoot
      id={props.conversation.id}
      title={title()}
      kind={props.mode}
      state={state()}
      failed={failed()}
      unread={unreadFilterFn(props.conversation)}
      waiting={props.waiting}
      untitled={!props.conversation.name}
      active={props.active}
      onOpen={props.onOpen}
    >
      <ConversationRowStatus />
      <ConversationRowTitle />
      <Show
        when={
          props.conversation.type === 'agent_session' &&
          props.conversation.source === 'routine'
        }
      >
        <RoutineIcon
          aria-label={t('agentWork.routineRun')}
          class="pointer-events-none relative size-3.5 shrink-0 text-ink-extra-muted"
        />
      </Show>
      <ConversationRowTrailing
        age={compactAge(
          sortConversationTimestamp(props.conversation, props.sort),
          Date.now(),
          formatLocale()
        )}
      >
        <Show when={details()}>
          {(code) => (
            <Show when={code().pullRequest || code().branch}>
              <ConversationCodeLink
                details={code()}
                actions={props.actions}
                onOpenRow={props.onOpen}
              />
            </Show>
          )}
        </Show>
      </ConversationRowTrailing>
    </ConversationRowRoot>
  );
}
