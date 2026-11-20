import { useSplitLayout } from '@components/app/split-layout/layout';
import { useUserId } from '@core/context/user';
import { createEffect, onCleanup, Suspense } from 'solid-js';
import { createStore } from 'solid-js/store';
import { startPendingSession } from '../block-agent/context/pending-session';
import { modeForKind } from './core/agent-kind';
import type { ComposerMode } from './core/mode';
import { mobileAgentRequest } from './primitives/mobile-agent-request';
import { openAgentsPage } from './primitives/open-page';
import { createAgentRosterSource } from './queries/agent-roster-source';
import { NewChatPage, type StartConversation } from './views/NewChatPage';
import './agents-view.css';

/** The mobile accessory uses the same agent choices and send contract as Home. */
function Composer() {
  const roster = createAgentRosterSource();
  const layout = useSplitLayout();
  const userId = useUserId();
  const requested = () => mobileAgentRequest.forUser(userId());
  const [modeChoice, setModeChoice] = createStore<{
    userId?: string;
    request?: string;
    mode?: ComposerMode;
  }>({});
  const requestedMode = () => {
    const selection = requested();
    const matches =
      modeChoice.userId === userId() &&
      modeChoice.request === selection?.request;
    if (matches && modeChoice.mode) return modeChoice.mode;
    return selection ? modeForKind(selection.kind) : undefined;
  };
  let focus: (() => void) | undefined;
  createEffect(() => {
    const identity = userId();
    if (!identity) return;
    onCleanup(mobileAgentRequest.registerFocus(identity, () => focus?.()));
  });
  createEffect(() => {
    const selected = requested();
    if (
      selected &&
      !roster.loading() &&
      roster.roster().some((agent) => agent.id === selected.agentId)
    )
      queueMicrotask(() => focus?.());
  });
  const start = (conversation: StartConversation) => {
    const id = startPendingSession({
      ...conversation,
      userId: userId(),
      submitSurface: 'mobile_composer',
    });
    layout.openWithSplit({ type: 'agent', id }, { referredFrom: 'agents' });
  };
  return (
    <div class="agents-view-portal agents-scope min-w-0">
      <NewChatPage
        compact
        autoFocus={false}
        requestedAgent={requested()}
        mode={requestedMode()}
        onModeChange={(mode) =>
          setModeChoice({
            userId: userId(),
            request: requested()?.request,
            mode,
          })
        }
        registerFocus={(next) => {
          focus = next;
        }}
        roster={roster.roster()}
        rosterLoading={roster.loading()}
        availabilityLoading={roster.availabilityLoading()}
        onStart={start}
        onOpenRoster={() => openAgentsPage(layout, 'agents')}
      />
    </div>
  );
}

export function MobileAgentComposer() {
  return (
    <Suspense
      fallback={
        <div
          class="h-(--mobile-chrome-button-size)"
          aria-label="Loading agent composer"
        />
      }
    >
      <Composer />
    </Suspense>
  );
}
