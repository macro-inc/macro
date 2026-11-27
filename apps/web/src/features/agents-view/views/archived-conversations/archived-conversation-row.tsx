import type { EntityActionListState } from '@app/features/next-soup/actions';
import { SoupEntityActionsDropdown } from '@app/features/soup/SoupEntityActionsDropdown';
import { formatLocale, t } from '@app/lib/i18n';
import ArchiveIcon from '@icon/system/regular/archive.svg';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import RoutineIcon from '@icon/system/regular/clock-clockwise.svg';
import CodeIcon from '@icon/system/regular/code.svg';
import MoreIcon from '@icon/system/regular/dots-three.svg';
import { Button } from '@ui';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { ArchivedRowRoot } from '../../components/archived-row/root';
import {
  AGENTS_ACTION_VIEW_CONTEXT,
  type ConversationActions,
} from '../../context/conversation-actions';
import type { AgentsMode } from '../../core/mode';
import type { AgentConversationEntity } from '../../core/recent-conversations';
import { conversationCodeDetails } from '../../queries/conversation-code-details';
import { ConversationCodeLink } from '../shared/conversation-code-link/conversation-code-link';
import { ConversationContextMenu } from '../shared/conversation-context-menu/conversation-context-menu';

export function ArchivedConversationRow(props: {
  conversation: AgentConversationEntity;
  mode: AgentsMode;
  list: EntityActionListState;
  actions: ConversationActions;
  onOpen: (event: MouseEvent) => void;
}) {
  const [restoring, setRestoring] = createSignal(false);
  const title = () =>
    props.conversation.name ||
    (props.conversation.type === 'agent_session'
      ? t('agentWork.untitledConversation')
      : t('agentWork.untitledChat'));
  const details = () =>
    props.conversation.type === 'agent_session' && props.mode === 'code'
      ? conversationCodeDetails(props.conversation)
      : undefined;
  const date = () => {
    if (
      props.conversation.type !== 'agent_session' ||
      !props.conversation.archivedAt
    )
      return '';
    const value = new Date(props.conversation.archivedAt);
    if (Number.isNaN(value.getTime())) return '';
    return new Intl.DateTimeFormat(formatLocale(), {
      month: 'short',
      day: 'numeric',
      year:
        value.getFullYear() === new Date().getFullYear()
          ? undefined
          : 'numeric',
    }).format(value);
  };
  const unarchive = async () => {
    if (restoring()) return;
    setRestoring(true);
    try {
      await props.actions.unarchive(props.conversation.id);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <ConversationContextMenu
      conversation={props.conversation}
      list={props.list}
    >
      <ArchivedRowRoot title={title()} onOpen={props.onOpen}>
        <span class="pointer-events-none relative flex min-w-0 flex-1 items-center gap-2.5">
          <Switch>
            <Match
              when={
                props.conversation.type === 'agent_session' &&
                props.conversation.source === 'routine'
              }
            >
              <RoutineIcon class="size-4 shrink-0 text-ink-muted" />
            </Match>
            <Match when={props.mode === 'code'}>
              <CodeIcon class="size-4 shrink-0 text-ink-muted" />
            </Match>
            <Match when={true}>
              <ChatIcon class="size-4 shrink-0 text-ink-muted" />
            </Match>
          </Switch>
          <span class="truncate text-sm font-normal text-ink">{title()}</span>
        </span>
        <span class="pointer-events-none relative flex w-[220px] shrink-0 items-center gap-1.5">
          <Show when={details()}>
            {(code) => (
              <>
                <Show when={code().pullRequest || code().branch}>
                  <span class="pointer-events-auto">
                    <ConversationCodeLink
                      details={code()}
                      actions={props.actions}
                      onOpenRow={props.onOpen}
                    />
                  </span>
                </Show>
                <span
                  class={
                    code().pullRequest
                      ? 'truncate text-sm text-ink-muted'
                      : 'truncate font-mono text-xs text-ink-muted'
                  }
                >
                  {code().pullRequest
                    ? `#${code().pullRequest?.number}`
                    : code().branch}
                </span>
              </>
            )}
          </Show>
        </span>
        <span class="pointer-events-none relative flex w-40 shrink-0 items-center justify-end">
          <span class="archive-date pointer-events-none text-sm text-ink-muted">
            {date()}
          </span>
          <span class="archive-actions items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              class="pointer-events-auto"
              disabled={restoring()}
              onClick={unarchive}
            >
              <ArchiveIcon class="size-3.5" />
              {t('entityActions.unarchive')}
            </Button>
            <SoupEntityActionsDropdown
              entity={props.conversation}
              list={props.list}
              viewContext={AGENTS_ACTION_VIEW_CONTEXT}
              placement="bottom-end"
              triggerProps={{
                size: 'icon-sm',
                class: 'pointer-events-auto',
                'aria-label': t('agentWork.moreActions'),
                onClick: () => props.list.focus.set(props.conversation.id),
              }}
            >
              <MoreIcon class="size-4" />
            </SoupEntityActionsDropdown>
          </span>
        </span>
      </ArchivedRowRoot>
    </ConversationContextMenu>
  );
}
