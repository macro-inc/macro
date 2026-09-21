import {
  AgentChangesProvider,
  AgentChangesSplit,
  ChangesHandoff,
  ChangesToggle,
  ReviewNotesDock,
} from '@app/features/agent-changes/agent-changes';
import { AgentSessionProvider } from '@app/features/block-agent/agent-session-provider';
import { AgentComposer } from '@app/features/block-agent/component/AgentComposer';
import { AgentPullRequestChip } from '@app/features/block-agent/component/AgentPullRequestChip';
import { agentSessionTitle } from '@app/features/block-agent/component/AgentSplitHeader';
import { AgentSidePanelSections } from '@app/features/block-agent/component/sidepanel/AgentSidePanelSections';
import { Transcript } from '@app/features/block-agent/component/Transcript';
import { useAgentSession } from '@app/features/block-agent/context/AgentSessionContext';
import {
  forgetPendingSession,
  pendingSession,
} from '@app/features/block-agent/context/pending-session';
import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { SidePanel } from '@components/app/side-panel';
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import {
  SplitTitleFileMenu,
  StaticSplitLabel,
} from '@components/app/split-layout/components/SplitLabel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  modelProvider,
  ProviderIcon,
} from '@core/component/AI/component/ProviderIcon';
import { EntityIcon } from '@core/component/EntityIcon';
import { LoadErrorPanel } from '@core/component/EntityLoadGate';
import { Permissions } from '@core/component/SharePermissions';
import {
  ShareDialogContext,
  ShareModal,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { useUserId } from '@core/context/user';
import { openExternalUrl } from '@core/util/url';
import type { AgentSessionEntity } from '@entity';
import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import GitBranch from '@phosphor/git-branch.svg';
import ShareIcon from '@phosphor/share.svg';
import { createSignal, onCleanup, Show, Suspense } from 'solid-js';
import { ChatSessionInput } from './ChatComposer';
import { SessionModelSelector } from './ModelSelector';
import { Topbar } from './Topbar';

function SessionCommands(props: {
  entity: AgentSessionEntity;
  onDeleted: () => void;
}) {
  const panel = useSplitPanelOrThrow();
  useBlockEntityCommands({
    id: props.entity.id,
    scopeId: panel.splitHotkeyScope,
    resolveEntity: () => props.entity,
    onDeleted: props.onDeleted,
  });
  return null;
}

function SessionContent(props: { onDeleted: () => void }) {
  const { loadFailed, loadRetryable, metadata, retryLoad, session, sessionId } =
    useAgentSession();
  const panel = useSplitPanelOrThrow();
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
  return (
    <ShareDialogContext.Provider
      value={{
        isOpen: shareOpen,
        open: () => setShareOpen(true),
        close: () => setShareOpen(false),
      }}
    >
      <SidePanel.Root defaultOpen={false} persistKey="agent">
        <Topbar
          title={title()}
          titleContent={
            <>
              <StaticSplitLabel
                label={title()}
                icon={
                  <Show
                    when={modelProvider(metadata()?.model ?? session()?.model)}
                    fallback={
                      <EntityIcon
                        targetType="chat"
                        size="xs"
                        class="shrink-0"
                      />
                    }
                  >
                    <ProviderIcon
                      model={metadata()?.model ?? session()?.model}
                      class="size-4 shrink-0"
                    />
                  </Show>
                }
              />
              <Show when={entity()}>
                {(current) => (
                  <>
                    <SessionCommands
                      entity={current()}
                      onDeleted={props.onDeleted}
                    />
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
                  </>
                )}
              </Show>
            </>
          }
        >
          <Show when={session()?.pullRequestUrl}>
            {(url) => <AgentPullRequestChip url={url()} />}
          </Show>
          <Show when={sessionId()}>
            {(id) => (
              <ShareTrigger
                id={id()}
                blockType="agent"
                hotkeyScope={panel.splitHotkeyScope}
              />
            )}
          </Show>
          <ChangesToggle />
          <SidePanel.Toggle />
        </Topbar>
        <div class="relative min-h-0 min-w-0 flex-1">
          <SidePanel.Layout headerToggle={false}>
            <AgentSidePanelSections />
            <section
              class="page pane size-full min-w-0"
              data-active
              aria-label="Agent session"
            >
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
                  <div class="composer-anchor flex flex-col gap-2">
                    <ChangesHandoff />
                    <ReviewNotesDock />
                    <AgentComposer
                      autofocus
                      input={ChatSessionInput}
                      modelSelector={SessionModelSelector}
                    />
                  </div>
                </div>
              </Show>
            </section>
          </SidePanel.Layout>
        </div>
      </SidePanel.Root>

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
      <AgentChangesProvider>
        <AgentChangesSplit>
          <SessionContent onDeleted={props.onDeleted} />
        </AgentChangesSplit>
      </AgentChangesProvider>
    </AgentSessionProvider>
  );
}
