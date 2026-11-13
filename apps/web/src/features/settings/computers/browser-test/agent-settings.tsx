import { AgentSettings } from '../../AgentSettings';
import { FixtureProviders } from './providers';

/** Settings → Agents, where Create an agent on this computer lands. */
export default function AgentSettingsPage() {
  return (
    <FixtureProviders>
      {/* Settings scrolls its page, as the settings panel does in the app. */}
      <div class="h-dvh overflow-y-auto">
        <AgentSettings />
      </div>
    </FixtureProviders>
  );
}
