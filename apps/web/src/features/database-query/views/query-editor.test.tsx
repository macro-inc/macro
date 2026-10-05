import { showDatabaseSql } from '@core/constant/featureFlags';
import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryCapabilities } from '../context/query-context';
import type { QueryAnswer, QueryDefinition, QuerySchema } from '../core/query';
import { PlainAnswerDisplay } from '../tests/plain-answer-display';
import { QueryEditor } from './query-editor';

vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 346, height: 300 }),
}));

const answer: QueryAnswer = {
  columns: [{ name: 'Count', kind: 'number' }],
  rows: [[{ type: 'number', value: 7 }]],
  rowIds: [],
  readTables: ['projects'],
  readDatabaseIds: [],
  truncatedTables: [],
};

describe('question editor', () => {
  beforeEach(() => {
    showDatabaseSql.enabled = true;
  });
  afterEach(() => {
    showDatabaseSql.enabled = false;
  });

  it('handles prompt Enter before a composer shell can send the message', async () => {
    const send = vi.fn();
    const generate = vi.fn(() =>
      okAsync({
        sql: 'SELECT COUNT(*) FROM projects',
        explanation: '',
        displayMode: 'scalar' as const,
      })
    );
    const save = vi.fn();
    const result = render(() => (
      <div
        on:keydown={(event) => {
          send();
          event.stopPropagation();
        }}
      >
        <PlainAnswerDisplay>
          <QueryEditor
            initial={{
              sql: '',
              prompt: 'Count projects',
              displayMode: 'scalar',
            }}
            schema={{ name: 'Projects', databaseId: 'db', tables: [] }}
            capabilities={{ generate, read: () => okAsync(answer) }}
            onSave={save}
          />
        </PlainAnswerDisplay>
      </div>
    ));
    const input = result.getByRole('textbox', { name: 'Ask your database' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    await result.findByRole('button', { name: 'Insert' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(send).not.toHaveBeenCalled();
    result.unmount();
  });

  it('regenerates a saved question and saves only its successful current answer', async () => {
    const save = vi.fn();
    const read = vi.fn(() => okAsync(answer));
    const generate = vi.fn(() =>
      okAsync({
        sql: 'SELECT COUNT(*) FROM projects',
        explanation: '',
        displayMode: 'scalar' as const,
      })
    );
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={{
            sql: 'SELECT 1',
            prompt: 'Original question',
            displayMode: 'scalar',
          }}
          schema={{ name: 'Projects', databaseId: 'db', tables: [] }}
          capabilities={{ generate, read }}
          onSave={save}
          saveOnGenerate
        />
      </PlainAnswerDisplay>
    ));
    expect(read).not.toHaveBeenCalled();
    fireEvent.input(
      result.getByRole('textbox', { name: 'Ask your database' }),
      { target: { value: 'Count all projects' } }
    );
    fireEvent.click(result.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Count all projects',
          sql: 'SELECT COUNT(*) FROM projects',
        })
      )
    );
    result.unmount();
  });

  it('keeps the source trigger mounted while its reactive source label changes', () => {
    const [schema, setSchema] = createSignal<QuerySchema>({
      name: 'Automatic',
      tables: [],
    });
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={{ sql: '', prompt: '', displayMode: 'scalar' }}
          schema={schema()}
          capabilities={{ generate: vi.fn(), read: vi.fn() }}
          sourcePicker={(source) => (
            <button type="button">{source().name}</button>
          )}
        />
      </PlainAnswerDisplay>
    ));
    const trigger = result.getByRole('button', { name: 'Automatic' });
    trigger.focus();
    setSchema({ databaseId: 'support', name: 'Support', tables: [] });
    expect(result.getByRole('button', { name: 'Support' })).toBe(trigger);
    expect(document.activeElement).toBe(trigger);
    result.unmount();
  });

  it('offers valid chart choices after result aliases change and replaces stale mappings on explicit selection', async () => {
    const chartAnswer: QueryAnswer = {
      ...answer,
      columns: [
        { name: 'Stage', kind: 'text' },
        { name: 'Total', kind: 'number' },
      ],
      rows: [
        [
          { type: 'text', value: 'Active' },
          { type: 'number', value: 4 },
        ],
        [
          { type: 'text', value: 'Done' },
          { type: 'number', value: 2 },
        ],
      ],
    };
    const save = vi.fn();
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={{
            sql: 'SELECT stage AS Stage, COUNT(*) AS Total FROM projects GROUP BY stage',
            prompt: 'Chart tasks',
            displayMode: 'bar',
            chart: { x: 'Status', y: ['Count'] },
          }}
          schema={{ databaseId: 'db', name: 'Projects', tables: [] }}
          capabilities={{ generate: vi.fn(), read: () => okAsync(chartAnswer) }}
          onSave={save}
        />
      </PlainAnswerDisplay>
    ));
    await result.findByText(/This chart’s columns are unavailable/);
    expect(result.getByRole('table')).toBeTruthy();
    fireEvent.change(result.getByLabelText('Display answer as'), {
      target: { value: 'line' },
    });
    expect(
      result.getByRole('img', { name: 'Total by Stage. Line chart.' })
    ).toBeTruthy();
    fireEvent.click(result.getByRole('button', { name: 'Insert' }));
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        displayMode: 'line',
        chart: { x: 'Stage', y: ['Total'] },
      })
    );
    result.unmount();
  });
  it('renders the suggested chart and saves its settings, including manual display changes', async () => {
    const chart = { x: 'Status', y: ['Count'], title: 'Tasks by status' };
    const chartAnswer: QueryAnswer = {
      ...answer,
      columns: [
        { name: 'Status', kind: 'text' },
        { name: 'Count', kind: 'number' },
      ],
      rows: [
        [
          { type: 'text', value: 'Todo' },
          { type: 'number', value: 3 },
        ],
        [
          { type: 'text', value: 'Done' },
          { type: 'number', value: 2 },
        ],
      ],
    };
    const save = vi.fn();
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={{ sql: '', prompt: '', displayMode: 'scalar' }}
          schema={{ databaseId: 'db', name: 'Projects', tables: [] }}
          capabilities={{
            generate: () =>
              okAsync({
                sql: 'SELECT status AS Status, COUNT(*) AS Count FROM projects GROUP BY status',
                explanation: 'Counts tasks in each status.',
                displayMode: 'bar',
                chart,
              }),
            read: () => okAsync(chartAnswer),
          }}
          onSave={save}
        />
      </PlainAnswerDisplay>
    ));
    fireEvent.input(result.getByLabelText('Ask your database'), {
      target: { value: 'Chart tasks by status' },
    });
    fireEvent.click(result.getByRole('button', { name: 'Ask' }));
    await result.findByRole('button', { name: 'Insert' });
    expect(
      result.getByRole('img', { name: 'Tasks by status. Bar chart.' })
    ).toBeTruthy();
    expect(
      (result.getByLabelText('Display answer as') as HTMLSelectElement).value
    ).toBe('bar');
    fireEvent.click(result.getByRole('button', { name: 'Insert' }));
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ displayMode: 'bar', chart })
    );
    fireEvent.change(result.getByLabelText('Display answer as'), {
      target: { value: 'line' },
    });
    expect(
      result.getByRole('img', { name: 'Tasks by status. Line chart.' })
    ).toBeTruthy();
    fireEvent.click(result.getByRole('button', { name: 'Insert' }));
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ displayMode: 'line', chart })
    );
    fireEvent.change(result.getByLabelText('Display answer as'), {
      target: { value: 'table' },
    });
    expect(result.getByRole('table')).toBeTruthy();
    result.unmount();
  });
  it('focuses the AI prompt on open and preserves typing through schema refresh', () => {
    const [schema, setSchema] = createSignal<QuerySchema>({
      databaseId: 'db',
      name: 'Planning',
      tables: [],
    });
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          autoFocus
          initial={{
            databaseId: 'db',
            prompt: '',
            sql: '',
            displayMode: 'scalar',
          }}
          schema={schema()}
          capabilities={{
            generate: vi.fn<QueryCapabilities['generate']>(() =>
              okAsync({ sql: 'SELECT 7', explanation: '' })
            ),
            read: vi.fn<QueryCapabilities['read']>(() => okAsync(answer)),
          }}
        />
      </PlainAnswerDisplay>
    ));
    const prompt = result.getByLabelText(
      'Ask your database'
    ) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(prompt);
    fireEvent.input(prompt, { target: { value: 'How many tasks?' } });
    setSchema({ databaseId: 'db', name: 'Roadmap', tables: [] });
    expect(document.activeElement).toBe(prompt);
    expect(prompt.value).toBe('How many tasks?');
    result.unmount();
  });
  it('does not submit Enter used to compose text, then asks the completed question', async () => {
    const generate = vi.fn<QueryCapabilities['generate']>(() =>
      okAsync({ sql: 'SELECT 7', explanation: '' })
    );
    const read = vi.fn<QueryCapabilities['read']>(() => okAsync(answer));
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={{
            databaseId: 'db',
            prompt: '',
            sql: '',
            displayMode: 'scalar',
          }}
          schema={{ databaseId: 'db', name: 'Planning', tables: [] }}
          capabilities={{ generate, read }}
        />
      </PlainAnswerDisplay>
    ));
    const prompt = result.getByLabelText('Ask your database');
    fireEvent.input(prompt, { target: { value: '進行中' } });
    expect(fireEvent.keyDown(prompt, { key: 'Enter', isComposing: true })).toBe(
      true
    );
    expect(fireEvent.keyDown(prompt, { key: 'Enter', keyCode: 229 })).toBe(
      true
    );
    expect(fireEvent.keyDown(prompt, { key: 'Enter', shiftKey: true })).toBe(
      true
    );
    expect(generate).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();

    fireEvent.input(prompt, {
      target: { value: '進行中のプロジェクトはいくつありますか？' },
    });
    fireEvent.keyDown(prompt, { key: 'Enter' });
    await result.findByText('7');
    expect(generate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        prompt: '進行中のプロジェクトはいくつありますか？',
      })
    );
    expect(read).toHaveBeenCalledExactlyOnceWith(
      'SELECT 7',
      expect.objectContaining({ databaseId: 'db' })
    );
    result.unmount();
  });

  it('asks across the entire database without a table picker and saves the verified source', async () => {
    const tables = [
      {
        id: 'tickets',
        name: 'Tickets',
        sqlName: '"Tickets"',
        columns: [],
      },
      {
        id: 'customers',
        name: 'Customers',
        sqlName: '"Customers"',
        columns: [],
      },
    ];
    const source: QuerySchema = {
      databaseId: 'support',
      name: 'Support',
      tables,
    };
    const generate = vi.fn<QueryCapabilities['generate']>(() =>
      okAsync({
        sql: 'SELECT COUNT(*) FROM "Tickets"',
        explanation: 'Counts tickets.',
        source,
      })
    );
    const save = vi.fn();
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          autoFocus
          initial={{ sql: '', prompt: '', displayMode: 'scalar' }}
          schema={{ name: 'Automatic', tables: [] }}
          sourcePicker={(schema) => (
            <button type="button">{schema().name}</button>
          )}
          capabilities={{
            generate,
            read: (_sql, context) =>
              okAsync({ ...answer, source: context?.source }),
          }}
          onSave={save}
        />
      </PlainAnswerDisplay>
    ));
    const prompt = result.getByLabelText('Ask your database');
    expect(document.activeElement).toBe(prompt);
    expect(result.getByRole('button', { name: 'Automatic' })).toBeTruthy();
    expect(result.queryByLabelText('Question table')).toBeNull();
    fireEvent.input(prompt, { target: { value: 'How many tickets?' } });
    fireEvent.keyDown(prompt, { key: 'Enter' });
    await result.findByRole('button', { name: 'Insert' });
    expect(result.getByText('7')).toBeTruthy();
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: expect.objectContaining({ name: 'Automatic', tables: [] }),
      })
    );
    expect(result.getByRole('button', { name: 'Support' })).toBeTruthy();
    fireEvent.click(result.getByRole('button', { name: 'Insert' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ databaseId: 'support' })
    );
    expect(save.mock.calls[0][0].tableId).toBeUndefined();
    result.unmount();
  });

  it('preserves the draft through explicit source changes and requires a new answer', async () => {
    const [schema, setSchema] = createSignal<QuerySchema>({
      databaseId: 'support',
      name: 'Support',
      tables: [],
    });
    const generate = vi.fn<QueryCapabilities['generate']>(() =>
      okAsync({
        sql: 'SELECT 7',
        explanation: 'Counts records.',
      })
    );
    const save = vi.fn();
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={{
            databaseId: 'support',
            sql: 'SELECT 7',
            prompt: 'How many records?',
            displayMode: 'scalar',
          }}
          schema={schema()}
          capabilities={{ generate, read: () => okAsync(answer) }}
          onSave={save}
        />
      </PlainAnswerDisplay>
    ));
    await result.findByRole('button', { name: 'Insert' });
    const prompt = result.getByLabelText(
      'Ask your database'
    ) as HTMLTextAreaElement;
    setSchema({ databaseId: 'sales', name: 'Sales', tables: [] });
    expect(prompt.value).toBe('How many records?');
    expect(result.queryByRole('button', { name: 'Insert' })).toBeNull();
    fireEvent.keyDown(prompt, { key: 'Enter' });
    await result.findByRole('button', { name: 'Insert' });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: expect.objectContaining({ databaseId: 'sales' }),
      })
    );
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(result.getByRole('button', { name: 'Insert' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ databaseId: 'sales' })
    );
    result.unmount();
  });

  it('updates a changed question before allowing its answer to be saved', async () => {
    const generate = vi.fn<QueryCapabilities['generate']>(() =>
      okAsync({
        sql: 'SELECT COUNT(*) FROM projects WHERE approved = 1',
        explanation: 'Counts approved projects.',
      })
    );
    const read = vi.fn<QueryCapabilities['read']>(() => okAsync(answer));
    const save = vi.fn();
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={{
            databaseId: 'db',
            prompt: 'How many projects?',
            sql: 'SELECT COUNT(*) FROM projects',
            displayMode: 'scalar',
          }}
          schema={{ databaseId: 'db', name: 'Planning', tables: [] }}
          capabilities={{ generate, read }}
          onSave={save}
          saveLabel="Save live answer"
        />
      </PlainAnswerDisplay>
    ));
    await result.findByRole('button', { name: 'Save live answer' });
    fireEvent.input(result.getByLabelText('Ask your database'), {
      target: { value: 'How many approved projects?' },
    });
    expect(
      result.queryByRole('button', { name: 'Save live answer' })
    ).toBeNull();
    fireEvent.click(result.getByRole('button', { name: 'Update answer' }));
    await result.findByRole('button', { name: 'Save live answer' });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'How many approved projects?' })
    );
    expect(read).toHaveBeenLastCalledWith(
      'SELECT COUNT(*) FROM projects WHERE approved = 1',
      expect.objectContaining({ databaseId: 'db' })
    );
    fireEvent.click(result.getByRole('button', { name: 'Save live answer' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'How many approved projects?',
        sql: 'SELECT COUNT(*) FROM projects WHERE approved = 1',
      })
    );
    fireEvent.click(result.getByRole('button', { name: 'Refresh answer' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    expect(generate).toHaveBeenCalledTimes(1);
    result.unmount();
  });

  it('shows the answer after Ask and only changes the saved source on explicit save', async () => {
    const initial: QueryDefinition = {
      databaseId: 'db',
      prompt: 'The saved question',
      sql: 'SELECT 1',
      displayMode: 'scalar',
    };
    const generate = vi.fn<QueryCapabilities['generate']>(() =>
      okAsync({
        sql: 'SELECT COUNT(*) FROM projects',
        explanation: 'Counts every project in the table.',
      })
    );
    const read = vi.fn<QueryCapabilities['read']>(() => okAsync(answer));
    const save = vi.fn();
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={initial}
          schema={{
            databaseId: 'db',
            name: 'Planning',
            focusTableId: 'projects',
            tables: [
              {
                id: 'projects',
                name: 'Projects',
                sqlName: 'projects',
                columns: [],
              },
            ],
          }}
          capabilities={{ generate, read }}
          onSave={save}
          saveLabel="Save live answer"
        />
      </PlainAnswerDisplay>
    ));
    fireEvent.input(result.getByLabelText('Ask your database'), {
      target: { value: 'How many projects?' },
    });
    fireEvent.click(result.getByRole('button', { name: 'Ask' }));
    await result.findByRole('button', { name: 'Save live answer' });
    expect(result.getByText('7')).toBeTruthy();
    expect(read).toHaveBeenCalledWith(
      'SELECT COUNT(*) FROM projects',
      expect.objectContaining({ databaseId: 'db' })
    );
    expect(save).not.toHaveBeenCalled();
    expect(initial.sql).toBe('SELECT 1');
    expect(result.queryByLabelText('Query SQL')).toBeNull();
    expect(result.queryByText('Counts every project in the table.')).toBeNull();
    fireEvent.click(result.getByRole('button', { name: 'Save live answer' }));
    expect(save).toHaveBeenCalledWith({
      databaseId: 'db',
      tableId: 'projects',
      prompt: 'How many projects?',
      sql: 'SELECT COUNT(*) FROM projects',
      displayMode: 'scalar',
    });
    result.unmount();
  });

  it('previews saved SQL automatically and reuses it for an unchanged question', async () => {
    const read = vi.fn<QueryCapabilities['read']>(() => okAsync(answer));
    const generate = vi.fn();
    const save = vi.fn();
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={{
            databaseId: 'db',
            prompt: 'How many projects?',
            sql: 'SELECT COUNT(*) FROM projects',
            displayMode: 'scalar',
          }}
          schema={{ databaseId: 'db', name: 'Planning', tables: [] }}
          capabilities={{ read, generate }}
          onSave={save}
        />
      </PlainAnswerDisplay>
    ));
    await result.findByRole('button', { name: 'Insert' });
    expect(read).toHaveBeenCalledExactlyOnceWith(
      'SELECT COUNT(*) FROM projects',
      expect.objectContaining({ databaseId: 'db' })
    );
    expect(result.queryByRole('button', { name: 'Show answer' })).toBeNull();
    expect(result.queryByRole('button', { name: 'Run SQL' })).toBeNull();
    fireEvent.click(result.getByRole('button', { name: 'Refresh answer' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await result.findByRole('button', { name: 'Insert' });
    expect(read).toHaveBeenLastCalledWith(
      'SELECT COUNT(*) FROM projects',
      expect.objectContaining({ databaseId: 'db' })
    );
    expect(generate).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    result.unmount();
  });

  it('runs manual saved SQL with no prompt and exposes Run SQL only in the editor', async () => {
    const read = vi.fn<QueryCapabilities['read']>(() => okAsync(answer));
    const generate = vi.fn();
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={{
            databaseId: 'db',
            prompt: '',
            sql: 'SELECT 7',
            displayMode: 'scalar',
          }}
          schema={{ databaseId: 'db', name: 'Planning', tables: [] }}
          capabilities={{ read, generate }}
        />
      </PlainAnswerDisplay>
    ));
    await result.findByText('7');
    expect(result.queryByRole('button', { name: 'Run SQL' })).toBeNull();
    fireEvent.click(result.getByRole('button', { name: 'SQL' }));
    fireEvent.click(result.getByRole('button', { name: 'Run SQL' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(read).toHaveBeenLastCalledWith(
      'SELECT 7',
      expect.objectContaining({ databaseId: 'db' })
    );
    expect(generate).not.toHaveBeenCalled();
    result.unmount();
  });

  it('does not let an automatic saved preview replace a newly asked question', async () => {
    let resolveSaved!: (value: QueryAnswer) => void;
    const read = vi
      .fn<QueryCapabilities['read']>()
      .mockImplementationOnce(() =>
        ResultAsync.fromSafePromise(
          new Promise<QueryAnswer>((resolve) => {
            resolveSaved = resolve;
          })
        )
      )
      .mockImplementation(() => okAsync(answer));
    const generate = vi.fn<QueryCapabilities['generate']>(() =>
      okAsync({
        sql: 'SELECT 7',
        explanation: 'New answer.',
      })
    );
    const save = vi.fn();
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={{
            databaseId: 'db',
            prompt: 'Old question',
            sql: 'SELECT 999',
            displayMode: 'scalar',
          }}
          schema={{ databaseId: 'db', name: 'Planning', tables: [] }}
          capabilities={{ read, generate }}
          onSave={save}
        />
      </PlainAnswerDisplay>
    ));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    fireEvent.input(result.getByLabelText('Ask your database'), {
      target: { value: 'New question' },
    });
    fireEvent.click(result.getByRole('button', { name: 'Ask' }));
    await result.findByText('7');
    resolveSaved({
      ...answer,
      rows: [[{ type: 'number', value: 999 }]],
    });
    await Promise.resolve();
    expect(result.queryByText('999')).toBeNull();
    fireEvent.click(result.getByRole('button', { name: 'Insert' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'New question', sql: 'SELECT 7' })
    );
    result.unmount();
  });

  it('keeps the optional source picker available while a selected database is unavailable', () => {
    const generate = vi.fn();
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={{
            databaseId: 'removed',
            sql: '',
            prompt: 'Count tickets',
            displayMode: 'scalar',
          }}
          schema={{
            databaseId: 'removed',
            name: 'Database unavailable',
            tables: [],
          }}
          sourceAvailable={false}
          sourcePicker={<button type="button">Change database</button>}
          capabilities={{ read: vi.fn(), generate }}
        />
      </PlainAnswerDisplay>
    ));
    expect(
      result.getByRole('button', { name: 'Change database' })
    ).toBeTruthy();
    expect(
      (result.getByRole('button', { name: 'Ask' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    fireEvent.keyDown(result.getByLabelText('Ask your database'), {
      key: 'Enter',
    });
    expect(generate).not.toHaveBeenCalled();
    result.unmount();
  });

  it('infers a result table without showing a one-option display picker', async () => {
    const tableAnswer: QueryAnswer = {
      ...answer,
      rows: [[{ type: 'number', value: 7 }], [{ type: 'number', value: 8 }]],
    };
    const save = vi.fn();
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={{
            databaseId: 'db',
            prompt: 'List projects',
            sql: '',
            displayMode: 'scalar',
          }}
          schema={{ databaseId: 'db', name: 'Planning', tables: [] }}
          capabilities={{
            read: () => okAsync(tableAnswer),
            generate: () =>
              okAsync({ sql: 'SELECT count FROM projects', explanation: '' }),
          }}
          onSave={save}
        />
      </PlainAnswerDisplay>
    ));
    fireEvent.click(result.getByRole('button', { name: 'Ask' }));
    await result.findByRole('button', { name: 'Insert' });
    expect(result.queryByLabelText('Display answer as')).toBeNull();
    fireEvent.click(result.getByRole('button', { name: 'Insert' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ displayMode: 'table' })
    );
    result.unmount();
  });

  it('preserves a scalar display override across refresh and explicit save', async () => {
    const save = vi.fn();
    const read = vi.fn<QueryCapabilities['read']>(() => okAsync(answer));
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={{
            databaseId: 'db',
            prompt: '',
            sql: 'SELECT 7',
            displayMode: 'table',
          }}
          schema={{ databaseId: 'db', name: 'Planning', tables: [] }}
          capabilities={{ read, generate: vi.fn() }}
          onSave={save}
        />
      </PlainAnswerDisplay>
    ));
    const format = (await result.findByRole('combobox', {
      name: 'Display answer as',
    })) as HTMLSelectElement;
    expect(format.value).toBe('table');
    expect(format.selectedOptions[0]?.label).toBe('Result table');
    fireEvent.click(result.getByRole('button', { name: 'Refresh answer' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await result.findByRole('button', { name: 'Insert' });
    const refreshedFormat = result.getByRole('combobox', {
      name: 'Display answer as',
    }) as HTMLSelectElement;
    expect(refreshedFormat.value).toBe('table');
    expect(refreshedFormat.selectedOptions[0]?.label).toBe('Result table');
    fireEvent.click(result.getByRole('button', { name: 'Insert' }));
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ displayMode: 'table' })
    );
    fireEvent.change(refreshedFormat, { target: { value: 'scalar' } });
    expect(refreshedFormat.value).toBe('scalar');
    expect(refreshedFormat.selectedOptions[0]?.label).toBe('Inline answer');
    fireEvent.click(result.getByRole('button', { name: 'Insert' }));
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ displayMode: 'scalar' })
    );
    result.unmount();
  });

  it('inserts a proposed answer when Enter is pressed again', async () => {
    const generate = vi.fn<QueryCapabilities['generate']>(() =>
      okAsync({
        sql: 'SELECT COUNT(*) AS Count FROM projects',
        explanation: 'Counts projects.',
      })
    );
    const save = vi.fn();
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={{ sql: '', prompt: '', displayMode: 'scalar' }}
          schema={{ databaseId: 'db', name: 'Projects', tables: [] }}
          capabilities={{
            generate,
            read: vi.fn<QueryCapabilities['read']>(() => okAsync(answer)),
          }}
          onSave={save}
        />
      </PlainAnswerDisplay>
    ));
    const prompt = result.getByLabelText('Ask your database');
    fireEvent.input(prompt, { target: { value: 'How many projects?' } });
    fireEvent.keyDown(prompt, { key: 'Enter' });
    await result.findByRole('button', { name: 'Insert' });
    expect(result.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(result.queryByRole('button', { name: 'Ask' })).toBeNull();
    expect(save).not.toHaveBeenCalled();

    fireEvent.keyDown(prompt, { key: 'Enter' });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith({
      databaseId: 'db',
      sql: 'SELECT COUNT(*) AS Count FROM projects',
      prompt: 'How many projects?',
      title: undefined,
      displayMode: 'scalar',
    });
    result.unmount();
  });

  it('inserts with Enter pressed anywhere in the box, but not from its controls', async () => {
    const save = vi.fn();
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={{
            sql: 'SELECT COUNT(*) AS Count FROM projects',
            prompt: 'How many projects?',
            displayMode: 'scalar',
          }}
          schema={{ databaseId: 'db', name: 'Projects', tables: [] }}
          capabilities={{
            generate: vi.fn(),
            read: vi.fn<QueryCapabilities['read']>(() => okAsync(answer)),
          }}
          onSave={save}
          saveLabel="Save changes"
        />
      </PlainAnswerDisplay>
    ));
    await result.findByRole('button', { name: 'Save changes' });
    fireEvent.keyDown(result.getByRole('button', { name: 'SQL' }), {
      key: 'Enter',
    });
    expect(save).not.toHaveBeenCalled();
    fireEvent.keyDown(result.getByText('7'), { key: 'Enter' });
    expect(save).toHaveBeenCalledTimes(1);
    result.unmount();
  });

  it('returns to the prompt with Edit, then Enter on a changed prompt regenerates', async () => {
    const generate = vi
      .fn<QueryCapabilities['generate']>()
      .mockReturnValueOnce(
        okAsync({
          sql: 'SELECT COUNT(*) AS Count FROM projects',
          explanation: '',
        })
      )
      .mockReturnValueOnce(
        okAsync({
          sql: "SELECT COUNT(*) AS Count FROM projects WHERE stage = 'Done'",
          explanation: '',
        })
      );
    const save = vi.fn();
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={{ sql: '', prompt: '', displayMode: 'scalar' }}
          schema={{ databaseId: 'db', name: 'Projects', tables: [] }}
          capabilities={{
            generate,
            read: vi.fn<QueryCapabilities['read']>(() => okAsync(answer)),
          }}
          onSave={save}
        />
      </PlainAnswerDisplay>
    ));
    const prompt = result.getByLabelText(
      'Ask your database'
    ) as HTMLTextAreaElement;
    fireEvent.input(prompt, { target: { value: 'How many projects?' } });
    fireEvent.keyDown(prompt, { key: 'Enter' });
    await result.findByRole('button', { name: 'Insert' });

    const edit = result.getByRole('button', { name: 'Edit' });
    edit.focus();
    fireEvent.click(edit);
    expect(document.activeElement).toBe(prompt);
    expect(prompt.value).toBe('How many projects?');
    expect(prompt.selectionStart).toBe('How many projects?'.length);

    fireEvent.input(prompt, {
      target: { value: 'How many projects are done?' },
    });
    expect(result.queryByRole('button', { name: 'Insert' })).toBeNull();
    fireEvent.keyDown(prompt, { key: 'Enter' });
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect(generate).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: 'How many projects are done?' })
    );
    await result.findByRole('button', { name: 'Insert' });
    fireEvent.keyDown(prompt, { key: 'Enter' });
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prompt: 'How many projects are done?',
        sql: "SELECT COUNT(*) AS Count FROM projects WHERE stage = 'Done'",
      })
    );
    result.unmount();
  });
});

describe('question editor with SQL hidden', () => {
  it('asks and answers without a SQL toggle, editor or statement', async () => {
    const read = vi.fn<QueryCapabilities['read']>(() => okAsync(answer));
    const generate = vi.fn<QueryCapabilities['generate']>(() =>
      okAsync({
        sql: 'SELECT COUNT(*) AS Count FROM projects',
        explanation: 'Counts projects.',
      })
    );
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={{ sql: '', prompt: '', displayMode: 'scalar' }}
          schema={{ databaseId: 'db', name: 'Planning', tables: [] }}
          capabilities={{ read, generate }}
          onSave={vi.fn()}
        />
      </PlainAnswerDisplay>
    ));
    fireEvent.input(result.getByLabelText('Ask your database'), {
      target: { value: 'How many projects?' },
    });
    fireEvent.click(result.getByRole('button', { name: /Ask/ }));
    await result.findByRole('button', { name: 'Insert' });
    expect(read).toHaveBeenCalledWith(
      'SELECT COUNT(*) AS Count FROM projects',
      expect.objectContaining({ databaseId: 'db' })
    );
    expect(result.queryByRole('button', { name: 'SQL' })).toBeNull();
    expect(result.queryByLabelText('Query SQL')).toBeNull();
    expect(result.queryByRole('button', { name: 'Run SQL' })).toBeNull();
    expect(result.container.textContent).not.toMatch(/SQL|SELECT/);
    result.unmount();
  });

  it('words an engine refusal plainly and keeps the raw message out of view', async () => {
    const read = vi.fn<QueryCapabilities['read']>(() =>
      errAsync({
        kind: 'engine',
        error: {
          stage: 'resolve',
          kind: 'unknownColumn',
          name: 'Price',
          table: 'Shop.Items',
          suggestion: null,
        },
        message: 'unknown column "Price" in "Shop"."Items"',
      })
    );
    const result = render(() => (
      <PlainAnswerDisplay>
        <QueryEditor
          initial={{
            databaseId: 'db',
            prompt: 'Total price?',
            sql: 'SELECT SUM("Price") FROM "Items"',
            displayMode: 'scalar',
          }}
          schema={{ databaseId: 'db', name: 'Shop', tables: [] }}
          capabilities={{ read, generate: vi.fn() }}
        />
      </PlainAnswerDisplay>
    ));
    expect((await result.findByRole('alert')).textContent).toBe(
      "This answer couldn't be computed: the column Price no longer exists."
    );
    expect(result.queryByText('Technical details')).toBeNull();
    expect(result.container.textContent).not.toMatch(/SQL|SELECT|unknown/);
    result.unmount();
  });
});
