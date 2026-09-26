import { ListFilterDropdown } from '@app/components/view-shell';
import { SidePanel } from '@components/app/side-panel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { AgentSessionMentionLabel } from '@core/component/LexicalMarkdown/component/decorator/AgentSessionMentionLabel';
import { toast } from '@core/component/Toast/Toast';
import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import { useAgentSessionMentionPreview } from '@queries/agent-session/mentions';
import {
  useAgentSessionPullRequestsQuery,
  useLinkAgentSessionPullRequestMutation,
  usePullRequestAgentSessionsQuery,
  useUnlinkAgentSessionPullRequestMutation,
} from '@queries/agent-session/pull-requests';
import { useQuickAccessAgentSessionsQuery } from '@queries/soup/quick-access-agent-sessions';
import { Button, Dropdown } from '@ui';
import { For, Show } from 'solid-js';

const pullRequestKey = (url: string) =>
  url.replace(/^https:\/\/github\.com\//i, '').toLowerCase();

function LinkedSessionRow(props: { sessionId: string; url: string }) {
  const layout = useSplitLayout();
  const preview = useAgentSessionMentionPreview(
    () => props.sessionId,
    () => true
  );
  const links = useAgentSessionPullRequestsQuery(() => props.sessionId);
  const unlink = useUnlinkAgentSessionPullRequestMutation();
  const session = () => {
    const current = preview.isSuccess ? preview.data : undefined;
    return current?.access === 'access' ? current.data : undefined;
  };
  const label = () => {
    const current = preview.isSuccess ? preview.data : undefined;
    if (current?.access === 'no_access') return 'Private agent session';
    if (current?.access === 'does_not_exist') return 'Deleted agent session';
    return session()?.name || 'Agent session';
  };
  // The pull request the session's agent opened cannot be unlinked.
  const linkedByPerson = () =>
    links.isSuccess &&
    links.data.some(
      (link) =>
        link.source === 'user' &&
        link.githubKey.toLowerCase() === pullRequestKey(props.url)
    );

  return (
    <div class="flex h-6 min-w-0 items-center gap-2">
      <button
        type="button"
        class="min-w-0 truncate text-left disabled:text-ink-placeholder"
        disabled={!session()}
        onClick={(event) =>
          layout?.openWithSplit(
            { type: 'agent', id: props.sessionId },
            { preferNewSplit: event.shiftKey }
          )
        }
      >
        <AgentSessionMentionLabel label={label()} />
      </button>
      <Show when={linkedByPerson()}>
        <Button
          variant="ghost"
          size="icon-xs"
          class="ml-auto"
          label={`Unlink ${label()}`}
          disabled={unlink.isPending}
          onClick={() =>
            unlink.mutate(
              { sessionId: props.sessionId, url: props.url },
              {
                onError: () =>
                  toast.failure('Couldn’t unlink the agent session.'),
              }
            )
          }
        >
          <XIcon />
        </Button>
      </Show>
    </div>
  );
}

function LinkSessionPicker(props: {
  url: string;
  linkedSessionIds: readonly string[];
}) {
  const sessions = useQuickAccessAgentSessionsQuery();
  const link = useLinkAgentSessionPullRequestMutation();
  const options = () =>
    sessions
      .sessions()
      .filter((session) => !props.linkedSessionIds.includes(session.id))
      .map((session) => ({
        id: session.id,
        label: session.name || 'Agent session',
      }));

  return (
    <ListFilterDropdown
      label="Link agent session"
      customTrigger={
        <Dropdown.Trigger variant="ghost" size="xs" label="Link agent session">
          <PlusIcon />
          Link session
        </Dropdown.Trigger>
      }
      groups={[
        {
          id: 'session',
          label: 'Agent sessions',
          options: options(),
          searchPlaceholder: 'Search agent sessions',
        },
      ]}
      isSelected={(_group, id) => props.linkedSessionIds.includes(id)}
      onSelectionChange={(_group, sessionId, selected) => {
        if (!selected) return;
        link.mutate(
          { sessionId, url: props.url },
          {
            onError: () => toast.failure('Couldn’t link the agent session.'),
          }
        );
      }}
    />
  );
}

/** Agent sessions linked to a pull request, from either side of the link. */
export function PrAgentSessionsSection(props: { url?: string }) {
  const sessions = usePullRequestAgentSessionsQuery(() => props.url);
  const sessionIds = () => (sessions.isSuccess ? sessions.data : []);

  return (
    <SidePanel.Section id="pr-agent-sessions" title="Agent sessions" order={30}>
      <Show
        when={props.url}
        fallback={<div class="text-ink-placeholder">No agent sessions</div>}
      >
        {(url) => (
          <div class="flex flex-col gap-1 text-xs">
            <Show
              when={sessionIds().length > 0}
              fallback={
                <div class="text-ink-placeholder">
                  {sessions.isError
                    ? 'Agent sessions couldn’t be loaded'
                    : 'No agent sessions'}
                </div>
              }
            >
              <For each={sessionIds()}>
                {(sessionId) => (
                  <LinkedSessionRow sessionId={sessionId} url={url()} />
                )}
              </For>
            </Show>
            <div>
              <LinkSessionPicker url={url()} linkedSessionIds={sessionIds()} />
            </div>
          </div>
        )}
      </Show>
    </SidePanel.Section>
  );
}
