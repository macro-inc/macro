import { ViewSidebar } from '@app/components/view-shell';
import { AgentPullRequestIcon } from '@app/features/block-agent/component/AgentPullRequestChip';
import { parseGithubPrUrl, prHtmlUrl } from '@app/features/block-pr/util/prKey';
import type { AgentSessionEntity } from '@entity';
import ChatIcon from '@phosphor/chat-circle.svg';
import CodeIcon from '@phosphor/code.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { useAgentSessionQuery } from '@queries/agent-session/session';
import { useAgentsQuery } from '@queries/agents/agents';
import { cn, pressHandlers } from '@ui';
import { ErrorBoundary, Show, Suspense } from 'solid-js';
import { kindForHarness, modeForKind, systemBotKind } from '../core/agent-kind';
import { conversationState } from '../core/conversation-state';
import { compactAge } from '../core/format-age';
import type { AgentsMode } from '../core/mode';
import { conversationTimestamp } from '../core/recent-conversations';

type Props = {
  entity: AgentSessionEntity;
  active?: boolean;
  unread?: boolean;
  mode?: AgentsMode;
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
  const title = () => props.entity.name || session()?.name || 'Untitled chat';
  const state = () => conversationState(props.entity.status);
  const pullRequest = () => parseGithubPrUrl(session()?.pullRequestUrl ?? '');
  const pullRequestUrl = () => {
    const pr = pullRequest();
    return pr ? prHtmlUrl(pr) : undefined;
  };

  return (
    <ViewSidebar.Item
      as="div"
      active={props.active}
      class={cn(
        'relative',
        pullRequest() && 'h-auto min-h-12 items-start py-1.5 touch:h-auto'
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
              <Show when={pullRequestUrl()} fallback={<CodeIcon />}>
                {(url) => (
                  <ErrorBoundary fallback={<CodeIcon />}>
                    <Suspense fallback={<CodeIcon />}>
                      <AgentPullRequestIcon url={url()} />
                    </Suspense>
                  </ErrorBoundary>
                )}
              </Show>
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
        <Show when={pullRequest()}>
          {(pr) => (
            <a
              href={prHtmlUrl(pr())}
              target="_blank"
              rel="noreferrer"
              class="pointer-events-auto block truncate text-xs leading-4 text-ink-extra-muted hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent"
              onClick={(event) => event.stopPropagation()}
            >
              View PR #{pr().number} in GitHub
            </a>
          )}
        </Show>
      </span>
    </ViewSidebar.Item>
  );
}
