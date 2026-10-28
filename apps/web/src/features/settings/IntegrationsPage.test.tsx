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
vi.mock('./Harness', () => ({
  Harness: (props: { onBack?: () => void; backLabel?: string }) => (
    <div>
      <h1>Runtimes</h1>
      <button type="button" onClick={props.onBack}>
        {props.backLabel}
      </button>
    </div>
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setRuntimesAvailable(true);
});

it('returns local-agent setup to Integrations without opening the Agents settings route', () => {
  render(() => <IntegrationsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Set up local agents' }));
  expect(screen.getByRole('heading', { name: 'Runtimes' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Integrations' }));
  expect(screen.getByRole('heading', { name: 'Integrations' })).toBeTruthy();
  expect(openSettings).not.toHaveBeenCalled();
});

it('hides local-agent setup when the runtime tab is unavailable', () => {
  setRuntimesAvailable(false);
  render(() => <IntegrationsPage />);
  expect(
    screen.queryByRole('button', { name: 'Set up local agents' })
  ).toBeNull();
});
it('leaves inline runtime setup when the runtime tab becomes unavailable', () => {
  render(() => <IntegrationsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Set up local agents' }));
  setRuntimesAvailable(false);
  expect(screen.queryByRole('heading', { name: 'Runtimes' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Integrations' })).toBeTruthy();
});
