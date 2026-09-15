import { ViewSidebarToggle } from '@app/components/view-shell/ViewShell';
import { AgentComposer } from '@app/features/block-agent/component/AgentComposer';
import { harnessDisplayName } from '@app/features/block-agent/component/compose-agent-session-options';
import { Transcript } from '@app/features/block-agent/component/Transcript';
import {
  AgentSessionProvider,
  useAgentSession,
} from '@app/features/block-agent/context/AgentSessionContext';
import {
  forgetPendingSession,
  pendingSession,
} from '@app/features/block-agent/context/pending-session';
import { SessionStatusPill } from '@app/features/block-agent/ui';
import { LoadErrorPanel } from '@core/component/EntityLoadGate';
import { MagicChipPullRequest } from '@core/component/LexicalMarkdown/component/decorator/MagicChip/MagicChipPullRequest';
import { openExternalUrl } from '@core/util/url';
import GitBranchIcon from '@phosphor/git-branch.svg';
import { Button } from '@ui';
import { onCleanup, Show } from 'solid-js';
import type { AgentsMode } from '../core/mode';
import { repositoryLabel } from '../core/repository';

function MetaItem(props: { label: string; value: string }) {
  return (
    <span class="flex min-w-0 items-baseline gap-1.5">
      <span class="shrink-0 text-ink-disabled">{props.label}</span>
      <span class="truncate text-ink-muted">{props.value}</span>
    </span>
  );
}

/**
 * Header for a conversation opened in the workspace: the title, the runtime's
 * status, and — for a coder — where it runs and what it opened.
 */
function AgentSessionHeader(props: { mode: AgentsMode }) {
  const { loadFailed, metadata, pending, session, status } = useAgentSession();
  const title = () => metadata()?.title ?? session()?.name ?? 'New chat';
  const repoUrl = () => session()?.repoUrl ?? undefined;
  const pullRequestUrl = () => session()?.pullRequestUrl ?? undefined;
  const showMeta = () => props.mode === 'code' && !!session();

  return (
    <header class="flex shrink-0 flex-col border-b border-edge">
      <div class="flex h-12 items-center gap-3 px-4">
        <h2 class="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {title()}
        </h2>
        <Show when={pullRequestUrl()}>
          {(url) => (
            <span class="flex min-w-0 max-w-[40%] items-center text-xs">
              <MagicChipPullRequest url={url()} />
            </span>
          )}
        </Show>
        <Show when={repoUrl()}>
          {(url) => (
            <Button
              variant="outline"
              size="sm"
              class="h-6 max-w-48 gap-1.5 rounded-full px-2 text-xs text-ink-muted"
              tooltip="Open repository"
              onClick={() => openExternalUrl(url())}
            >
              <GitBranchIcon class="size-3 shrink-0" />
              <span class="truncate">{repositoryLabel(url())}</span>
            </Button>
          )}
        </Show>
        <Show when={!pending() && !loadFailed()}>
          <SessionStatusPill status={status()} />
        </Show>
      </div>
      <Show when={showMeta()}>
        <div class="flex min-w-0 items-center gap-4 overflow-hidden px-4 pb-2 font-mono text-[11px] text-ink-placeholder">
          <Show when={session()?.harness}>
            {(harness) => (
              <MetaItem label="runtime" value={harnessDisplayName(harness())} />
            )}
          </Show>
          <Show when={metadata()?.model ?? session()?.model}>
            {(model) => <MetaItem label="model" value={model()} />}
          </Show>
          <Show when={session()?.id}>
            {(id) => <MetaItem label="session" value={id()} />}
          </Show>
        </div>
      </Show>
    </header>
  );
}

function AgentSessionContent(props: { mode: AgentsMode }) {
  const { loadFailed, loadRetryable, retryLoad } = useAgentSession();

  return (
    <>
      <AgentSessionHeader mode={props.mode} />
      <Show
        when={!loadFailed()}
        fallback={
          <LoadErrorPanel
            title="Unable to load this session"
            onRetry={loadRetryable() ? retryLoad : undefined}
          />
        }
      >
        <div class="flex min-h-0 flex-1 overflow-hidden">
          <Transcript />
        </div>
        <div class="mx-auto w-full max-w-4xl shrink-0 px-4 pb-4">
          <AgentComposer autofocus />
        </div>
      </Show>
    </>
  );
}

export function AgentSessionPane(props: {
  id: string;
  mode: AgentsMode;
  onSessionId: (sessionId: string) => void;
}) {
  const pending = pendingSession(props.id);
  onCleanup(() => {
    if (pending?.sessionId() || pending?.failed()) {
      forgetPendingSession(props.id);
    }
  });

  return (
    <AgentSessionProvider blockId={props.id} onSessionId={props.onSessionId}>
      <AgentSessionContent mode={props.mode} />
    </AgentSessionProvider>
  );
}
