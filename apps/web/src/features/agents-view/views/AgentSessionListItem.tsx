import { ViewSidebar } from '@app/components/view-shell';
import { AgentPullRequestChip } from '@app/features/block-agent/component/AgentPullRequestChip';
import type { AgentSessionEntity } from '@entity';
import ChatIcon from '@phosphor/chat-circle.svg';
import CodeIcon from '@phosphor/code.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { useAgentSessionQuery } from '@queries/agent-session/session';
import { useAgentsQuery } from '@queries/agents/agents';
import { cn, pressHandlers } from '@ui';
import { ErrorBoundary, Show, Suspense } from 'solid-js';
import { kindForHarness, modeForKind, systemBotKind } from '../core/agent-kind';
import {
  conversationState,
  conversationStateLabel,
} from '../core/conversation-state';
import { compactAge } from '../core/format-age';
import type { AgentsMode } from '../core/mode';
import { conversationTimestamp } from '../core/recent-conversations';

type Props = {
  entity: AgentSessionEntity;
  active?: boolean;
  unread?: boolean;
  mode?: AgentsMode;
  handle?: string;
  onOpen?: (event: MouseEvent) => void;
};

/** The same session row in Home and Agents, backed by shared live metadata. */
export function AgentSessionListItem(props: Props) {
  return (
    <Suspense>
      <SessionListItem {...props} />
    </Suspense>
  );
}

function SessionListItem(props: Props) {
  const query = useAgentSessionQuery(() => props.entity.id);
  const agents = useAgentsQuery();
  const session = () => (query.isSuccess ? query.data : undefined);
  const botId = () =>
    (props.entity.bot?.id ?? props.entity.botId).replace(/^bot\|/, '');
  const agent = () =>
    agents.isSuccess
      ? agents.data.find((agent) => agent.bot.id === botId())
      : undefined;
  const mode = () => {
    const harness = session()?.harness ?? agent()?.harness;
    return harness
      ? modeForKind(kindForHarness(harness))
      : (props.mode ?? modeForKind(systemBotKind(botId()) ?? 'agent'));
  };
  const label = () => {
    const handle = props.handle ?? agent()?.bot.handle;
    if (handle) return `@${handle.replace(/^@/, '')}`;
    return (
      (session()?.harness === 'cursor' ? '@cursor' : undefined) ??
      props.entity.bot?.name
    );
  };
  const title = () => props.entity.name || session()?.name || 'Untitled chat';
  const state = () => conversationState(props.entity.status);
  const pullRequestUrl = () => session()?.pullRequestUrl;

  return (
    <ViewSidebar.Item
      as="div"
      active={props.active}
      class={cn(
        'relative',
        mode() === 'code' && 'h-auto min-h-12 items-start py-1.5 touch:h-auto'
      )}
      data-agent-session-row={props.entity.id}
      data-kind={mode()}
    >
      <button
        type="button"
        class="absolute inset-0 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-accent"
        aria-label={title()}
        aria-current={props.active ? 'page' : undefined}
        title={title()}
        {...pressHandlers((event) => props.onOpen?.(event))}
      />
      <ViewSidebar.Icon class="pointer-events-none relative">
        <Show
          when={state() === 'starting'}
          fallback={
            <Show when={mode() === 'code'} fallback={<ChatIcon />}>
              <CodeIcon />
            </Show>
          }
        >
          <SpinnerIcon class="motion-safe:animate-spin" />
        </Show>
      </ViewSidebar.Icon>
      <span class="pointer-events-none relative min-w-0 flex-1">
        <span class="flex min-w-0 items-center gap-2">
          <span class="min-w-0 flex-1 truncate">{title()}</span>
          <span class="shrink-0 text-xs text-ink-extra-muted tabular-nums">
            {compactAge(conversationTimestamp(props.entity))}
          </span>
          <Show when={props.unread}>
            <span
              aria-label="Unread"
              class="size-1.5 shrink-0 rounded-full bg-accent"
            />
          </Show>
        </span>
        <Show when={mode() === 'code'}>
          <span class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-4 text-ink-extra-muted">
            <Show when={label()}>
              {(name) => <span class="max-w-full truncate">{name()}</span>}
            </Show>
            <Show when={label()}>
              <span>·</span>
            </Show>
            <span>{conversationStateLabel(state())}</span>
            <Show when={pullRequestUrl()}>
              {(url) => (
                <span class="pointer-events-auto min-w-0">
                  <ErrorBoundary fallback={null}>
                    <Suspense>
                      <AgentPullRequestChip url={url()} />
                    </Suspense>
                  </ErrorBoundary>
                </span>
              )}
            </Show>
          </span>
        </Show>
      </span>
    </ViewSidebar.Item>
  );
}
