import type { SplitManager } from '@components/app/split-layout/layoutManager';
import { createRoutedSplitLayout } from '@components/app/split-layout/tests/fixtures';
import { createBlockOrchestrator } from '@core/orchestrator';
import type { UnifiedNotification } from '@notifications/types';
import { err, ok, type Result } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import type { NotificationInboxRow } from './context/notifications-inbox-context';
import {
  isVisibleInboxRow,
  openNotificationInSplit,
} from './open-notification-in-split';

const mocks = vi.hoisted(() => ({
  manager: vi.fn<() => SplitManager | undefined>(),
  open: vi.fn(async (): Promise<Result<void, string>> => ok(undefined)),
  entity: vi.fn(async () => {}),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: mocks.manager,
}));
vi.mock('@app/features/next-soup/utils', () => ({
  openEntityInSplitFromUnifiedList: mocks.entity,
}));
vi.mock('@notifications', () => ({ openNotification: mocks.open }));
vi.mock('@core/constant/allBlocks', () => ({
  blocks: {},
  resolveBlockAlias: (type: string) => type,
  isBlockAlias: () => false,
}));

function request(id = 'request-1', itemId = 'item-1'): UnifiedNotification {
  return {
    id,
    entity_type: 'team',
    entity_id: 'team-1',
    notification_event_type: 'password_access_requested',
    notification_metadata: {
      tag: 'password_access_requested',
      content: {
        teamId: 'team-1',
        requestId: id,
        itemId,
        itemName: 'Synthetic login',
      },
    },
    created_at: '2026-11-13T00:00:00Z',
    updated_at: '2026-11-13T00:00:00Z',
    sent: true,
    state: 'unseen',
  };
}
function teamRow(notifications = [request()]): NotificationInboxRow {
  return {
    id: 'team:team-1#password_access_requested:request-1',
    type: 'access_requested',
    revision: 'rev-1',
    latestAt: 1,
    unseen: true,
    count: notifications.length,
    actions: [{ kind: 'open' }],
    content: {
      entity: {
        type: 'team',
        id: 'team-1',
        name: 'Synthetic team',
        ownerId: 'viewer',
      },
      notifications,
    },
  };
}
const passwords = { enabled: () => true, teamId: () => 'team-1' };
function layout() {
  return createRoot((dispose) => {
    onTestFinished(dispose);
    const manager = createRoutedSplitLayout(createBlockOrchestrator(), '/home');
    const splitHandle = manager.activeSplit();
    if (!splitHandle) throw new Error('Fixture split missing');
    mocks.manager.mockReturnValue(manager);
    return { manager, splitHandle };
  });
}
beforeEach(() => {
  vi.clearAllMocks();
});

it('admits only the current team after the flag and team become available', () => {
  const [ready, setReady] = createSignal(false);
  const [team, setTeam] = createSignal<string>();
  const scope = { enabled: ready, teamId: team };
  const row = teamRow();
  expect(isVisibleInboxRow(row, undefined)).toBe(false);
  expect(isVisibleInboxRow(row, scope)).toBe(false);
  setReady(true);
  expect(isVisibleInboxRow(row, scope)).toBe(false);
  setTeam('team-1');
  expect(isVisibleInboxRow(row, scope)).toBe(true);
  setTeam('team-2');
  expect(isVisibleInboxRow(row, scope)).toBe(false);
  setTeam('team-1');
  setReady(false);
  expect(isVisibleInboxRow(row, scope)).toBe(false);
});

it('rejects empty, malformed, mixed or foreign Team payloads and leaves other rows alone', () => {
  expect(isVisibleInboxRow(teamRow([]), passwords)).toBe(false);
  expect(isVisibleInboxRow(teamRow([request('')]), passwords)).toBe(false);
  expect(
    isVisibleInboxRow(teamRow([request('request-1', '')]), passwords)
  ).toBe(false);
  const foreign = { ...request(), entity_id: 'team-2' };
  expect(isVisibleInboxRow(teamRow([request(), foreign]), passwords)).toBe(
    false
  );
  const invite: UnifiedNotification = {
    ...request(),
    notification_event_type: 'invite_to_team',
    notification_metadata: {
      tag: 'invite_to_team',
      content: {
        teamId: 'team-1',
        teamName: 'Synthetic team',
        teamInviteId: 'invite-1',
        invitedBy: 'macro|viewer@example.test',
      },
    },
  };
  expect(isVisibleInboxRow(teamRow([invite]), passwords)).toBe(false);
  const row = teamRow();
  row.content.entity = {
    type: 'harness',
    id: 'runtime',
    name: 'Runtime',
    ownerId: 'viewer',
  };
  expect(isVisibleInboxRow(row, undefined)).toBe(true);
});

it('opens the newest or chosen request and never falls back to a Team entity page', async () => {
  const { manager, splitHandle } = layout();
  const chosen = request('request-2', 'item-2');
  const row = teamRow([request(), chosen]);
  openNotificationInSplit(row, { splitHandle, newSplit: false, passwords });
  expect(mocks.open).toHaveBeenLastCalledWith(
    row.content.notifications[0],
    manager,
    false,
    expect.anything(),
    splitHandle
  );
  openNotificationInSplit(row, {
    splitHandle,
    newSplit: true,
    passwords,
    notification: { ...chosen },
  });
  expect(mocks.open).toHaveBeenLastCalledWith(
    chosen,
    manager,
    true,
    expect.anything(),
    splitHandle
  );
  mocks.open.mockResolvedValueOnce(err('not_found'));
  openNotificationInSplit(row, { splitHandle, newSplit: false, passwords });
  // Await the exact open operation before checking the fallback path.
  await mocks.open.mock.results.at(-1)?.value;
  expect(mocks.entity).not.toHaveBeenCalled();
});

it('rechecks current scope before opening a retained Team row', () => {
  const { splitHandle } = layout();
  const [team, setTeam] = createSignal('team-1');
  const scope = { enabled: () => true, teamId: team };
  const row = teamRow();
  setTeam('team-2');
  openNotificationInSplit(row, {
    splitHandle,
    newSplit: false,
    passwords: scope,
  });
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.entity).not.toHaveBeenCalled();
});
