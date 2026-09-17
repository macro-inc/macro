import { AgentComposer } from '@app/features/block-agent/component/AgentComposer';
import { AgentPullRequestChip } from '@app/features/block-agent/component/AgentPullRequestChip';
import { agentSessionTitle } from '@app/features/block-agent/component/AgentSplitHeader';
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
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import {
  SplitTitleFileMenu,
  StaticSplitLabel,
} from '@components/app/split-layout/components/SplitLabel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { ProviderIcon } from '@core/component/AI/component/ProviderIcon';
import { LoadErrorPanel } from '@core/component/EntityLoadGate';
import { Permissions } from '@core/component/SharePermissions';
import {
  ShareDialogContext,
  ShareModal,
} from '@core/component/TopBar/ShareButton';
import { useUserId } from '@core/context/user';
import { openExternalUrl } from '@core/util/url';
import type { AgentSessionEntity } from '@entity';
import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import GitBranch from '@phosphor/git-branch.svg';
import ShareIcon from '@phosphor/share.svg';
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
  const userId = useUserId();

  const title = () => agentSessionTitle(session(), metadata()?.title);
  const permissions = () =>
    session()?.ownerId === userId()
      ? Permissions.OWNER
      : session()?.canEdit
        ? Permissions.CAN_EDIT
        : Permissions.CAN_VIEW;
  const entity = (): AgentSessionEntity | undefined => {
    const current = session();
    const id = sessionId();
    if (!current || !id) return;
    return {
      type: 'agent_session',
      id,
      name: title(),
      ownerId: current.ownerId,
      botId: current.botId,
      status:
        current.status.kind === 'event'
          ? current.status.event
          : current.status.kind,
    };
  };
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
  const openInSplit = () => {
    const id = sessionId();
    if (id) openWithSplit({ type: 'agent', id }, { referredFrom: 'launcher' });
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
        titleContent={
          <>
            <StaticSplitLabel
              label={title()}
              icon={
                <ProviderIcon
                  model={metadata()?.model ?? session()?.model}
                  class="size-4 shrink-0"
                />
              }
            />
            <Show when={entity()}>
              {(current) => (
                <SplitTitleFileMenu>
                  <SplitFileMenu
                    id={current().id}
                    itemType="agent_session"
                    entityKind="agent"
                    name={title()}
                    entity={current()}
                    permissions={permissions()}
                    onDelete={props.onDeleted}
                    ops={[
                      { op: 'rename' },
                      { op: 'delete' },
                      {
                        label: 'Open repository',
                        icon: GitBranch,
                        action: () => {
                          const url = session()?.repoUrl;
                          if (url) openExternalUrl(url);
                        },
                      },
                    ]}
                    tools={[
                      {
                        label: () => {
                          const provider = session()?.external?.provider;
                          if (provider === 'claude-cloud')
                            return 'Open in Claude';
                          return provider
                            ? `Open in ${provider.charAt(0).toUpperCase()}${provider.slice(1)}`
                            : 'Open externally';
                        },
                        icon: ArrowSquareOut,
                        condition: () => Boolean(session()?.external?.url),
                        action: () => {
                          const url = session()?.external?.url;
                          if (url) openExternalUrl(url);
                        },
                      },
                      {
                        label: 'Share',
                        icon: ShareIcon,
                        action: () => setShareOpen(true),
                      },
                    ]}
                  />
                </SplitTitleFileMenu>
              )}
            </Show>
          </>
        }
        session={{
          favorite: isFavorite(),
          onToggleFavorite: toggleFavorite,
          onShare: () => setShareOpen(true),
          onSidePanel: openInSplit,
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
              userPermissions={permissions()}
              isSharePermOpen={shareOpen()}
              setIsSharePermOpen={setShareOpen}
            />
          </Suspense>
        )}
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
