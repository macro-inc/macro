import { AgentComposer } from '@app/features/block-agent/component/AgentComposer';
import { AgentPullRequestChip } from '@app/features/block-agent/component/AgentPullRequestChip';
import { Transcript } from '@app/features/block-agent/component/Transcript';
import {
  AgentSessionProvider,
  useAgentSession,
} from '@app/features/block-agent/context/AgentSessionContext';
import { isDisconnected } from '@app/features/block-agent/context/create-session-status-controller';
import {
  forgetPendingSession,
  pendingSession,
} from '@app/features/block-agent/context/pending-session';
import { makeCopyLinkAction } from '@app/features/next-soup/actions';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { LoadErrorPanel } from '@core/component/EntityLoadGate';
import { Permissions } from '@core/component/SharePermissions';
import { toast } from '@core/component/Toast/Toast';
import {
  ShareDialogContext,
  ShareModal,
} from '@core/component/TopBar/ShareButton';
import {
  deleteAgentSession,
  renameAgentSession,
} from '@queries/agent-session/entity-mutations';
import {
  type FavoritesFilter,
  useAddFavoriteMutation,
  useFavoritesData,
  useRemoveFavoriteMutation,
} from '@queries/favorites/favorites';
import { createSignal, onCleanup, Show, Suspense } from 'solid-js';
import type { AgentsMode } from '../core/mode';
import { repositoryLabel } from '../core/repository';
import { type RosterAgent, runtimeLabel } from '../core/roster';
import { ChatSessionInput } from './ChatComposer';
import { SessionModelSelector } from './ModelSelector';
import { modelLabel } from './model-label';
import { ConfirmDialog, RenameDialog } from './SimpleDialogs';
import { Topbar } from './Topbar';

const FAVORITES_FILTER: FavoritesFilter = { entityType: ['agent_session'] };

function SessionContent(props: {
  mode: AgentsMode;
  roster: RosterAgent[];
  onDeleted: () => void;
}) {
  const {
    blockedOnUser,
    loadFailed,
    loadRetryable,
    metadata,
    pending,
    retryLoad,
    session,
    sessionId,
    status,
    working,
  } = useAgentSession();
  const { openWithSplit } = useSplitLayout();
  const favorites = useFavoritesData(FAVORITES_FILTER);
  const addFavorite = useAddFavoriteMutation();
  const removeFavorite = useRemoveFavoriteMutation();
  const [shareOpen, setShareOpen] = createSignal(false);
  const [renaming, setRenaming] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  const title = () => metadata()?.title ?? session()?.name ?? 'New chat';
  const isFavorite = () => {
    const id = sessionId();
    return (
      !!id &&
      (favorites()?.favorites ?? []).some(
        (favorite) => favorite.entityId === id
      )
    );
  };
  const agent = () =>
    props.roster.find((candidate) => candidate.botId === session()?.botId);
  const state = () => {
    if (pending()) return { cls: 'running', label: 'Starting' };
    if (isDisconnected(status()))
      return { cls: 'failed', label: 'Disconnected' };
    if (blockedOnUser()) return { cls: 'waiting', label: 'Needs input' };
    if (working()) return { cls: 'running', label: 'Running' };
    return { cls: 'done', label: 'Ready' };
  };

  const toggleFavorite = () => {
    const id = sessionId();
    if (!id) return;
    const args = { entityId: id, entityType: 'agent_session' as const };
    if (isFavorite()) removeFavorite.mutate(args);
    else addFavorite.mutate(args);
  };
  const copyLink = () => {
    const id = sessionId();
    if (id)
      void makeCopyLinkAction().executeByBlock(
        id,
        props.mode === 'code' ? 'coders' : 'agents'
      );
  };
  const openInSplit = () => {
    const id = sessionId();
    if (id) openWithSplit({ type: 'agent', id }, { referredFrom: 'launcher' });
  };
  const rename = async (name: string) => {
    const id = sessionId();
    if (!id) return;
    setBusy(true);
    try {
      await renameAgentSession(id, name);
      setRenaming(false);
    } catch {
      toast.failure('Could not rename the session');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    const id = sessionId();
    if (!id) return;
    setBusy(true);
    try {
      await deleteAgentSession(id);
      setDeleting(false);
      props.onDeleted();
    } catch {
      toast.failure('Could not delete the session');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ShareDialogContext.Provider
      value={{
        isOpen: shareOpen,
        open: () => setShareOpen(true),
        close: () => setShareOpen(false),
      }}
    >
      <Topbar
        title={title()}
        session={{
          favorite: isFavorite(),
          onToggleFavorite: toggleFavorite,
          onShare: () => setShareOpen(true),
          onSidePanel: openInSplit,
          onRename: () => setRenaming(true),
          onCopyLink: copyLink,
          onDelete: () => setDeleting(true),
        }}
      >
        <Show when={session()?.pullRequestUrl}>
          {(url) => <AgentPullRequestChip url={url()} />}
        </Show>
      </Topbar>
      <div class="body">
        <section class="page pane" data-active aria-label="Agent session">
          <div class="meta mono">
            <Show when={sessionId()}>
              {(id) => (
                <span>
                  <span class="k">session</span> {id()}
                </span>
              )}
            </Show>
            <Show when={agent()}>
              {(current) => (
                <span>
                  <span class="k">agent</span> @{current().handle}
                </span>
              )}
            </Show>
            <Show when={session()?.harness}>
              {(harness) => (
                <span>
                  <span class="k">harness</span>{' '}
                  {runtimeLabel(harness(), undefined, [])}
                </span>
              )}
            </Show>
            <Show when={metadata()?.model ?? session()?.model}>
              {(model) => (
                <span>
                  <span class="k">model</span> {modelLabel(model())}
                </span>
              )}
            </Show>
            <Show when={session()?.repoUrl}>
              {(url) => (
                <span>
                  <span class="k">repo</span> {repositoryLabel(url())}
                </span>
              )}
            </Show>
            <span class={`stdot ${state().cls}`}>{state().label}</span>
          </div>
          <Show
            when={!loadFailed()}
            fallback={
              <LoadErrorPanel
                title="Unable to load this session"
                onRetry={loadRetryable() ? retryLoad : undefined}
              />
            }
          >
            <div class="transcript-host">
              <Transcript />
            </div>
            <div class="dock">
              <div class="composer-anchor">
                <AgentComposer
                  autofocus
                  input={ChatSessionInput}
                  modelSelector={SessionModelSelector}
                />
              </div>
            </div>
          </Show>
        </section>
      </div>

      <Show when={sessionId() && session()}>
        {(_) => (
          <Suspense>
            <ShareModal
              id={sessionId() ?? ''}
              name={title()}
              owner={session()?.ownerId ?? ''}
              itemType="agent_session"
              blockAlias="agent"
              userPermissions={Permissions.OWNER}
              isSharePermOpen={shareOpen()}
              setIsSharePermOpen={setShareOpen}
            />
          </Suspense>
        )}
      </Show>
      <Show when={renaming()}>
        <RenameDialog
          value={title()}
          pending={busy()}
          onRename={(name) => void rename(name)}
          onClose={() => setRenaming(false)}
        />
      </Show>
      <Show when={deleting()}>
        <ConfirmDialog
          title="Delete session?"
          body="This removes the session and its transcript for everyone it was shared with. This cannot be undone."
          confirmLabel="Delete session"
          pendingLabel="Deleting…"
          danger
          pending={busy()}
          onConfirm={() => void remove()}
          onClose={() => setDeleting(false)}
        />
      </Show>
    </ShareDialogContext.Provider>
  );
}

/** A conversation opened in the workspace: its title row, transcript, and composer. */
export function AgentSessionPane(props: {
  id: string;
  mode: AgentsMode;
  roster: RosterAgent[];
  onSessionId: (sessionId: string) => void;
  onDeleted: () => void;
}) {
  const pending = pendingSession(props.id);
  onCleanup(() => {
    if (pending?.sessionId() || pending?.failed()) {
      forgetPendingSession(props.id);
    }
  });

  return (
    <AgentSessionProvider blockId={props.id} onSessionId={props.onSessionId}>
      <SessionContent
        mode={props.mode}
        roster={props.roster}
        onDeleted={props.onDeleted}
      />
    </AgentSessionProvider>
  );
}
