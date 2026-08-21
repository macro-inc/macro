import { SidePanel } from '@components/app/side-panel';
import { useBlockId } from '@core/block';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { LinkedConversationDrawer } from '@core/linked-conversation';
import { Show } from 'solid-js';

import {
  AgentSessionProvider,
  useAgentSession,
} from '../context/AgentSessionContext';
import {
  ORIGIN_THREAD_DRAWER_ID,
  sessionOriginThread,
} from '../context/origin-thread';
import { AgentComposer } from './AgentComposer';
import { AgentSplitHeader } from './AgentSplitHeader';
import { AgentSidePanelSections } from './sidepanel/AgentSidePanelSections';
import { Transcript } from './Transcript';

function AgentBlockContent() {
  const { session, metadata } = useAgentSession();

  return (
    // One shared static-markdown editor for every text part, rather than one
    // per part — the same scoping the channel does around its message tree.
    <StaticMarkdownContext>
      <div class="size-full overflow-hidden flex">
        {/* Collapsed by default, like the other conversation-shaped blocks —
            the transcript wants the width; `]` or the header button opens it. */}
        <SidePanel.Layout defaultOpen={false}>
          <AgentSidePanelSections />
          <AgentSplitHeader
            session={session()}
            title={metadata()?.title ?? undefined}
          />
          <div class="size-full min-w-0 flex flex-col">
            <Transcript />
            <div class="shrink-0 w-full max-w-3xl mx-auto px-4 pb-4">
              <AgentComposer />
            </div>
          </div>
          <Show when={sessionOriginThread(session())}>
            {(origin) => (
              <LinkedConversationDrawer
                id={ORIGIN_THREAD_DRAWER_ID}
                channelId={origin().channelId}
                messageId={origin().messageId}
              />
            )}
          </Show>
        </SidePanel.Layout>
      </div>
    </StaticMarkdownContext>
  );
}

export default function BlockAgent() {
  const blockId = useBlockId();

  return (
    <Show when={blockId}>
      {(id) => (
        <AgentSessionProvider sessionId={id()}>
          <AgentBlockContent />
        </AgentSessionProvider>
      )}
    </Show>
  );
}
