import { cleanup, render } from '@solidjs/testing-library';
import { batch, createSignal } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import { ACTIONS } from '../component/LexicalMarkdown/plugins/actions/actions';
import type { Action } from '../component/LexicalMarkdown/plugins/actions/types';
import type { MenuEvent, MenuRowsRequest } from './generated/native-bridge';

const flag = vi.hoisted(() => ({ enabled: false }));
vi.mock('@app/lib/analytics/posthog', async (original) => ({
  ...(await original<typeof import('@app/lib/analytics/posthog')>()),
  useFeatureFlag: () => () => ({ enabled: flag.enabled, loading: false }),
}));

import { NativeActionSources } from './NativeActionSources';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  flag.enabled = false;
});

const first: MenuEvent = {
  action: 'query',
  query: {
    kind: 'action',
    term: '',
    selectedIndex: 0,
    nodeTypes: ['heading', 'quote', 'custom-code', 'list'],
    identity: {
      invocation: 1,
      mountGeneration: 1,
      modelGeneration: 1,
      queryGeneration: 1,
    },
  },
};

test('native slash rows retain actual catalog order and execute a typed shared block choice', async () => {
  vi.useFakeTimers();
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
    <NativeActionSources
      surface={surface}
      event={event}
      onError={(error) => {
        throw error;
      }}
    />
  ));
  setEvent(first);
  await vi.advanceTimersByTimeAsync(60);
  expect(rows.at(-1)?.rows.map((item) => item.id)).toEqual([
    'paragraph',
    'heading1',
    'heading2',
    'heading3',
    'quote',
    'code',
    'list-bullet',
    'list-number',
    'list-check',
  ]);
  expect(rows.at(-1)?.rows.map((item) => item.label)).toEqual(
    ACTIONS.slice(0, 9).map((item) => item.name)
  );
  setEvent({ ...first, action: 'select', rowId: 'list-check' });
  setEvent({ ...first, action: 'select', rowId: 'list-check' });
  expect(menuCommit).toHaveBeenCalledExactlyOnceWith({
    identity: first.query.identity,
    rowId: 'list-check',
    choice: { kind: 'block', block: 'check' },
  });
});

test('ignored and unregistered actions stay unavailable and overrides never run their old native command', async () => {
  vi.useFakeTimers();
  const override: Action = {
    ...ACTIONS[1],
    name: 'Custom heading',
    action: vi.fn(),
  };
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
    <NativeActionSources
      surface={surface}
      event={event}
      additionalActions={[override]}
      ignoreActionIds={['paragraph']}
      onError={(error) => {
        throw error;
      }}
    />
  ));
  const query = { ...first, query: { ...first.query, nodeTypes: ['heading'] } };
  setEvent(query);
  await vi.advanceTimersByTimeAsync(60);
  expect(rows.at(-1)?.rows.map((item) => item.id)).toEqual([
    'heading2',
    'heading3',
  ]);
  setEvent({ ...query, action: 'select', rowId: 'heading1' });
  expect(menuCommit).not.toHaveBeenCalled();
  expect(override.action).not.toHaveBeenCalled();
  expect(rows.at(-1)?.rejectedRowId).toBe('heading1');
});

test('source fuzzy queries and surface replacement cannot forward stale action rows', async () => {
  vi.useFakeTimers();
  const rows: Omit<MenuRowsRequest, 'scope'>[] = [];
  const original = {
    menuRows: async (reply: Omit<MenuRowsRequest, 'scope'>) => {
      rows.push(reply);
    },
    menuCommit: vi.fn(async () => {}),
  };
  const replacement = {
    menuRows: vi.fn(async () => {}),
    menuCommit: vi.fn(async () => {}),
  };
  const [surface, setSurface] = createSignal(original);
  const [event, setEvent] = createSignal<MenuEvent>();
  render(() => (
    <NativeActionSources
      surface={surface()}
      event={event}
      onError={(error) => {
        throw error;
      }}
    />
  ));
  const heading = { ...first, query: { ...first.query, term: 'HEADING 2' } };
  setEvent(heading);
  await vi.advanceTimersByTimeAsync(60);
  expect(rows.at(-1)?.rows[0]?.id).toBe('heading2');
  setSurface(replacement);
  expect(rows.at(-1)).toEqual({
    identity: first.query.identity,
    rows: [],
    buckets: [],
  });
  expect(replacement.menuRows).not.toHaveBeenCalled();
  setEvent({ ...heading, action: 'select', rowId: 'heading2' });
  expect(original.menuCommit).not.toHaveBeenCalled();
  expect(replacement.menuCommit).not.toHaveBeenCalled();
});

test.each([true, false])(
  'batched action replacement retains the new query (query first: %s)',
  async (queryFirst) => {
    vi.useFakeTimers();
    const original = {
      menuRows: vi.fn(async () => {}),
      menuCommit: vi.fn(async () => {}),
    };
    const replacement = {
      menuRows: vi.fn(async () => {}),
      menuCommit: vi.fn(async () => {}),
    };
    const [surface, setSurface] = createSignal(original);
    const [event, setEvent] = createSignal<MenuEvent>();
    render(() => (
      <NativeActionSources
        surface={surface()}
        event={event}
        onError={(error) => {
          throw error;
        }}
      />
    ));
    setEvent(first);
    await vi.advanceTimersByTimeAsync(60);
    batch(() => {
      if (queryFirst) {
        setEvent({ ...first });
        setSurface(replacement);
      } else {
        setSurface(replacement);
        setEvent({ ...first });
      }
    });
    expect(original.menuRows).toHaveBeenLastCalledWith({
      identity: first.query.identity,
      rows: [],
      buckets: [],
    });
    expect(replacement.menuRows).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({ id: 'heading1' }),
        ]),
      })
    );
    setEvent({ ...first, action: 'select', rowId: 'heading1' });
    expect(replacement.menuCommit).toHaveBeenCalledExactlyOnceWith({
      identity: first.query.identity,
      rowId: 'heading1',
      choice: { kind: 'block', block: 'heading1' },
    });
  }
);
