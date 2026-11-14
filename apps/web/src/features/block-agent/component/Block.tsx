import { AgentChangesProvider } from '@app/features/changes/agent-session-changes';
import {
  ChangesHandoff,
  ChangesSplit,
  ReviewNotesDock,
} from '@app/features/changes/changes';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { FloatRegionOrInline } from '@components/app/mobile/float-regions/FloatRegion';
import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { SplitPanelContext } from '@components/app/split-layout/context';
import { useCanAutofocusSplitContent } from '@components/app/split-layout/layoutUtils';
import { useNavigatedFromJK } from '@components/app/useNavigatedFromJK';
import { useBlockId } from '@core/block';
import { LoadErrorPanel } from '@core/component/EntityLoadGate';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { enableAgentSessionActivity } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { nativeNetworkStatus } from '@core/mobile/native-network-status';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import type { NotificationSource } from '@notifications/notification-source';
import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { isSessionArchived } from '@service-agent-harness/session-archive';
import { useSearchParams } from '@solidjs/router';
import { EmptyStatePanel } from '@ui';
import {
  type Accessor,
  children,
  createEffect,
  createSignal,
  on,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import { AgentSessionProvider } from '../agent-session-provider';
import { useAgentSession } from '../context/AgentSessionContext';
import { parseAgentMessageTarget } from '../core/search-location';
import { createAgentRouteTarget } from '../primitives/create-agent-route-target';
import { AgentSessionHeader } from '../views/agent-session-header';
import { MobileAgentSessionHeader } from '../views/mobile/agent-session-header';
import { AgentComposer } from './AgentComposer';
import { AgentConnections } from './AgentConnections';
import { AgentPreviewBanner } from './AgentPreviewBanner';
import { AgentSessionReadMarker } from './AgentSessionReadMarker';
import { ArchivedSessionFooter } from './ArchivedSessionFooter';
import { useAgentSessionHeader } from './agent-session-header';
import { AgentSidePanelSections } from './sidepanel/AgentSidePanelSections';
import { Transcript } from './Transcript';

/** The session's header state, then the one device switch. */
function AgentBlockHeader(props: {
  session: Accessor<AgentSessionResponse | undefined>;
  title: Accessor<string | undefined>;
}) {
  const header = useAgentSessionHeader(props);

  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <AgentSessionHeader session={props.session()} header={header} />
      }
    >
      <MobileAgentSessionHeader session={props.session()} header={header} />
    </Show>
  );
}

// Keep the editor mounted while another mobile accessory (Changes) is active.
function AgentComposerRegion(props: ParentProps) {
  const content = children(() => props.children);
  return (
    <FloatRegionOrInline region="accessory">{content()}</FloatRegionOrInline>
  );
}

function AgentPanelClearance(
  props: ParentProps<{
    class: string;
    enabled: boolean;
    holdsPrompts?: boolean;
  }>
) {
  const sidePanel = useSidePanel();
  return (
    <div
      class={props.class}
      data-holds-prompts={props.holdsPrompts ? '' : undefined}
      style={{
        '--details-clearance': `${props.enabled && sidePanel?.isOpen() && !isTouchDevice() ? SidePanel.FLOATING_CLEARANCE_PX : 0}px`,
      }}
    >
      {props.children}
    </div>
  );
}

function AgentBlockContent(props: {
  active: boolean;
  notificationSource: NotificationSource;
}) {
  const [params] = useSearchParams();
  const routeTarget = createAgentRouteTarget();
  const [searchTarget, setSearchTarget] = createSignal(
    routeTarget() ?? parseAgentMessageTarget(params)
  );
  let routeOwnsTarget = Boolean(routeTarget());
  createEffect(
    on(
      routeTarget,
      (target) => {
        if (target || routeOwnsTarget) {
          routeOwnsTarget = Boolean(target);
          setSearchTarget(target);
        }
      },
      { defer: true }
    )
  );
  createMethodRegistration(blockHandleSignal.get, {
    goToLocationFromParams: (params: Record<string, unknown>) => {
      const target = parseAgentMessageTarget(params);
      if (target) {
        routeOwnsTarget = false;
        setSearchTarget(target);
      }
    },
  });
  const {
    session,
    sessionId,
    metadata,
    accessDenied,
    loadFailed,
    loadRetryable,
    pending,
    retryLoad,
    startupError,
  } = useAgentSession();
  const canAutofocusSplitContent = useCanAutofocusSplitContent();
  const { navigatedFromJK } = useNavigatedFromJK();
  const activityFlag = useFeatureFlag(enableAgentSessionActivity);
  const persistentFloating = () => activityFlag().enabled;

  // Nothing loaded and no way forward: the load failed outright, or the
  // device is offline and the pending load cannot complete until
  // connectivity returns (that one resumes by itself, so no Retry). Gating
  // the whole block — like the other entity blocks — keeps the composer and
  // header from rendering against a session that never loaded.
  const loadUnavailable = () =>
    loadFailed() ||
    (nativeNetworkStatus() === 'offline' && !session() && !pending());

  return (
    <Show
      when={!loadUnavailable()}
      fallback={
        <Show
          when={startupError()}
          fallback={
            <Show
              when={accessDenied()}
              fallback={
                <LoadErrorPanel
                  title="Unable to load this agent session"
                  onRetry={loadRetryable() ? retryLoad : undefined}
                />
              }
            >
              <EmptyStatePanel
                centered
                title="You don't have access to this agent session"
                description="Ask a participant to share it with you."
              />
            </Show>
          }
        >
          {(error) => (
            <EmptyStatePanel
              centered
              title="Unable to start this agent"
              description={error()}
            />
          )}
        </Show>
      }
    >
      {/* One shared static-markdown editor for every text part, rather than
          one per part — the same scoping the channel does around its message
          tree. */}
      <StaticMarkdownContext>
        <AgentSessionReadMarker
          sessionId={session() ? sessionId() : undefined}
          active={props.active}
          notificationSource={props.notificationSource}
        />
        <div class="size-full overflow-hidden flex @container/agent-session">
          {/* Collapsed by default, like the other conversation-shaped blocks —
            the transcript wants the width; `]` or the header button opens it. */}
          <SidePanel.Layout
            defaultOpen={false}
            persistKey="agent"
            floating
            persistentFloating={persistentFloating()}
          >
            <AgentSidePanelSections />
            <AgentBlockHeader
              session={session}
              title={() => metadata()?.title ?? undefined}
            />
            <AgentPreviewBanner />
            {/* The Changes pane opens beside the transcript; closed, the
                transcript keeps the whole width. */}
            <ChangesSplit>
              <AgentPanelClearance
                enabled={persistentFloating()}
                class="flex min-h-0 flex-1 @min-[900px]/agent-session:pr-(--details-clearance)"
              >
                <AgentConnections>
                  <Transcript searchTarget={searchTarget()} />
                </AgentConnections>
              </AgentPanelClearance>
              {/* Full-frame mobile: composer + queue float in the bottom
                  accessory region above the dock; desktop stays inline. */}
              <AgentComposerRegion>
                {/* Home/chat: re-enable pointer events on the accessory
                    contribution — the float host is pointer-transparent. */}
                {/* pb matches ChannelInputContainer so the composer sits at
                    the same height as the channel input, and like it holds
                    the corner prompt while inline on desktop. */}
                <AgentPanelClearance
                  enabled={persistentFloating()}
                  holdsPrompts={!isTouchDevice()}
                  class="flex w-full justify-center shrink-0 px-4 pb-2.5 pointer-events-auto touch:px-(--mobile-chrome-gutter) touch:pb-0 @min-[900px]/agent-session:pr-(--details-clearance)"
                >
                  <div class="macro-message-width mx-auto flex flex-col gap-2">
                    <Show
                      when={!isSessionArchived(session())}
                      fallback={
                        <Show when={session()}>
                          {(current) => (
                            <ArchivedSessionFooter session={current()} />
                          )}
                        </Show>
                      }
                    >
                      <ChangesHandoff />
                      <ReviewNotesDock />
                      <AgentComposer
                        autofocus={
                          canAutofocusSplitContent &&
                          !navigatedFromJK() &&
                          !searchTarget()
                        }
                      />
                    </Show>
                  </div>
                </AgentPanelClearance>
              </AgentComposerRegion>
            </ChangesSplit>
          </SidePanel.Layout>
        </div>
      </StaticMarkdownContext>
    </Show>
  );
}

export default function BlockAgent() {
  const blockId = useBlockId();
  const split = useContext(SplitPanelContext);
  const notificationSource = useGlobalNotificationSource();

  // A block opened from the create menu mounts against a placeholder while
  // `POST /agent-sessions` provisions its sandbox — minutes, during which the
  // user is already typing. When the real id lands the split adopts it in
  // place: the URL becomes the session's, this mount keeps running, and the
  // placeholder is gone from history rather than being a back step to
  // nowhere.
  const adoptSessionId = (sessionId: string) => {
    split?.handle.adoptContentId({ type: 'agent', nextId: sessionId });
  };

  return (
    <Show when={blockId}>
      {(id) => (
        <AgentSessionProvider blockId={id()} onSessionId={adoptSessionId}>
          <AgentChangesProvider>
            <AgentBlockContent
              active={split?.isPanelActive() ?? false}
              notificationSource={notificationSource}
            />
          </AgentChangesProvider>
        </AgentSessionProvider>
      )}
    </Show>
  );
}
