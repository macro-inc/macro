import { createMarkdownFile } from '@app/lib/queries/items/create';
import { queryClient } from '@queries/client';
import { calendarNotesClient } from '@service-calendar/notes';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import {
  type Accessor,
  createComponent,
  createRoot,
  createSignal,
} from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NoteDocumentSearch, NotesSource } from '../context/notes-source';
import type { NotePicker, NoteRead } from '../core/types';
import { notesKeys } from './keys';
import { createNotesSource } from './notes-source';

vi.mock('@app/lib/queries/items/create', () => ({
  createMarkdownFile: vi.fn(),
}));
vi.mock('@service-calendar/notes', () => ({
  calendarNotesClient: { list: vi.fn(), link: vi.fn(), documents: vi.fn() },
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

let dispose = () => {};
beforeEach(() => {
  vi.mocked(calendarNotesClient.list).mockResolvedValue(ok([]));
  vi.mocked(calendarNotesClient.link).mockResolvedValue(ok({}));
  vi.mocked(calendarNotesClient.documents).mockResolvedValue(
    ok({ documents: [], teams: [] })
  );
});
afterEach(() => {
  dispose();
  queryClient.clear();
  vi.resetAllMocks();
  vi.useRealTimers();
});

function mountSource(localSearch: NoteDocumentSearch = () => () => []) {
  const [user, setUser] = createSignal<string | undefined>('owner');
  const [target, setTarget] = createSignal({
    eventId: 'event-a',
    occurrenceKey: '2026-10-23T14:00:00Z',
  });
  let source: NotesSource | undefined;
  const [query, setQuery] = createSignal('');
  const [enabled, setEnabled] = createSignal(false);
  let picker: Accessor<NoteRead<NotePicker>> | undefined;
  function Probe() {
    source = createNotesSource(user, target, localSearch);
    picker = source.picker(query, enabled);
    return null;
  }
  createRoot((cleanup) => {
    dispose = cleanup;
    createComponent(QueryClientProvider, {
      client: queryClient,
      get children() {
        return createComponent(Probe, {});
      },
    });
  });
  if (!source || !picker) throw new Error('Notes source did not mount');
  return { source, setUser, setTarget, picker, setQuery, setEnabled };
}

it('reopens a recently viewed meeting from cache without another request', async () => {
  const notes = [
    { documentId: 'note-a', name: 'Notes', team: null, canManage: true },
  ];
  vi.mocked(calendarNotesClient.list).mockResolvedValue(ok(notes));
  const first = mountSource();
  await vi.waitFor(() => expect(first.source.notes().data).toHaveLength(1));
  dispose();
  const reopened = mountSource();
  expect(reopened.source.notes().data?.[0].documentId).toBe('note-a');
  expect(reopened.source.notes().pending).toBe(false);
  expect(calendarNotesClient.list).toHaveBeenCalledOnce();
  reopened.setTarget({ eventId: 'different-event', occurrenceKey: 'single' });
  expect(reopened.source.notes().data).toBeUndefined();
});

it('keeps matching candidates while a new search is pending and reuses earlier queries', async () => {
  vi.useFakeTimers();
  const initial = {
    documents: [
      { documentId: 'alpha', name: 'Alpha sync' },
      { documentId: 'beta', name: 'Beta sync' },
    ],
    teams: [{ id: 'team', name: 'Macro' }],
  };
  queryClient.setQueryData(notesKeys.documents('owner', '').queryKey, initial);
  const response =
    Promise.withResolvers<
      Awaited<ReturnType<typeof calendarNotesClient.documents>>
    >();
  vi.mocked(calendarNotesClient.documents).mockReturnValue(response.promise);
  const mounted = mountSource();
  mounted.setEnabled(true);
  mounted.setQuery('alp');
  expect(mounted.picker().data?.documents).toEqual([initial.documents[0]]);
  await vi.advanceTimersByTimeAsync(180);
  expect(mounted.picker().data?.documents).toEqual([initial.documents[0]]);
  expect(mounted.picker().data?.teams).toEqual(initial.teams);
  expect(mounted.picker().pending).toBe(true);
  response.resolve(
    ok({ documents: [initial.documents[0]], teams: initial.teams })
  );
  await vi.advanceTimersByTimeAsync(0);
  mounted.setQuery('');
  await vi.advanceTimersByTimeAsync(180);
  expect(mounted.picker().data?.documents).toEqual(initial.documents);
  expect(calendarNotesClient.documents).toHaveBeenCalledOnce();
});

it('shows local candidates before the server responds and deduplicates remote matches', async () => {
  const local = { documentId: 'cached', name: 'Cached note' };
  const response =
    Promise.withResolvers<
      Awaited<ReturnType<typeof calendarNotesClient.documents>>
    >();
  vi.mocked(calendarNotesClient.documents).mockReturnValue(response.promise);
  const mounted = mountSource(() => () => [local]);
  mounted.setEnabled(true);
  expect(mounted.picker().data?.documents).toEqual([local]);
  response.resolve(
    ok({
      documents: [local, { documentId: 'server', name: 'Server note' }],
      teams: [],
    })
  );
  await vi.waitFor(() =>
    expect(mounted.picker().data?.documents).toHaveLength(2)
  );
});

it('does not keep another account’s notes or teams as placeholder results', () => {
  queryClient.setQueryData(notesKeys.documents('owner', '').queryKey, {
    documents: [{ documentId: 'private', name: 'Private note' }],
    teams: [{ id: 'private-team', name: 'Previous team' }],
  });
  const mounted = mountSource();
  mounted.setEnabled(true);
  expect(mounted.picker().data?.documents).toHaveLength(1);
  mounted.setUser('another-owner');
  expect(mounted.picker().data?.documents).toEqual([]);
  expect(mounted.picker().data?.teams).toEqual([]);
});

it('links to the original occurrence when selection changes during creation', async () => {
  let finish = (_id: string) => {};
  vi.mocked(createMarkdownFile).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const { source, setTarget } = mountSource();
  const creating = source.create('Weekly sync notes');
  expect(createMarkdownFile).toHaveBeenCalledOnce();
  setTarget({ eventId: 'event-b', occurrenceKey: '2026-10-30T14:00:00Z' });
  finish('created-document');
  expect((await creating).isOk()).toBe(true);
  expect(calendarNotesClient.link).toHaveBeenCalledExactlyOnceWith(
    'event-a',
    '2026-10-23T14:00:00Z',
    'created-document',
    { teamId: null }
  );
});

it('does not link a newly created document under a different account', async () => {
  let finish = (_id: string) => {};
  vi.mocked(createMarkdownFile).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const { source, setUser } = mountSource();
  const creating = source.create('Weekly sync notes');
  setUser('another-owner');
  finish('created-document');
  const result = await creating;
  expect(result.isErr()).toBe(true);
  if (result.isErr())
    expect(result.error).toMatchObject({
      kind: 'created_unlinked',
      document: { documentId: 'created-document' },
    });
  expect(calendarNotesClient.link).not.toHaveBeenCalled();
});

it('preserves the created document when the server rejects linking', async () => {
  vi.mocked(createMarkdownFile).mockResolvedValueOnce('created-document');
  vi.mocked(calendarNotesClient.link).mockResolvedValueOnce(
    err([{ code: 'FORBIDDEN', message: 'Meeting access changed' }])
  );
  const { source } = mountSource();
  const result = await source.create('Weekly sync notes');
  expect(result.isErr()).toBe(true);
  if (result.isErr())
    expect(result.error).toMatchObject({
      kind: 'created_unlinked',
      document: { documentId: 'created-document', name: 'Weekly sync notes' },
    });
});
