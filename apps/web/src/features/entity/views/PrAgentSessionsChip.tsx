import { useSplitLayout } from '@components/app/split-layout/layout';
import { useAgentSessionMentionPreview } from '@queries/agent-session/mentions';
import { usePullRequestAgentSessionsQuery } from '@queries/agent-session/pull-requests';
import { type Accessor, createSignal, For, Show, Suspense } from 'solid-js';
import {
  PrAgentSessionChip,
  PrAgentSessionMenuItem,
  PrAgentSessionsCountChip,
} from '../components/PrAgentSessionsChip';

function useSessionDisplay(id: Accessor<string>, enabled: Accessor<boolean>) {
  const preview = useAgentSessionMentionPreview(id, enabled);
  const current = () => (preview.isSuccess ? preview.data : undefined);
  return {
    available: () => current()?.access === 'access',
    label: () => {
      const session = current();
      if (session?.access === 'access')
        return session.data.name || 'Agent session';
      if (session?.access === 'no_access') return 'Private agent session';
      if (session?.access === 'does_not_exist') return 'Deleted agent session';
      return preview.isError ? 'Agent session unavailable' : 'Agent session';
    },
  };
}

function LinkedSessionMenuItem(props: {
  sessionId: string;
  canOpen: boolean;
  onOpen: (sessionId: string) => void;
}) {
  const session = useSessionDisplay(
    () => props.sessionId,
    () => true
  );
  return (
    <PrAgentSessionMenuItem
      label={session.label()}
      disabled={!session.available() || !props.canOpen}
      onOpen={() => props.onOpen(props.sessionId)}
    />
  );
}

/** Shared, permission-aware linked-session metadata for PR rows and details. */
export function PrAgentSessionsChip(props: { url?: string; class?: string }) {
  const layout = useSplitLayout();
  const links = usePullRequestAgentSessionsQuery(() => props.url);
  const sessionIds = () => (props.url && links.isSuccess ? links.data : []);
  const single = useSessionDisplay(
    () => (sessionIds().length === 1 ? sessionIds()[0] : ''),
    () => sessionIds().length === 1
  );
  const [menuOpen, setMenuOpen] = createSignal(false);
  const openSession = (sessionId: string, newSplit = false) =>
    layout?.openWithSplit(
      { type: 'agent', id: sessionId },
      { preferNewSplit: newSplit }
    );

  return (
    <Suspense>
      <Show when={sessionIds().length > 0}>
        <Show
          when={sessionIds().length === 1}
          fallback={
            <PrAgentSessionsCountChip
              count={sessionIds().length}
              open={menuOpen()}
              onOpenChange={setMenuOpen}
              class={props.class}
            >
              <Show when={menuOpen()}>
                <For each={sessionIds()}>
                  {(sessionId) => (
                    <LinkedSessionMenuItem
                      sessionId={sessionId}
                      canOpen={Boolean(layout)}
                      onOpen={openSession}
                    />
                  )}
                </For>
              </Show>
            </PrAgentSessionsCountChip>
          }
        >
          <PrAgentSessionChip
            label={single.label()}
            disabled={!single.available() || !layout}
            class={props.class}
            onOpen={(event) => openSession(sessionIds()[0], event.shiftKey)}
          />
        </Show>
      </Show>
    </Suspense>
  );
}
