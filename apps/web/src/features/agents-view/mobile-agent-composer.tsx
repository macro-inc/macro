import { useSplitLayout } from '@components/app/split-layout/layout';
import { useUserId } from '@core/context/user';
import { Suspense } from 'solid-js';
import { startPendingSession } from '../block-agent/context/pending-session';
import { openAgentsPage } from './primitives/open-page';
import { createAgentRosterSource } from './queries/agent-roster-source';
import { NewChatPage, type StartConversation } from './views/NewChatPage';
import './agents-view.css';

/** The mobile accessory uses the same agent choices and send contract as Home. */
function Composer() {
  const roster = createAgentRosterSource();
  const layout = useSplitLayout();
  const userId = useUserId();
  const start = (conversation: StartConversation) => {
    const id = startPendingSession({ ...conversation, userId: userId() });
    layout.openWithSplit({ type: 'agent', id }, { referredFrom: 'agents' });
  };
  return (
    <div class="agents-view-portal min-w-0">
      <NewChatPage
        compact
        autoFocus={false}
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
      fallback={<div class="h-12" aria-label="Loading agent composer" />}
    >
      <Composer />
    </Suspense>
  );
}
