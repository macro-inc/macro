import { buildAgentRoster } from '@app/features/agents-view/core/roster';
import { NewChatPage } from '@app/features/agents-view/views/NewChatPage';
import '@app/features/agents-view/agents-view.css';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import { FixtureProviders } from './providers';
import { agents, agentsPageOpened, harnesses } from './stubs/fixture-state';

/**
 * The new-conversation composer Try it opens, over the fixture's agents, with
 * the agent request the Agents view passes it.
 */
export default function Composer() {
  const agentId = () => {
    const id = agentsPageOpened()?.params.composerAgentId;
    return typeof id === 'string' ? id : undefined;
  };
  const roster = () =>
    buildAgentRoster({
      agents: agents().map((agent) => ({
        ...agent,
        bot: { ...agent.bot, handle: 'mayas-agent' },
        harness: 'macrod',
        default_model: 'default',
        is_coding: true,
      })),
      runtimes: harnesses(),
      cursorConnected: true,
      cursorNeedsConnection: false,
    });
  return (
    <FixtureProviders>
      <div class="agents-view-portal h-dvh">
        <NewChatPage
          mode="code"
          requestedAgent={
            agentId()
              ? { agentId: agentId() ?? '', request: 'try-it' }
              : undefined
          }
          roster={roster()}
          rosterLoading={false}
          onStart={() => {}}
          onOpenRoster={() => {}}
        />
        {/* Phones float the composer into the bottom chrome, as the app does. */}
        <FloatRegionHost />
      </div>
    </FixtureProviders>
  );
}
