import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ChannelsViewContext,
  ChannelsViewProvider,
  useChannelsView,
} from './channels-view-context';
import type { ChannelsViewStateOptions } from './types';

const entry = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  captors: new Map<string, () => unknown>(),
}));
const touch = vi.hoisted(() => ({ value: false }));
const guard = vi.hoisted(() => ({
  selections: [] as unknown[],
  allow: true,
}));

vi.mock('@core/context/user', () => ({ useUserId: () => () => 'alice' }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => touch.value,
}));
vi.mock('@components/app/createPreviewSelectionGuard', () => ({
  createPreviewSelectionGuard: () => (selection: unknown) => {
    guard.selections.push(selection);
    return selection === undefined || guard.allow;
  },
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      currentEntryState: () => entry.state,
      registerEntryStateCaptor: (key: string, capture: () => unknown) => {
        entry.captors.set(key, capture);
        return () => entry.captors.delete(key);
      },
    },
  }),
}));

function mountProvider(initialState?: ChannelsViewStateOptions) {
  let context!: ChannelsViewContext;
  function ReadContext() {
    context = useChannelsView();
    return null;
  }
  const view = render(() => (
    <ChannelsViewProvider initialState={initialState}>
      <ReadContext />
    </ChannelsViewProvider>
  ));
  return { ...view, context };
}

beforeEach(() => {
  localStorage.clear();
  entry.state = {};
  entry.captors.clear();
  touch.value = false;
  guard.selections = [];
  guard.allow = true;
});
afterEach(cleanup);

describe('ChannelsViewProvider preview selection', () => {
  it.each(['entry', 'local', 'explicit'] as const)(
    'preserves a conflicting %s selection through persistence and remount',
    (source) => {
      const saved = { selectedChannelId: 'c1' };
      const storageKey = 'macro:channels:view-state:v1:alice';
      if (source === 'entry') entry.state = { 'channels.view': saved };
      if (source === 'local') {
        localStorage.setItem(storageKey, JSON.stringify(saved));
      }
      guard.allow = false;
      const first = mountProvider(source === 'explicit' ? saved : undefined);

      expect(first.context.state.selectedChannelId).toBe('c1');
      expect(first.context.previewChannelId()).toBeUndefined();
      // Unrelated preference writes must retain the blocked selection too.
      first.context.setGroupOpen('channels', false);
      expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject(
        saved
      );
      const captured = entry.captors.get('channels.view')?.();
      expect(captured).toMatchObject(saved);
      first.unmount();

      guard.allow = true;
      entry.state = source === 'local' ? {} : { 'channels.view': captured };
      const second = mountProvider();
      expect(second.context.state.selectedChannelId).toBe('c1');
      expect(second.context.previewChannelId()).toBe('c1');
    }
  );

  it('can retry a restored selection after the other view closes', () => {
    entry.state = { 'channels.view': { selectedChannelId: 'c1' } };
    guard.allow = false;
    const { context } = mountProvider();

    guard.allow = true;
    context.setSelectedChannelId('c1');
    expect(context.previewChannelId()).toBe('c1');

    guard.allow = false;
    context.setSelectedChannelId('c2');
    expect(context.state.selectedChannelId).toBe('c1');
    expect(context.previewChannelId()).toBe('c1');

    context.setSelectedChannelId(undefined);
    expect(context.state.selectedChannelId).toBeUndefined();
    expect(context.previewChannelId()).toBeUndefined();
  });

  it('claims the selected channel as an inline preview on desktop', () => {
    guard.allow = false;
    const { context } = mountProvider();

    context.setSelectedChannelId('c1');

    expect(guard.selections.at(-1)).toEqual({ type: 'channel', id: 'c1' });
    expect(context.state.selectedChannelId).toBeUndefined();
    expect(context.previewChannelId()).toBeUndefined();
  });

  it('keeps touch selections out of the preview registry', () => {
    touch.value = true;
    guard.allow = false;
    const { context } = mountProvider();

    context.setSelectedChannelId('c1');

    expect(context.mobileLayout()).toBe(true);
    expect(guard.selections.at(-1)).toBeUndefined();
    expect(context.state.selectedChannelId).toBe('c1');
    expect(context.previewChannelId()).toBeUndefined();
  });
});
