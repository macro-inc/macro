import { LoadErrors } from '@core/block';
import { render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const projectId = '019507e8-14a3-7bc1-8610-419f16bd03a9';
const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  flag: { enabled: true, loading: false },
}));
vi.mock('@core/block', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/block')>()),
  useBlockId: () => projectId,
}));
vi.mock('@app/features/projects/project-detail', async () => {
  const { ViewBreadcrumbs } = await import('@app/components/view-shell');
  const { useTagSets } = await import('@property/tags/tag-sets-context');
  return {
    // Throws, as the real view's top bar and task list do, without the
    // breadcrumb root and tag sets the Tasks view normally supplies.
    ProjectDetail: (props: unknown) => {
      mocks.detail(props);
      useTagSets();
      return (
        <>
          <ViewBreadcrumbs.Outlet />
          <p>project detail</p>
        </>
      );
    },
  };
});
vi.mock('@app/features/reminders/email-row-reminders-provider', () => ({
  EmailRowRemindersQueryProvider: (props: { children: JSX.Element }) =>
    props.children,
}));
vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: () => ({ isPending: false, isFetched: true, data: [] }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => mocks.flag,
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: { Root: (props: { children: JSX.Element }) => props.children },
}));
vi.mock('@components/app/split-layout/split-router/app-route-shell', () => ({
  RedirectSplit: (props: { to: { id: string } }) => (
    <p>redirect to {props.to.id}</p>
  ),
}));
vi.mock('@core/component/LoadingBlock', () => ({
  LoadingBlock: () => <p>loading</p>,
}));
// The block definitions open the storage and connection-gateway sockets.
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

import { definition } from '../definition';
import InitiativeBlock from './InitiativeBlock';

beforeEach(() => {
  mocks.detail.mockClear();
  mocks.flag = { enabled: true, loading: false };
});

describe('initiative block', () => {
  it('loads the project id from the storage source', async () => {
    const loaded = await definition.load(
      { type: 'dss', id: projectId },
      'initial'
    );
    expect(loaded.isOk() && loaded.value).toEqual({ id: projectId });
    expect(await definition.load({ type: 'unset' }, 'initial')).toBe(
      LoadErrors.MISSING
    );
  });

  it('renders the project view the Tasks route renders', () => {
    render(() => <InitiativeBlock />);

    expect(screen.getByText('project detail')).toBeTruthy();
    expect(mocks.detail).toHaveBeenCalledWith({
      route: { id: projectId, section: 'overview' },
      breadcrumb: {
        entry: {
          value: `initiative:${projectId}`,
          data: { type: 'initiative', id: projectId },
        },
        order: 0,
      },
    });
  });

  it('sends a disabled project to Tasks once flags have loaded', () => {
    mocks.flag = { enabled: false, loading: false };
    render(() => <InitiativeBlock />);

    expect(screen.getByText('redirect to tasks')).toBeTruthy();
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it('waits for flags before deciding', () => {
    mocks.flag = { enabled: false, loading: true };
    render(() => <InitiativeBlock />);

    expect(screen.getByText('loading')).toBeTruthy();
  });
});
