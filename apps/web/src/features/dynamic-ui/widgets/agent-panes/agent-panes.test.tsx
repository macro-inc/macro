import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  flag: { enabled: true, loading: false },
  openWithSplit: vi.fn(),
  fetch: vi.fn(),
  viewer: 'macro|person@example.com',
  sessions: [] as Record<string, unknown>[],
  details: {} as Record<string, unknown>,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ ...fixture.flag, payload: undefined }),
}));
vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken: fixture.fetch }));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: fixture.openWithSplit }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => fixture.viewer,
}));
// The chart draws with Observable Plot; the pane's numbers are what matter.
vi.mock('@app/features/database-query/components/plot-chart', () => ({
  PlotChart: (props: { label: string; data: { categories: string[] } }) => (
    <figure aria-label={props.label} data-bars={props.data.categories.length} />
  ),
}));
vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: () => ({
    isPending: false,
    error: null,
    data: { entities: fixture.sessions },
  }),
}));
vi.mock('@queries/agent-session/session', () => ({
  agentSessionQueryOptions: (id: string) => ({
    queryKey: ['session', id],
    queryFn: () => fixture.details[id],
  }),
}));
vi.mock('@app/features/agents-view/views/AgentSessionListItem', () => ({
  AgentSessionListItem: (props: {
    entity: { id: string; name: string };
    onOpen: (event: MouseEvent) => void;
  }) => (
    <button type="button" onClick={(event) => props.onOpen(event)}>
      {props.entity.name}
    </button>
  ),
}));

import { AgentScope } from '../../context/agent-scope';
import { Routines } from './Routines';
import { Sessions } from './Sessions';
import { Spend } from './Spend';

const AGENT = 'macro|agent@example.com';

function mount(ui: () => JSX.Element) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(() => (
    <QueryClientProvider client={client}>{ui()}</QueryClientProvider>
  ));
}

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

beforeEach(() => {
  fixture.flag = { enabled: true, loading: false };
  fixture.openWithSplit.mockReset();
  fixture.fetch.mockReset();
  fixture.sessions = [];
  fixture.details = {};
});

afterEach(() => {
  document.body.innerHTML = '';
});

const notFound = err([{ code: 'NOT_FOUND', message: 'not found' }]);

describe('routines pane', () => {
  it('lists the agent’s routines and opens one', async () => {
    fixture.fetch.mockResolvedValue(
      ok({
        routines: [
          {
            id: 'routine-1',
            name: 'Morning digest',
            enabled: true,
            running: false,
            triggerKind: 'schedule',
            nextRunAt: '2026-11-14T14:00:00Z',
            lastRun: {
              startedAt: '2026-11-13T14:00:00Z',
              endedAt: '2026-11-13T14:01:00Z',
              succeeded: false,
            },
          },
        ],
        truncated: false,
      })
    );
    mount(() => <Routines agentId={AGENT} />);
    const name = await screen.findByText('Morning digest');
    expect(screen.getAllByText(/Next run/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Failed/).length).toBeGreaterThan(0);
    expect(fixture.fetch.mock.calls[0]?.[0]).toContain(
      `/scheduled-actions/agents/${encodeURIComponent(AGENT)}`
    );
    // Read-only here: the switch can't be flipped from a dashboard.
    expect((screen.getByRole('switch') as HTMLInputElement).disabled).toBe(
      true
    );
    fireEvent.click(name);
    expect(fixture.openWithSplit.mock.calls[0]?.[0]).toMatchObject({
      id: 'routines',
      params: { routineId: 'routine-1' },
    });
  });

  it('says No access when the viewer does not oversee the agent', async () => {
    fixture.fetch.mockResolvedValue(notFound);
    mount(() => <Routines agentId={AGENT} />);
    expect(await screen.findByText('No access')).toBeTruthy();
  });
});

describe('spend pane', () => {
  const spend = (bucket: string) =>
    ok({
      bucket,
      from: '2026-11-11T00:00:00Z',
      until: '2026-11-14T00:00:00Z',
      buckets: [
        { start: '2026-11-11T00:00:00Z', costUsd: 1.5 },
        { start: '2026-11-13T00:00:00Z', costUsd: 2 },
      ],
    });

  it('draws one bar per period with the total, and switches the period', async () => {
    fixture.fetch.mockImplementation(async (url: string) =>
      spend(new URL(url).searchParams.get('bucket') ?? 'day')
    );
    mount(() => <Spend agentId={AGENT} />);
    expect(await screen.findByText('$3.50')).toBeTruthy();
    const chart = screen.getByRole('figure');
    expect(chart.getAttribute('data-bars')).toBe('3');
    expect(fixture.fetch.mock.calls[0]?.[0]).toContain('bucket=day');

    fireEvent.click(screen.getByRole('radio', { name: 'Month' }));
    await waitFor(() =>
      expect(fixture.fetch.mock.calls.at(-1)?.[0]).toContain('bucket=month')
    );
  });

  it('says No access for a viewer the server refuses', async () => {
    fixture.fetch.mockResolvedValue(notFound);
    mount(() => <Spend agentId={AGENT} bucket="week" />);
    expect(await screen.findByText('No access')).toBeTruthy();
  });

  it('reads nothing with agent dashboards off', () => {
    fixture.flag = { enabled: false, loading: false };
    mount(() => <Spend agentId={AGENT} />);
    expect(
      screen.getByText('This part of the view isn’t available.')
    ).toBeTruthy();
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it('takes the view’s agent when it names none, and says so without one', async () => {
    fixture.fetch.mockResolvedValue(spend('day'));
    mount(() => (
      <>
        <AgentScope agentId={AGENT}>
          <Spend title="Scoped" />
        </AgentScope>
        <Spend title="Unscoped" />
      </>
    ));
    expect(await screen.findByText('$3.50')).toBeTruthy();
    expect(fixture.fetch.mock.calls[0]?.[0]).toContain(
      encodeURIComponent(AGENT)
    );
    expect(screen.getByText('This pane doesn’t name an agent.')).toBeTruthy();
  });
});

describe('sessions pane', () => {
  it('nests the sub-agents a session started under it and opens a session', async () => {
    fixture.sessions = [
      {
        type: 'agent_session',
        id: 'child',
        name: 'Child run',
        source: 'agent',
        status: 'running',
        turnState: 'blocked',
      },
      {
        type: 'agent_session',
        id: 'root',
        name: 'Root run',
        source: 'user',
        status: 'running',
      },
    ];
    fixture.details = {
      child: {
        id: 'child',
        origin: {
          origin: 'requested',
          by: {
            type: 'agent',
            lineage: { type: 'session', session: 'root', root: {} },
          },
        },
      },
    };
    mount(() => <Sessions agentId={AGENT} />);
    expect(await screen.findByText('1 session waiting for input')).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole('list', { name: 'Sub-agents' }).textContent
      ).toContain('Child run')
    );
    fireEvent.click(screen.getByText('Root run'));
    expect(fixture.openWithSplit.mock.calls[0]?.[0]).toEqual({
      type: 'agent',
      id: 'root',
    });
  });
});
