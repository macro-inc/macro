/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { IntegrationsPage } from './IntegrationsPage';

const openSettings = vi.fn();
const [runtimesAvailable, setRuntimesAvailable] = createSignal(true);
vi.mock('@core/constant/settingsTabsConfig', () => ({
  useSettingsTabAvailable: () => () => runtimesAvailable(),
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings }),
}));
vi.mock('@core/constant/featureFlags', () => ({ ENABLE_EMAIL: true }));
vi.mock('@core/pipedream/flag', () => ({
  usePipedreamMcpFlag: () => () => true,
}));
vi.mock('./Email', () => ({ EmailCard: () => <div>Email</div> }));
vi.mock('./Granola', () => ({ GranolaCard: () => <div>Granola</div> }));
vi.mock('./GitHub', () => ({ GitHubCard: () => <div>GitHub</div> }));
vi.mock('./Integrations', () => ({ IntegrationsSection: () => null }));
vi.mock('./Team', () => ({
  useTeamViewer: () => ({ isAdminOrOwner: () => true }),
}));
vi.mock('@queries/team/teams', () => ({
  useUserTeamsQuery: () => ({ isSuccess: true, data: [] }),
}));
vi.mock('@app/features/slack-import/slack-import', () => ({
  SlackImport: () => <div>Slack export</div>,
}));
vi.mock('./connections/integrations-view', () => ({
  IntegrationsView: (props: { onOpenLocalAgents?: () => void }) => (
    <div>
      <h1>Integrations</h1>
      <Show when={props.onOpenLocalAgents}>
        <button type="button" onClick={props.onOpenLocalAgents}>
          Set up local agents
        </button>
      </Show>
    </div>
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setRuntimesAvailable(true);
});

it('opens the Runtimes section of Agents for local-agent setup', () => {
  render(() => <IntegrationsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Set up local agents' }));
  expect(openSettings).toHaveBeenCalledWith('Harness');
});

it('hides local-agent setup when the runtime tab is unavailable', () => {
  setRuntimesAvailable(false);
  render(() => <IntegrationsPage />);
  expect(
    screen.queryByRole('button', { name: 'Set up local agents' })
  ).toBeNull();
});
