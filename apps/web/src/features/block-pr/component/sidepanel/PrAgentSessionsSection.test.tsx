import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const query = {
  isPending: true,
  isSuccess: false,
  isError: false,
  data: [] as string[],
  refetch: vi.fn(),
};
let sessions = query;

vi.mock('@components/app/side-panel', () => ({
  SidePanel: { Section: (props: { children: JSX.Element }) => props.children },
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => undefined,
}));
vi.mock('@app/components/view-shell', () => ({
  ListFilterDropdown: () => null,
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/decorator/AgentSessionMentionLabel',
  () => ({
    AgentSessionMentionLabel: (props: { label: string }) => (
      <span>{props.label}</span>
    ),
  })
);
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));
vi.mock('@queries/agent-session/mentions', () => ({
  useAgentSessionMentionPreview: () => ({ isSuccess: false }),
}));
vi.mock('@queries/agent-session/pull-requests', () => ({
  usePullRequestAgentSessionsQuery: () => sessions,
  useAgentSessionPullRequestsQuery: () => ({ isSuccess: false }),
  useLinkAgentSessionPullRequestMutation: () => ({}),
  useUnlinkAgentSessionPullRequestMutation: () => ({}),
}));
vi.mock('@queries/soup/quick-access-agent-sessions', () => ({
  useQuickAccessAgentSessionsQuery: () => ({ sessions: () => [] }),
}));

import { PrAgentSessionsSection } from './PrAgentSessionsSection';

afterEach(cleanup);
beforeEach(() => {
  sessions = { ...query };
});

const url = 'https://github.com/org/repo/pull/7';

describe('PR session loading states', () => {
  it('does not call a pending PR an empty sessions list', () => {
    render(() => <PrAgentSessionsSection prStatus="pending" />);
    expect(screen.getByRole('status').textContent).toContain(
      'Loading pull request'
    );
    expect(screen.queryByText('No agent sessions')).toBeNull();
  });

  it('distinguishes missing PR details from missing sessions', () => {
    render(() => <PrAgentSessionsSection prStatus="error" />);
    expect(
      screen.getByText('Pull request details couldn’t be loaded')
    ).toBeTruthy();
    expect(screen.queryByText('No agent sessions')).toBeNull();
  });

  it('does not call a successful PR without a URL an empty sessions list', () => {
    render(() => <PrAgentSessionsSection prStatus="success" />);
    expect(screen.getByText('Pull request URL isn’t available')).toBeTruthy();
    expect(screen.queryByText('No agent sessions')).toBeNull();
  });

  it('shows loading until the sessions request succeeds', () => {
    const [state, setState] = createStore({ ...query });
    sessions = state;
    render(() => <PrAgentSessionsSection url={url} prStatus="success" />);
    expect(screen.getByRole('status').textContent).toContain(
      'Loading agent sessions'
    );
    expect(screen.queryByText('No agent sessions')).toBeNull();
    setState({ isPending: false, isSuccess: true });
    expect(screen.getByText('No agent sessions')).toBeTruthy();
  });

  it('distinguishes a failed sessions request from an empty list', () => {
    sessions = { ...query, isPending: false, isError: true };
    render(() => <PrAgentSessionsSection url={url} prStatus="success" />);
    expect(screen.getByText('Agent sessions couldn’t be loaded')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('No agent sessions')).toBeNull();
  });
});
