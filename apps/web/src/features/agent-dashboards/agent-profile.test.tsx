/**
 * @vitest-environment jsdom
 */

import { PosthogProvider } from '@app/lib/analytics/posthog';
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { PostHog } from 'posthog-js';
import { type JSX, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAgentProfile } from './agent-profile';

const AGENT = 'macro|agent@example.com';

const mocks = vi.hoisted(() => ({
  posthog: {
    onFeatureFlags: vi.fn<PostHog['onFeatureFlags']>(),
    isFeatureEnabled: vi.fn<PostHog['isFeatureEnabled']>(),
    featureFlags: { getFlags: vi.fn<() => string[]>() },
  },
  snapshot: false,
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ posthog: mocks.posthog }),
}));

vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  isFeatureEnabled: () => mocks.snapshot,
}));

vi.mock('@core/user', () => ({
  isAgentAccount: (id: string | undefined) => id === AGENT,
  tryMacroId: (id: string) => id,
}));

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));

/** The agent's name, as a link when a click on it would open its profile. */
function AgentName() {
  const profile = useAgentProfile();
  return (
    <Show when={profile.profileOf(AGENT)} fallback={<span>Ops</span>}>
      <button type="button">Ops</button>
    </Show>
  );
}

function receiveFlags(enabled: boolean) {
  mocks.posthog.isFeatureEnabled.mockReturnValue(enabled);
  const callback = mocks.posthog.onFeatureFlags.mock.calls[0]?.[0];
  if (!callback) throw new Error('PostHog provider is not mounted');
  callback(enabled ? ['enable-agent-dashboards'] : [], {});
  return new Promise((resolve) => setTimeout(resolve));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.snapshot = false;
  mocks.posthog.isFeatureEnabled.mockReturnValue(undefined);
  mocks.posthog.featureFlags.getFlags.mockReturnValue([]);
  mocks.posthog.onFeatureFlags.mockReturnValue(() => undefined);
});
afterEach(cleanup);

function withPosthog(children: () => JSX.Element) {
  return render(() => <PosthogProvider>{children()}</PosthogProvider>);
}

it('turns an agent name into a link when the flag arrives after first paint', async () => {
  withPosthog(() => <AgentName />);
  expect(screen.queryByRole('button', { name: 'Ops' })).toBeNull();

  await receiveFlags(true);

  expect(screen.getByRole('button', { name: 'Ops' })).toBeTruthy();
});

it('keeps the name plain when the flag arrives off', async () => {
  withPosthog(() => <AgentName />);

  await receiveFlags(false);

  expect(screen.queryByRole('button', { name: 'Ops' })).toBeNull();
  expect(screen.getByText('Ops')).toBeTruthy();
});

it('reads the flag snapshot without the PostHog provider', () => {
  mocks.snapshot = true;
  render(() => <AgentName />);

  expect(screen.getByRole('button', { name: 'Ops' })).toBeTruthy();
});
