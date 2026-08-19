/** @vitest-environment jsdom */

import {
  transitionChannelCategoryAuthentication,
  useChannelCategoryAuthentication,
} from '@queries/channel/categories';
import { channelKeys } from '@queries/channel/keys';
import { queryClient } from '@queries/client';
import type { ChannelCategoryLayout } from '@service-storage/client';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { DragDropProvider, useDragDropContext } from '@thisbeyond/solid-dnd';
import { err, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: () => undefined as string | undefined,
  get: vi.fn(),
  replace: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@core/context/user', () => ({ useUserId: () => mocks.user }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.toast },
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getChannelCategoryLayout: mocks.get,
    replaceChannelCategoryLayout: mocks.replace,
  },
}));

import {
  ChannelCategoryControls,
  ChannelCategoryRowDnd,
} from './channel-category-controls';

const base = (revision = 1): ChannelCategoryLayout => ({
  revision,
  categories: [
    { id: 'work', name: 'Work' },
    { id: 'social', name: 'Social' },
  ],
  placements: [
    { channel_id: 'one', category_id: 'work' },
    { channel_id: 'two', category_id: 'work' },
  ],
});

let pointerTarget = '';

function PointerDndDriver() {
  const [, actions] = useDragDropContext()!;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          pointerTarget = 'channel-category:social';
          actions.dragStart('channel-category-row:one');
          actions.detectCollisions();
          actions.dragEnd();
        }}
      >
        Pointer move channel
      </button>
      <button
        type="button"
        onClick={() => {
          pointerTarget = 'channel-category-order-target:social';
          actions.dragStart('channel-category-order:work');
          actions.detectCollisions();
          actions.dragEnd();
        }}
      >
        Pointer reorder category
      </button>
    </>
  );
}

function Harness(props: { initialUser?: string }) {
  mocks.user = () => props.initialUser ?? 'user-a';
  return (
    <QueryClientProvider client={queryClient}>
      <DragDropProvider
        collisionDetector={(_, droppables) =>
          droppables.find((item) => item.id === pointerTarget) ?? null
        }
      >
        <ChannelCategoryControls />
        <ChannelCategoryRowDnd channelId="one" channelName="One">
          <div>One row</div>
        </ChannelCategoryRowDnd>
        <ChannelCategoryRowDnd channelId="two" channelName="Two">
          <div>Two row</div>
        </ChannelCategoryRowDnd>
        <PointerDndDriver />
      </DragDropProvider>
    </QueryClientProvider>
  );
}

function ReactiveAuthHarness(props: {
  exposeSetUser: (setUser: (userId: string) => void) => void;
}) {
  const [user, setUser] = createSignal('user-a');
  mocks.user = user;
  props.exposeSetUser(setUser);
  useChannelCategoryAuthentication();
  return (
    <QueryClientProvider client={queryClient}>
      <DragDropProvider>
        <ChannelCategoryControls />
      </DragDropProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  queryClient.clear();
  mocks.get.mockReset().mockResolvedValue(ok(base()));
  mocks.replace.mockReset();
  mocks.toast.mockReset();
});

afterEach(() => queryClient.clear());

describe('rendered channel-category coordinator integration', () => {
  it('evicts and refetches across a reactive A to B to A auth transition', async () => {
    let setUser!: (userId: string) => void;
    mocks.get
      .mockResolvedValueOnce(
        ok({
          ...base(1),
          categories: [
            { id: 'a-old', name: 'A old' },
            { id: 'a-other', name: 'A other' },
          ],
        })
      )
      .mockResolvedValueOnce(
        ok({
          ...base(2),
          categories: [
            { id: 'b', name: 'B only' },
            { id: 'b-other', name: 'B other' },
          ],
        })
      )
      .mockResolvedValueOnce(
        ok({
          ...base(3),
          categories: [
            { id: 'a-new', name: 'A fresh' },
            { id: 'a-new-other', name: 'A fresh other' },
          ],
        })
      );
    render(() => (
      <ReactiveAuthHarness exposeSetUser={(setter) => (setUser = setter)} />
    ));
    await screen.findByRole('button', { name: /^A old category,/ });

    setUser('user-b');
    await screen.findByRole('button', { name: /^B only category,/ });
    expect(
      queryClient.getQueryData(channelKeys.categoryLayout('user-a').queryKey)
    ).toBeUndefined();
    setUser('user-a');
    await screen.findByRole('button', { name: /^A fresh category,/ });
    expect(mocks.get).toHaveBeenCalledTimes(3);
    expect(
      queryClient.getQueryData<ChannelCategoryLayout>(
        channelKeys.categoryLayout('user-a').queryKey
      )?.revision
    ).toBe(3);
    expect(
      queryClient.getQueryData(channelKeys.categoryLayout('user-b').queryKey)
    ).toBeUndefined();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('cancels queued work and suppresses cache/toast leakage on account switch', async () => {
    queryClient.setQueryData(
      channelKeys.categoryLayout('user-b').queryKey,
      base()
    );
    let resolveFirst!: (value: unknown) => void;
    mocks.get.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve))
    );
    render(() => <Harness />);
    await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));

    transitionChannelCategoryAuthentication('user-b');
    resolveFirst(ok({ ...base(), revision: 2 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(
      queryClient.getQueryData(channelKeys.categoryLayout('user-a').queryKey)
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(channelKeys.categoryLayout('user-b').queryKey)
    ).toEqual(base());
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('serializes actions from category controls and separate rendered rows', async () => {
    const requests: ChannelCategoryLayout[] = [];
    mocks.replace.mockImplementation(async (layout: ChannelCategoryLayout) => {
      requests.push(layout);
      return ok({ ...layout, revision: layout.revision + 1 });
    });
    render(() => <Harness />);
    await screen.findByRole('button', { name: /^Work category,/ });

    fireEvent.click(
      screen.getByRole('button', { name: 'Move Work category right' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Move One to Social' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Two to Social' }));

    await vi.waitFor(() => expect(requests).toHaveLength(3));
    expect(requests.map((request) => request.revision)).toEqual([1, 2, 3]);
    expect(requests[2].placements).toEqual([
      { channel_id: 'one', category_id: 'social' },
      { channel_id: 'two', category_id: 'social' },
    ]);
  });

  it('uses the production DnD context and handlers for pointer moves and reorder', async () => {
    mocks.replace.mockImplementation(async (layout: ChannelCategoryLayout) =>
      ok({ ...layout, revision: layout.revision + 1 })
    );
    render(() => <Harness />);
    await screen.findByRole('button', { name: /^Work category,/ });

    fireEvent.click(
      screen.getByRole('button', { name: 'Pointer move channel' })
    );
    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledTimes(1));
    expect(mocks.replace.mock.calls[0][0].placements).toContainEqual({
      channel_id: 'one',
      category_id: 'social',
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Pointer reorder category' })
    );
    await vi.waitFor(() =>
      expect(
        mocks.replace.mock.calls.some(
          ([request]) => request.categories[0].id === 'social'
        )
      ).toBe(true)
    );
  });

  it('hydrates the persisted layout after a rendered reload', async () => {
    let persisted = base();
    mocks.get.mockImplementation(async () => ok(persisted));
    mocks.replace.mockImplementation(async (layout: ChannelCategoryLayout) => {
      persisted = { ...layout, revision: layout.revision + 1 };
      return ok(persisted);
    });
    const first = render(() => <Harness />);
    await screen.findByRole('button', { name: /^Work category,/ });
    fireEvent.click(
      screen.getByRole('button', { name: 'Move Work category right' })
    );
    await vi.waitFor(() => expect(persisted.categories[0].id).toBe('social'));

    first.unmount();
    queryClient.removeQueries({
      queryKey: channelKeys.categoryLayout('user-a').queryKey,
    });
    render(() => <Harness />);
    await vi.waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', {
          name: 'Move Social category left',
        }).disabled
      ).toBe(true)
    );
  });

  it.each([
    [
      'success',
      ok({ ...base(8), categories: [{ id: 'work', name: 'Server' }] }),
    ],
    ['failure', err([{ code: 'SERVER_ERROR', message: 'refetch failed' }])],
  ] as const)(
    'rolls back a rendered optimistic conflict with refetch %s',
    async (_, recovery) => {
      mocks.replace.mockResolvedValue(
        err([{ code: 'CONFLICT', message: 'conflict' }])
      );
      mocks.get
        .mockResolvedValueOnce(ok(base()))
        .mockResolvedValueOnce(recovery);
      render(() => <Harness />);
      await screen.findByRole('button', { name: /^Work category,/ });
      fireEvent.click(
        screen.getByRole('button', { name: 'Move Work category right' })
      );

      await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1));
      const cached = queryClient.getQueryData<ChannelCategoryLayout>(
        channelKeys.categoryLayout('user-a').queryKey
      );
      expect(cached?.categories[0].id).toBe('work');
    }
  );
});
