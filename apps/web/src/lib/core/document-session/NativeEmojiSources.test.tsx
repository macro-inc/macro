import { Telemetry } from '@macro-inc/observability';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import { searchEmojis } from '../component/Emoji/emoji-catalog';
import {
  clearEmojiUsage,
  emojiUsageCount,
} from '../component/Emoji/emojiUsage';
import type { MenuEvent, MenuRowsRequest } from './generated/native-bridge';
import { NativeEmojiSources } from './NativeEmojiSources';

// Catalog loading itself is awaited explicitly; the actual lazy source and ranking run here.
const catalog = import('../component/Emoji/emoji-catalog');
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  clearEmojiUsage();
  vi.restoreAllMocks();
});

const first: MenuEvent = {
  action: 'query',
  query: {
    kind: 'emoji',
    term: 'ROCKET',
    selectedIndex: 0,
    nodeTypes: ['text'],
    identity: {
      invocation: 1,
      mountGeneration: 1,
      modelGeneration: 1,
      queryGeneration: 1,
    },
  },
};

test('native emoji rows use the real catalog and commit canonical Unicode once', async () => {
  vi.useFakeTimers();
  await catalog;
  const rows: Omit<MenuRowsRequest, 'scope'>[] = [];
  const menuCommit = vi.fn(async () => {});
  const surface = {
    menuRows: async (reply: Omit<MenuRowsRequest, 'scope'>) => {
      rows.push(reply);
    },
    menuCommit,
  };
  const [event, setEvent] = createSignal<MenuEvent>();
  render(() => (
    <NativeEmojiSources
      surface={surface}
      event={event}
      onError={(error) => {
        throw error;
      }}
    />
  ));
  setEvent(first);
  await vi.advanceTimersByTimeAsync(200);
  const reply = rows.at(-1);
  expect(reply?.rows.map((item) => item.label)).toEqual(
    searchEmojis('rocket').map((item) => item.emoji)
  );
  expect(reply?.rows[0]?.label).toBe('🚀');
  expect(reply?.buckets[0]?.isLoading).toBe(false);
  const rowId = reply?.rows[0]?.id;
  setEvent({ ...first, action: 'select', rowId });
  setEvent({ ...first, action: 'select', rowId });
  expect(menuCommit).toHaveBeenCalledExactlyOnceWith({
    identity: first.query.identity,
    rowId,
    choice: { kind: 'text', text: '🚀' },
  });
  expect(emojiUsageCount('🚀')).toBe(1);
});

test('a changed query or replacement surface rejects previous emoji rows', async () => {
  vi.useFakeTimers();
  await catalog;
  const rows: Omit<MenuRowsRequest, 'scope'>[] = [];
  const menuCommit = vi.fn(async () => {});
  const original = {
    menuRows: async (reply: Omit<MenuRowsRequest, 'scope'>) => {
      rows.push(reply);
    },
    menuCommit,
  };
  const [surface, setSurface] = createSignal(original);
  const [event, setEvent] = createSignal<MenuEvent>();
  render(() => (
    <NativeEmojiSources
      surface={surface()}
      event={event}
      onError={(error) => {
        throw error;
      }}
    />
  ));
  setEvent(first);
  await vi.advanceTimersByTimeAsync(200);
  const old = rows.at(-1)?.rows[0]?.id;
  const changed = {
    ...first,
    query: {
      ...first.query,
      term: 'heart',
      identity: { ...first.query.identity, queryGeneration: 2 },
    },
  };
  setEvent(changed);
  setEvent({ ...first, action: 'select', rowId: old });
  expect(menuCommit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(200);
  expect(rows.at(-1)?.rows[0]?.label).toBe('❤️');
  const replacement = { menuRows: vi.fn(async () => {}), menuCommit };
  setSurface(replacement);
  expect(replacement.menuRows).not.toHaveBeenCalled();
  expect(rows.at(-1)).toEqual({
    identity: changed.query.identity,
    rows: [],
    buckets: [],
  });
  setEvent({ ...changed, action: 'select', rowId: rows.at(-1)?.rows[0]?.id });
  expect(menuCommit).not.toHaveBeenCalled();
});

test('failed native insertion releases the pending row without retrying the command', async () => {
  vi.useFakeTimers();
  await catalog;
  const rows: Omit<MenuRowsRequest, 'scope'>[] = [];
  const failure = new Error('fixture insertion rejected');
  const menuCommit = vi.fn(async () => {
    throw failure;
  });
  const surface = {
    menuRows: async (reply: Omit<MenuRowsRequest, 'scope'>) => {
      rows.push(reply);
    },
    menuCommit,
  };
  const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
  const callbackFailure = new Error('fixture error callback');
  const onError = vi.fn(() => {
    expect(rows.at(-1)?.rows).toEqual([]);
    expect(rows.at(-1)?.buckets).toEqual([]);
    throw callbackFailure;
  });
  const [event, setEvent] = createSignal<MenuEvent>();
  render(() => (
    <NativeEmojiSources surface={surface} event={event} onError={onError} />
  ));
  setEvent(first);
  await vi.advanceTimersByTimeAsync(200);
  const rowId = rows.at(-1)?.rows[0]?.id;
  setEvent({ ...first, action: 'select', rowId });
  await vi.advanceTimersByTimeAsync(0);
  expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
  expect(rows.at(-1)).toEqual({
    identity: first.query.identity,
    rejectedRowId: rowId,
    rows: [],
    buckets: [],
  });
  expect(menuCommit).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledWith(callbackFailure, {
    surface: 'native-emoji.provider',
  });
});
