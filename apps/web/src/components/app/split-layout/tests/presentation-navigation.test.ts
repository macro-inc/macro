import { claimOf } from '@app/lib/split-router';
import type { BlockOrchestrator } from '@core/orchestrator';
import { createEffect, createRoot } from 'solid-js';
import { expect, it, onTestFinished, vi } from 'vitest';
import type { SplitContent } from '../layoutManager';
import { resolveContentLocation } from '../split-router/legacy-route';
import { createRoutedSplitLayoutHarness } from './fixtures';

vi.mock('../componentRegistry', () => ({
  resolveComponent: () => ({ element: undefined }),
}));
vi.mock('@core/constant/allBlocks', () => ({
  blocks: { channel: {} },
  isBlockAlias: () => false,
  resolveBlockAlias: (type: string) => type,
}));

function setup(url: string) {
  const orchestrator = {
    createBlockInstance: () => ({
      element: undefined,
      dispose() {},
      detach() {},
    }),
  } as unknown as BlockOrchestrator;
  return createRoot((dispose) => {
    onTestFinished(dispose);
    return createRoutedSplitLayoutHarness(orchestrator, url);
  });
}

it.each(['pane', 'inline claim', 'registered preview'] as const)(
  'waits for the actual target-search commit when reusing a %s',
  async (kind) => {
    const orchestrator = {
      createBlockInstance: () => ({
        element: undefined,
        dispose() {},
        detach() {},
      }),
    } as unknown as BlockOrchestrator;
    const { manager, router } = createRoot((dispose) => {
      onTestFinished(dispose);
      return createRoutedSplitLayoutHarness(
        orchestrator,
        kind === 'pane' ? '/channel/channel/~/home' : '/channels/~/home'
      );
    });
    const pane = router.panes()[0]!;
    const content: SplitContent = {
      type: 'channel',
      id: 'channel',
      params: { channel_message_id: 'new-message' },
    };
    const oldEntry = router.entry(pane)!;
    if (kind === 'inline claim') {
      const claim = claimOf(
        router.routes,
        resolveContentLocation(router.routes, content).route
      );
      if (!claim) throw new Error('Missing channel claim');
      onTestFinished(
        router.claims.register(() => [
          {
            owner: Symbol.for('inline-channel'),
            pane,
            claim,
            activate: () => router.activatePane(pane),
          },
        ])
      );
    }
    if (kind === 'registered preview') {
      onTestFinished(
        manager.registerOpenViews(() => [
          {
            owner: {},
            content,
            activate: () => manager.activateSplit(manager.splits()[0]!.id),
          },
        ])
      );
    }
    const guard = Promise.withResolvers<boolean>();
    onTestFinished(
      router.registerGuard(pane, 1, () => guard.promise, {
        search: ['channels'],
      })
    );
    const presented = vi.fn();
    const request =
      Promise.withResolvers<
        NonNullable<ReturnType<typeof manager.presentation.pending>>
      >();
    createRoot((dispose) => {
      onTestFinished(dispose);
      createEffect(() => {
        const pending = manager.presentation.pending();
        if (pending) request.resolve(pending);
      });
    });
    manager.openWithSplit(content, { onPresented: presented });
    expect(manager.presentation.pending()).toBeUndefined();
    expect(router.entry(pane)?.id).toBe(oldEntry.id);
    guard.resolve(true);
    const pending = await request.promise;
    const entry = router.entry(pane)!;
    expect(entry.id).not.toBe(oldEntry.id);
    expect(pending.entryId).toBe(entry.id);
    expect(pending.owner).toBe(manager.splits()[0]!.id);
    expect(entry.location.search?.channels.messageId).toEqual(['new-message']);
    expect(router.panes()).toHaveLength(2);
    expect(presented).not.toHaveBeenCalled();
    if (kind !== 'pane')
      expect(entry.location.route).toEqual(oldEntry.location.route);
  }
);

it('does not present an old entry when a pane acquires the destination during a guard', async () => {
  const { manager, router } = setup('/channels/~/home');
  const [holder, source] = router.panes();
  if (!holder || !source) throw new Error('Missing fixture panes');
  const opening = Promise.withResolvers<boolean>();
  const targetSearch = Promise.withResolvers<boolean>();
  const targetStarted = Promise.withResolvers<void>();
  const committed = Promise.withResolvers<void>();
  onTestFinished(router.registerGuard(source, 1, () => opening.promise));
  const request =
    Promise.withResolvers<
      NonNullable<ReturnType<typeof manager.presentation.pending>>
    >();
  createRoot((dispose) => {
    onTestFinished(dispose);
    createEffect(() => {
      const pending = manager.presentation.pending();
      if (pending) request.resolve(pending);
    });
  });
  manager.openWithSplit(
    {
      type: 'channel',
      id: 'channel',
      params: { channel_message_id: 'new-message' },
    },
    { onPresented: vi.fn() }
  );
  await router.navigatePane(holder, '/channel/channel');
  onTestFinished(
    router.registerGuard(
      holder,
      1,
      ({ onCommit }) => {
        targetStarted.resolve();
        onCommit(() => committed.resolve());
        return targetSearch.promise;
      },
      { search: ['channels'] }
    )
  );
  opening.resolve(true);
  await targetStarted.promise;
  targetSearch.resolve(true);
  await committed.promise;
  const pending = await request.promise;
  expect(pending.entryId).toBe(router.entry(holder)?.id);
  expect(router.entry(holder)?.location.search?.channels.messageId).toEqual([
    'new-message',
  ]);
});

it('does not acknowledge an unrelated pane for a registered popover without activation', () => {
  const { manager, router } = setup('/channels/~/home');
  const content: SplitContent = { type: 'channel', id: 'channel' };
  onTestFinished(
    manager.registerOpenViews(() => [{ owner: 'popover', content }])
  );
  manager.openWithSplit(content, { onPresented: vi.fn() });
  const request = manager.presentation.pending();
  if (!request) throw new Error('Missing presentation request');
  expect(manager.getSplit(request.owner)?.content()).toMatchObject(content);
  expect(
    router.entry(router.panes()[0]!)?.location.route.matches.at(-1)?.id
  ).toBe('view-channels');
});
