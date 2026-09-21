import type { DatabaseDetail, ExecOutcome } from '@service-storage/databases';
import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { type Accessor, createSignal, type JSX, onCleanup } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryAnswer, QueryDefinition, QuerySchema } from './core/query';
import {
  ChooseQuestionSource,
  DatabaseLiveQuestion,
  DatabaseQuestionPanel,
} from './database-query';

const adapters = vi.hoisted(() => ({
  useDatabasesQuery: vi.fn(),
  useDatabaseDetailQuery: vi.fn(),
  readLiveQuery: vi.fn<() => Promise<ExecOutcome>>(),
  trackQueryDatabase: vi.fn<(id: string, refresh: () => void) => void>(),
}));
vi.mock('@queries/storage/databases', () => ({
  useDatabasesQuery: adapters.useDatabasesQuery,
  useDatabaseDetailQuery: adapters.useDatabaseDetailQuery,
}));
vi.mock('./queries/app-query-source', () => ({
  queryCapabilities: { generate: vi.fn(), read: vi.fn() },
  readLiveQuery: adapters.readLiveQuery,
  subscribeToQueryChanges: () => {},
  trackQueryDatabase: adapters.trackQueryDatabase,
}));
vi.mock('./components/query-database-picker', () => ({
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
      {props.databases.map((database) => (
        <option value={database.id} selected={database.id === props.value}>
          {database.name}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('./views/query-editor', () => ({
  QueryEditor: (props: {
    initial: QueryDefinition;
    schema: QuerySchema;
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
        <span aria-label="Source name">{props.schema.name}</span>
        <span aria-label="Focused table">
          {
            props.schema.tables.find(
              (table) => table.id === props.schema.focusTableId
            )?.name
          }
        </span>
        <span aria-label="Available tables">
          {props.schema.tables.map((table) => table.name).join(', ')}
        </span>
      </>
    );
  },
}));
vi.mock('./views/live-question', () => ({
  LiveQuestion: (props: { answer?: QueryAnswer; error?: unknown }) => (
    <div>{props.error ? 'failed' : props.answer ? 'answer' : 'loading'}</div>
  ),
}));

const initial: QueryDefinition = {
  databaseId: 'source',
  sql: 'SELECT COUNT(*) FROM joined_table',
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
const outcome: ExecOutcome = {
  results: [],
  changes_applied: 0,
  inserted_row_ids: [],
  new_versions: {},
  read_tables: ['joined_table'],
  read_database_ids: ['joined_database'],
  read_versions: { joined_table: 4 },
  truncated_tables: [],
};
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

  it('passes the active table as AI context while keeping the entire database schema', () => {
    const [activeTableId, setActiveTableId] = createSignal('second');
    const result = render(() => (
      <DatabaseQuestionPanel
        activeTableId={activeTableId()}
        detail={{
          ...detail,
          tables: [
            {
              table: {
                id: 'first',
                database_id: 'source',
                name: 'Projects',
                position: 'a',
                version: 1,
              },
              sql_name: 'projects',
              columns: [],
            },
            {
              table: {
                id: 'second',
                database_id: 'source',
                name: 'Contacts',
                position: 'b',
                version: 1,
              },
              sql_name: 'contacts',
              columns: [],
            },
          ],
        }}
      />
    ));
    expect(result.getByLabelText('Focused table').textContent).toBe('Contacts');
    expect(result.getByLabelText('Available tables').textContent).toContain(
      'Projects, Contacts'
    );
    expect(result.queryByLabelText('Question table')).toBeNull();
    setActiveTableId('first');
    expect(result.getByLabelText('Focused table').textContent).toBe('Projects');
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

  it('retains joined database tracking after a failed refetch while hiding the failed answer', async () => {
    const tracked = new Set<string>();
    adapters.trackQueryDatabase.mockImplementation((id) => {
      tracked.add(id);
      onCleanup(() => tracked.delete(id));
    });
    adapters.readLiveQuery
      .mockResolvedValueOnce(outcome)
      .mockRejectedValueOnce(new Error('Temporary network failure'))
      .mockResolvedValue(outcome);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const result = render(() => (
      <QueryClientProvider client={client}>
        <DatabaseLiveQuestion source={initial} />
      </QueryClientProvider>
    ));
    await result.findByText('answer');
    await waitFor(() =>
      expect([...tracked]).toEqual(['source', 'joined_database'])
    );
    await client.refetchQueries();
    await result.findByText('failed');
    expect(result.queryByText('answer')).toBeNull();
    expect([...tracked]).toEqual(['source', 'joined_database']);
    await client.refetchQueries();
    await result.findByText('answer');
    result.unmount();
    expect(tracked.size).toBe(0);
    client.clear();
  });
});
