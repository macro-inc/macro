import { cleanup, render } from '@solidjs/testing-library';
import { type ComponentProps, createSignal } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import type { MentionsMenu } from '../component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenu';
import type { NativeMentionPresentation } from '../component/LexicalMarkdown/component/menu/MentionsMenu/native-presentation';
import type { MentionItem } from '../component/LexicalMarkdown/utils/mentionsUtils';
import type { MenuEvent } from './generated/native-bridge';

const source = vi.hoisted(() => ({
  pick: undefined as ((item: MentionItem) => void) | undefined,
  presentation: undefined as NativeMentionPresentation | undefined,
  tasks: [] as Promise<unknown>[],
  track:
    vi.fn<(document: string, kind: string, id: string) => Promise<string>>(),
}));
vi.mock('@core/signal/mention', () => ({ trackMention: source.track }));
vi.mock('@core/util/fireAndForget', () => ({
  fireAndForget: (task: Promise<unknown>) => source.tasks.push(task),
}));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: () => 'unknown',
  verifyBlockName: () => true,
}));
// Only the presentation is replaced here; actual selection policy and backend completion run below.
vi.mock(
  '../component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenu',
  () => ({
    MentionsMenu: (props: ComponentProps<typeof MentionsMenu>) => {
      source.pick = props.onPick;
      source.presentation = props.nativePresentation;
      return null;
    },
  })
);

import { NativeMentionSources } from './NativeMentionSources';

afterEach(() => {
  cleanup();
  source.tasks.length = 0;
  source.track.mockReset();
  source.pick = undefined;
  source.presentation = undefined;
});

function query(generation: number): MenuEvent {
  return {
    action: 'query',
    query: {
      kind: 'mention',
      term: 'p',
      selectedIndex: 0,
      nodeTypes: ['user-mention'],
      identity: {
        mountGeneration: 1,
        modelGeneration: 0,
        invocation: 1,
        queryGeneration: generation,
      },
    },
  };
}
const person: MentionItem = {
  kind: 'user',
  bucket: 'person',
  id: 'fixture-user',
  searchText: 'Person',
  sortTimestamp: 0,
  timestamps: {},
  data: { id: 'fixture-user', name: 'Person', email: 'user@example.com' },
};

test('late reference completion cannot insert into a newer native query', async () => {
  let complete: ((reference: string) => void) | undefined;
  let enter: (() => void) | undefined;
  const pending = new Promise<string>((resolve) => {
    complete = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  source.track
    .mockImplementationOnce(async () => {
      enter?.();
      return await pending;
    })
    .mockResolvedValue('new-reference');
  const surface = {
    menuRows: vi.fn(async () => {}),
    menuCommit: vi.fn(async () => {}),
  };
  const [event, setEvent] = createSignal<MenuEvent | undefined>(query(1));
  render(() => (
    <NativeMentionSources
      surface={surface}
      event={event}
      anchor={document.createElement('div')}
      handlers={{ blockId: 'fixture-document', blockName: 'md' }}
      onError={vi.fn()}
    />
  ));
  source.pick?.(person);
  await entered;
  setEvent(query(2));
  complete?.('old-reference');
  await Promise.all(source.tasks);
  expect(surface.menuCommit).not.toHaveBeenCalled();
  source.pick?.(person);
  await Promise.all(source.tasks);
  expect(surface.menuCommit).toHaveBeenCalledExactlyOnceWith({
    identity: query(2).query.identity,
    rowId: person.id,
    choice: {
      kind: 'user',
      user: {
        userId: 'fixture-user',
        email: 'user@example.com',
        displayName: 'Person',
        mentionUuid: 'new-reference',
      },
    },
  });
});

test('replacing a surface cancels insertion even when its menu counters coincide', async () => {
  let complete: ((reference: string) => void) | undefined;
  let enter: (() => void) | undefined;
  const pending = new Promise<string>((resolve) => {
    complete = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  source.track.mockImplementation(async () => {
    enter?.();
    return await pending;
  });
  const oldSurface = {
    menuRows: vi.fn(async () => {}),
    menuCommit: vi.fn(async () => {}),
  };
  const newSurface = {
    menuRows: vi.fn(async () => {}),
    menuCommit: vi.fn(async () => {}),
  };
  const [surface, setSurface] = createSignal(oldSurface);
  const [event, setEvent] = createSignal<MenuEvent | undefined>(query(1));
  render(() => (
    <NativeMentionSources
      surface={surface()}
      event={event}
      anchor={document.createElement('div')}
      handlers={{ blockId: 'fixture-document', blockName: 'md' }}
      onError={vi.fn()}
    />
  ));
  source.pick?.(person);
  await entered;
  setSurface(newSurface);
  setEvent(query(1));
  complete?.('old-reference');
  await Promise.all(source.tasks);
  expect(oldSurface.menuCommit).not.toHaveBeenCalled();
  expect(newSurface.menuCommit).not.toHaveBeenCalled();
});

test('a repeated pick in the same query supersedes its earlier reference request', async () => {
  let complete: ((reference: string) => void) | undefined;
  let enter: (() => void) | undefined;
  const pending = new Promise<string>((resolve) => {
    complete = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  source.track
    .mockImplementationOnce(async () => {
      enter?.();
      return await pending;
    })
    .mockResolvedValue('current-reference');
  const surface = {
    menuRows: vi.fn(async () => {}),
    menuCommit: vi.fn(async () => {}),
  };
  const [event, setEvent] = createSignal<MenuEvent | undefined>(query(1));
  render(() => (
    <NativeMentionSources
      surface={surface}
      event={event}
      anchor={document.createElement('div')}
      handlers={{ blockId: 'fixture-document', blockName: 'md' }}
      onError={vi.fn()}
    />
  ));
  setEvent({ action: 'select', query: query(1).query, rowId: person.id });
  source.pick?.(person);
  await entered;
  setEvent({ action: 'select', query: query(1).query, rowId: person.id });
  source.pick?.(person);
  complete?.('stale-reference');
  await Promise.all(source.tasks);
  expect(surface.menuCommit).toHaveBeenCalledExactlyOnceWith({
    identity: query(1).query.identity,
    rowId: person.id,
    choice: {
      kind: 'user',
      user: {
        userId: 'fixture-user',
        email: 'user@example.com',
        displayName: 'Person',
        mentionUuid: 'current-reference',
      },
    },
  });
});

test('forwards loaded counts and actual source loading/error state to native buckets', async () => {
  const surface = {
    menuRows: vi.fn(async () => {}),
    menuCommit: vi.fn(async () => {}),
  };
  const [event] = createSignal<MenuEvent | undefined>(query(1));
  render(() => (
    <NativeMentionSources
      surface={surface}
      event={event}
      anchor={document.createElement('div')}
      handlers={{ blockId: 'fixture-document', blockName: 'md' }}
      onError={vi.fn()}
    />
  ));
  source.presentation?.publish({
    items: [person],
    term: 'p',
    viewAll: 'users',
    buckets: [
      {
        id: 'users',
        label: 'People',
        getData: () => [person],
        getFullCount: () => 1,
        hasMore: () => true,
        isLoadingMore: () => false,
      },
    ],
    status: () => ({ isLoading: true, error: 'Search unavailable' }),
  });
  await Promise.all(source.tasks);
  expect(surface.menuRows).toHaveBeenCalledWith(
    expect.objectContaining({
      buckets: [
        {
          id: 'users',
          label: 'People',
          loadedCount: 1,
          hasMore: true,
          isLoadingMore: false,
          isLoading: true,
          error: 'Search unavailable',
        },
      ],
    })
  );
});
