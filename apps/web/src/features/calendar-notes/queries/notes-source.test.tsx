import { createMarkdownFile } from '@core/util/create';
import { queryClient } from '@queries/client';
import { calendarNotesClient } from '@service-calendar/notes';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createComponent, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NotesSource } from '../context/notes-source';
import { createNotesSource } from './notes-source';

vi.mock('@core/util/create', () => ({ createMarkdownFile: vi.fn() }));
vi.mock('@service-calendar/notes', () => ({
  calendarNotesClient: { list: vi.fn(), link: vi.fn() },
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
});
afterEach(() => {
  dispose();
  queryClient.clear();
  vi.resetAllMocks();
});

function mountSource() {
  const [user, setUser] = createSignal<string | undefined>('owner');
  const [target, setTarget] = createSignal({
    eventId: 'event-a',
    occurrenceKey: '2026-10-23T14:00:00Z',
  });
  let source: NotesSource | undefined;
  function Probe() {
    source = createNotesSource(user, target);
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
  if (!source) throw new Error('Notes source did not mount');
  return { source, setUser, setTarget };
}

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
