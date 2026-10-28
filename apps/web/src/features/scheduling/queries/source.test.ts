import { schedulingClient } from '@service-email/scheduling';
import { ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { SchedulingScope } from '../core/types';
import {
  createSchedulingSource,
  useSchedulingProfileWithAutoSetupQuery,
} from './source';

type Options = {
  queryKey: readonly unknown[];
  queryFn: () => Promise<unknown>;
};
const captured = vi.hoisted(() => ({
  read: undefined as (() => Options) | undefined,
}));

vi.mock('@queries/client', () => ({ queryClient: {} }));
vi.mock('@tanstack/solid-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/solid-query')>()),
  useQuery: (read: () => Options) => {
    captured.read = read;
    return {};
  },
  useMutation: () => ({}),
}));
vi.mock('@service-email/scheduling', () => ({
  schedulingClient: {
    bookings: vi.fn(async () => ok({ bookings: [] })),
    settings: vi.fn(async () =>
      ok({
        profile: {
          id: 'profile',
          name: '',
          description: '',
          revision: 1,
          schedules: [],
          eventTypes: [],
        },
      })
    ),
  },
}));

it('keeps cached scheduling requests independent of retired scope accessors', async () => {
  const [scope, setScope] = createSignal<SchedulingScope>({
    id: 'first',
    name: 'First',
    teamId: 'team-first',
    canEdit: true,
    canManageBookings: true,
  });
  let retired = false;
  const dispose = createRoot((dispose) => {
    useSchedulingProfileWithAutoSetupQuery(
      () => {
        if (retired) throw new Error('retired component read');
        return scope();
      },
      () => {
        if (retired) throw new Error('retired user read');
        return 'owner';
      }
    );
    return dispose;
  });
  const first = captured.read!();
  setScope({
    id: 'second',
    name: 'Second',
    teamId: 'team-second',
    canEdit: true,
    canManageBookings: true,
  });
  const second = captured.read!();
  dispose();
  retired = true;

  await first.queryFn();
  await second.queryFn();
  expect(first.queryKey).not.toEqual(second.queryKey);
  expect(schedulingClient.settings).toHaveBeenNthCalledWith(1, 'team-first');
  expect(schedulingClient.settings).toHaveBeenNthCalledWith(2, 'team-second');
});

it('keeps cached bookings tied to their original owner and date range', async () => {
  const [scope, setScope] = createSignal<SchedulingScope>({
    id: 'first',
    name: 'First',
    teamId: 'team-first',
    canEdit: true,
    canManageBookings: true,
  });
  const [range, setRange] = createSignal({
    from: '2026-10-01',
    to: '2026-10-08',
  });
  let retired = false;
  const dispose = createRoot((dispose) => {
    createSchedulingSource(
      () => {
        if (retired) throw new Error('retired scope read');
        return scope();
      },
      () => {
        if (retired) throw new Error('retired range read');
        return range();
      }
    );
    return dispose;
  });
  const first = captured.read!();
  setScope({
    id: 'second',
    name: 'Second',
    teamId: 'team-second',
    canEdit: true,
    canManageBookings: true,
  });
  setRange({ from: '2026-10-08', to: '2026-10-15' });
  const second = captured.read!();
  dispose();
  retired = true;

  await first.queryFn();
  await second.queryFn();
  expect(first.queryKey).not.toEqual(second.queryKey);
  expect(schedulingClient.bookings).toHaveBeenNthCalledWith(1, 'team-first', {
    from: '2026-10-01',
    to: '2026-10-08',
  });
  expect(schedulingClient.bookings).toHaveBeenNthCalledWith(2, 'team-second', {
    from: '2026-10-08',
    to: '2026-10-15',
  });
});
