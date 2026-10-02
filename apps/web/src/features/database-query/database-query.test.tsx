import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { okAsync } from 'neverthrow';
import { type Accessor, createSignal, type JSX, onCleanup } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  QueryAnswer,
  QueryDefinition,
  QueryFailure,
  QuerySchema,
  SavedQuestion,
} from './core/query';
import { ChooseQuestionSource, DatabaseLiveQuestion } from './database-query';
import type { LiveQuerySource } from './queries/query-source';
import type { SaveQuestionSql } from './queries/saved-question';

const adapters = vi.hoisted(() => ({
  useDatabasesQuery: vi.fn(),
  useDatabaseDetailQuery: vi.fn(),
  createSavedQuestionSource:
    vi.fn<(queryId: () => string) => LiveQuerySource>(),
  trackQueryDatabase: vi.fn<(id: string, refresh: () => void) => void>(),
  saveQuestionSql: vi.fn<SaveQuestionSql>(),
  useDatabaseQueryDefinition: vi.fn(),
}));
vi.mock('@queries/storage/database-queries', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@queries/storage/database-queries')
  >()),
  useDatabaseQueryDefinition: adapters.useDatabaseQueryDefinition,
}));
vi.mock('@queries/storage/databases', () => ({
  useDatabasesQuery: adapters.useDatabasesQuery,
  useDatabaseDetailQuery: adapters.useDatabaseDetailQuery,
}));
vi.mock('@core/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/auth')>()),
  useHasPaidAccess: () => () => true,
}));
vi.mock('./queries/app-query-source', () => ({
  createQueryCapabilities: () => ({ generate: vi.fn(), read: vi.fn() }),
  createSavedQuestionSource: adapters.createSavedQuestionSource,
  saveQuestionSql: adapters.saveQuestionSql,
  trackQueryDatabase: adapters.trackQueryDatabase,
}));
vi.mock('./answer-display', async () => ({
  AppAnswerDisplay: (await import('./tests/plain-answer-display'))
    .PlainAnswerDisplay,
}));
vi.mock('./components/query-database-picker', async () => {
  const { For } = await import('solid-js');
  return {
    QueryDatabasePicker: (props: {
      databases: { id: string; name: string }[];
      value?: string;
      onChange: (id: string | undefined) => void;
    }) => (
      <select
        aria-label="Question database"
        value={props.value ?? ''}
        onChange={(event) =>
          props.onChange(event.currentTarget.value || undefined)
        }
      >
        <option value="" selected={!props.value}>
          Automatic
        </option>
        {props.value &&
          !props.databases.some((database) => database.id === props.value) && (
            <option value={props.value} selected>
              Saved database
            </option>
          )}
        <For each={props.databases}>
          {(database) => (
            <option value={database.id} selected={database.id === props.value}>
              {database.name}
            </option>
          )}
        </For>
      </select>
    ),
  };
});
vi.mock('./views/query-editor', () => ({
  QueryEditor: (props: {
    initial: QueryDefinition;
    schema: QuerySchema;
    onSave?: (definition: QueryDefinition) => void;
    sourcePicker?:
      | JSX.Element
      | ((schema: Accessor<QuerySchema>) => JSX.Element);
  }) => {
    const [prompt, setPrompt] = createSignal(props.initial.prompt);
    return (
      <>
        {typeof props.sourcePicker === 'function'
          ? props.sourcePicker(() => props.schema)
          : props.sourcePicker}
        <textarea
          aria-label="Draft question"
          value={prompt()}
          onInput={(event) => setPrompt(event.currentTarget.value)}
        />
        <span aria-label="Initial SQL">{props.initial.sql}</span>
        <button
          type="button"
          onClick={() =>
            props.onSave?.({
              ...props.initial,
              sql: 'SELECT COUNT(*) FROM open_tickets',
              prompt: prompt(),
            })
          }
        >
          Save draft
        </button>
        <span aria-label="Source name">{props.schema.name}</span>
      </>
    );
  },
}));
vi.mock('./views/live-question', () => ({
  LiveQuestion: (props: {
    answer?: QueryAnswer;
    error?: QueryFailure;
    editor?: (onClose: () => void) => JSX.Element;
  }) => (
    <>
      <div>{props.error ? 'failed' : props.answer ? 'answer' : 'loading'}</div>
      {props.editor?.(() => {})}
    </>
  ),
}));

const initial: QueryDefinition = {
  databaseId: 'source',
  sql: 'SELECT COUNT(*) FROM joined_table',
  prompt: 'Saved question',
  displayMode: 'scalar',
};
const saved: SavedQuestion = {
  queryId: 'saved-count',
  databaseId: 'source',
  prompt: 'Saved question',
  displayMode: 'scalar',
};
const detail: DatabaseDetail = {
  database: {
    id: 'source',
    name: 'Original database',
    owner_id: 'owner',
    created_at: '',
    trashed_at: null,
  },
  grant: 'owner',
  tables: [],
};
const answer: QueryAnswer = {
  columns: [],
  rows: [],
  rowIds: [],
  readTables: ['joined_table'],
  readDatabaseIds: ['joined_database'],
  truncatedTables: [],
};

/** A saved question's source whose answer and error the test sets. */
function fakeSource() {
  const [current, setAnswer] = createSignal<QueryAnswer>();
  const [error, setError] = createSignal<QueryFailure>();
  const source: LiveQuerySource = {
    answer: current,
    error,
    loading: () => false,
    refresh: vi.fn(() => okAsync(undefined)),
  };
  return { source, setAnswer, setError };
}
afterEach(() => vi.clearAllMocks());

describe('database question production wiring', () => {
  it('keeps the saved database visually selected when options arrive asynchronously and refresh', async () => {
    const [entries, setEntries] =
      createSignal<{ database: DatabaseDetail['database'] }[]>();
    adapters.useDatabasesQuery.mockReturnValue({
      get isPending() {
        return entries() === undefined;
      },
      get isSuccess() {
        return entries() !== undefined;
      },
      get data() {
        return entries();
      },
    });
    const other = {
      ...detail,
      database: { ...detail.database, id: 'other', name: 'Launch workspace' },
    };
    let selectedDatabase!: () => string | undefined;
    adapters.useDatabaseDetailQuery.mockImplementation(
      (id: () => string | undefined) => {
        selectedDatabase = id;
        return {
          isPending: false,
          get data() {
            return id() === 'source' ? detail : other;
          },
        };
      }
    );
    const save = vi.fn();
    const result = render(() => (
      <ChooseQuestionSource initial={initial} onSave={save} />
    ));
    const select = result.getByLabelText(
      'Question database'
    ) as HTMLSelectElement;
    const input = result.getByLabelText(
      'Draft question'
    ) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: 'My unsaved question' } });
    await Promise.resolve();
    setEntries([{ database: other.database }, { database: detail.database }]);
    expect(selectedDatabase()).toBe('source');
    expect(select.value).toBe('source');
    expect(select.selectedOptions[0]?.label).toBe('Original database');
    setEntries((current) =>
      current?.map((entry) => ({ database: { ...entry.database } }))
    );
    expect(select.value).toBe('source');
    expect(select.selectedOptions[0]?.label).toBe('Original database');
    expect(result.getByLabelText('Draft question')).toBe(input);
    expect(input.value).toBe('My unsaved question');
    expect(save).not.toHaveBeenCalled();
    result.unmount();
  });

  it('opens Automatic immediately and retains the draft when the optional database list refresh fails', async () => {
    const [failed, setFailed] = createSignal(false);
    adapters.useDatabasesQuery.mockReturnValue({
      isPending: false,
      get isSuccess() {
        return !failed();
      },
      get isError() {
        return failed();
      },
      data: [{ database: detail.database }],
    });
    adapters.useDatabaseDetailQuery.mockImplementation(
      (selectedId: () => string | undefined) => ({
        get isPending() {
          return !selectedId();
        },
        get data() {
          return selectedId() ? detail : undefined;
        },
      })
    );
    const result = render(() => (
      <ChooseQuestionSource
        initial={{ ...initial, databaseId: undefined }}
        onSave={() => {}}
      />
    ));
    const input = result.getByLabelText('Draft question');
    fireEvent.input(input, { target: { value: 'My unsaved question' } });
    setFailed(true);
    await Promise.resolve();
    expect(result.getByLabelText('Draft question')).toBe(input);
    expect((input as HTMLTextAreaElement).value).toBe('My unsaved question');
    expect(
      (result.getByLabelText('Question database') as HTMLSelectElement).value
    ).toBe('');
    result.unmount();
  });

  it('preserves a draft across schema refresh, errors, and an explicit source change', async () => {
    const [currentDetail, setCurrentDetail] = createSignal(detail);
    const [failed, setFailed] = createSignal(false);
    adapters.useDatabasesQuery.mockReturnValue({
      isSuccess: true,
      data: [
        { database: detail.database },
        {
          database: { ...detail.database, id: 'other', name: 'Other database' },
        },
      ],
    });
    adapters.useDatabaseDetailQuery.mockReturnValue({
      isPending: false,
      get isError() {
        return failed();
      },
      get data() {
        return currentDetail();
      },
    });
    const result = render(() => (
      <ChooseQuestionSource initial={initial} onSave={() => {}} />
    ));
    const input = result.getByLabelText('Draft question');
    fireEvent.input(input, { target: { value: 'Unsaved question' } });
    setCurrentDetail({
      ...detail,
      database: { ...detail.database, name: 'Renamed database' },
    });
    await result.findByText('Renamed database');
    expect(result.getByLabelText('Draft question')).toBe(input);
    expect((input as HTMLTextAreaElement).value).toBe('Unsaved question');
    setFailed(true);
    await result.findByRole('alert');
    expect(result.getByLabelText('Draft question')).toBe(input);
    expect((input as HTMLTextAreaElement).value).toBe('Unsaved question');
    setFailed(false);
    setCurrentDetail({
      ...detail,
      database: { ...detail.database, id: 'other', name: 'Other database' },
    });
    fireEvent.change(result.getByLabelText('Question database'), {
      target: { value: 'other' },
    });
    await waitFor(() =>
      expect(result.getByLabelText('Source name').textContent).toBe(
        'Other database'
      )
    );
    expect(result.getByLabelText('Draft question')).toBe(input);
    expect(
      (result.getByLabelText('Draft question') as HTMLTextAreaElement).value
    ).toBe('Unsaved question');
    result.unmount();
  });

  it('retains joined database tracking after a failed read while hiding the failed answer', async () => {
    const tracked = new Map<string, () => void>();
    adapters.trackQueryDatabase.mockImplementation((id, refresh) => {
      tracked.set(id, refresh);
      onCleanup(() => tracked.delete(id));
    });
    const fake = fakeSource();
    adapters.createSavedQuestionSource.mockReturnValue(fake.source);
    const result = render(() => <DatabaseLiveQuestion source={saved} />);
    expect(adapters.createSavedQuestionSource.mock.calls[0]?.[0]()).toBe(
      'saved-count'
    );
    fake.setAnswer(answer);
    await result.findByText('answer');
    await waitFor(() =>
      expect([...tracked.keys()]).toEqual(['source', 'joined_database'])
    );
    fake.setError({ kind: 'fetch', message: 'Temporary network failure' });
    await result.findByText('failed');
    expect(result.queryByText('answer')).toBeNull();
    expect([...tracked.keys()]).toEqual(['source', 'joined_database']);
    tracked.get('joined_database')?.();
    expect(fake.source.refresh).toHaveBeenCalledOnce();
    fake.setError(undefined);
    await result.findByText('answer');
    result.unmount();
    expect(tracked.size).toBe(0);
  });

  it('asks a new answer, saving its SQL as a query and pointing the node at it', async () => {
    adapters.useDatabasesQuery.mockReturnValue({ isPending: false, data: [] });
    adapters.useDatabaseDetailQuery.mockReturnValue({
      isPending: false,
      data: detail,
    });
    adapters.createSavedQuestionSource.mockReturnValue(fakeSource().source);
    adapters.saveQuestionSql.mockReturnValue(okAsync('new-count'));
    const onSave = vi.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const fresh: SavedQuestion = {
      queryId: '',
      databaseId: 'source',
      prompt: '',
      displayMode: 'scalar',
    };
    const result = render(() => (
      <QueryClientProvider client={client}>
        <DatabaseLiveQuestion source={fresh} onSave={onSave} />
      </QueryClientProvider>
    ));
    expect((await result.findByLabelText('Initial SQL')).textContent).toBe('');
    fireEvent.click(result.getByText('Save draft'));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(adapters.saveQuestionSql).toHaveBeenCalledExactlyOnceWith({
      sql: 'SELECT COUNT(*) FROM open_tickets',
      databaseId: 'source',
    });
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ queryId: 'new-count' });
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('sql');
    result.unmount();
    client.clear();
  });
});
