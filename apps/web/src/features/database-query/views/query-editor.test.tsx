import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import {
  QueryActionError,
  type QueryAnswer,
  type QueryDefinition,
  QueryOutcomeUnknownError,
  type QueryProposal,
  type QuerySchema,
} from '../core/query';
import { QueryEditor } from './query-editor';

vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 346, height: 300 }),
}));

const answer: QueryAnswer = {
  results: [{ columns: [{ name: 'Count', entity_type: null }], rows: [[7]] }],
  read_tables: ['projects'],
  read_versions: { projects: 1 },
  truncated_tables: [],
};

describe('question editor', () => {
  it('keeps the source trigger mounted while its reactive source label changes', () => {
    const [schema, setSchema] = createSignal<QuerySchema>({
      name: 'Automatic',
      tables: [],
    });
    const result = render(() => (
      <QueryEditor
        initial={{ sql: '', prompt: '', displayMode: 'scalar' }}
        schema={schema()}
        capabilities={{ generate: vi.fn(), read: vi.fn() }}
        sourcePicker={(source) => (
          <button type="button">{source().name}</button>
        )}
      />
    ));
    const trigger = result.getByRole('button', { name: 'Automatic' });
    trigger.focus();
    setSchema({ databaseId: 'support', name: 'Support', tables: [] });
    expect(result.getByRole('button', { name: 'Support' })).toBe(trigger);
    expect(document.activeElement).toBe(trigger);
    result.unmount();
  });

  it('keeps the prompt and SQL read-only until a write-capable generation finishes', async () => {
    let finish!: (proposal: QueryProposal) => void;
    const generate = vi.fn(
      () =>
        new Promise<QueryProposal>((resolve) => {
          finish = resolve;
        })
    );
    const result = render(() => (
      <QueryEditor
        initial={{
          sql: '',
          prompt: 'Create sample records',
          displayMode: 'scalar',
        }}
        schema={{ databaseId: 'db', name: 'Planning', tables: [] }}
        capabilities={{
          generationCanWrite: true,
          generate,
          read: vi.fn(async () => answer),
        }}
      />
    ));
    fireEvent.click(result.getByRole('button', { name: 'SQL' }));
    const prompt = result.getByLabelText(
      'Ask your database'
    ) as HTMLTextAreaElement;
    const sql = result.getByLabelText('Query SQL');
    fireEvent.click(result.getByRole('button', { name: 'Ask' }));
    expect(prompt.readOnly).toBe(true);
    expect(sql.getAttribute('contenteditable')).toBe('false');
    fireEvent.keyDown(prompt, { key: 'Enter' });
    expect(generate).toHaveBeenCalledTimes(1);
    finish({
      sql: 'SELECT 7',
      explanation: 'Created records.',
      actionSummary: 'Created three records.',
    });
    await result.findByText('Created three records.');
    await waitFor(() => expect(prompt.readOnly).toBe(false));
    expect(sql.getAttribute('contenteditable')).toBe('true');
    result.unmount();
  });

  it('does not claim saved changes or repeat an unchanged request after a lost response', async () => {
    const generate = vi.fn(async () => {
      throw new QueryOutcomeUnknownError(
        'The connection was interrupted. Some changes may have been saved.'
      );
    });
    const result = render(() => (
      <QueryEditor
        initial={{
          sql: '',
          prompt: 'Add three records',
          displayMode: 'scalar',
        }}
        schema={{ databaseId: 'db', name: 'Planning', tables: [] }}
        capabilities={{
          generationCanWrite: true,
          generate,
          read: vi.fn(async () => answer),
        }}
      />
    ));
    fireEvent.click(result.getByRole('button', { name: 'Ask' }));
    await result.findByText(
      'Check the table, then edit your request to continue.'
    );
    expect(
      result.queryByText(
        'These changes are saved. Edit your request before continuing.'
      )
    ).toBeNull();
    expect(
      (result.getByRole('button', { name: 'Ask' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    fireEvent.keyDown(result.getByLabelText('Ask your database'), {
      key: 'Enter',
    });
    expect(generate).toHaveBeenCalledTimes(1);
    result.unmount();
  });

  it('offers valid chart choices after result aliases change and replaces stale mappings on explicit selection', async () => {
    const chartAnswer = {
      ...answer,
      results: [
        {
          columns: [
            { name: 'Stage', entity_type: null },
            { name: 'Total', entity_type: null },
          ],
          rows: [
            ['Active', 4],
            ['Done', 2],
          ],
        },
      ],
    };
    const save = vi.fn();
    const result = render(() => (
      <QueryEditor
        initial={{
          sql: 'SELECT stage AS Stage, COUNT(*) AS Total FROM projects GROUP BY stage',
          prompt: 'Chart tasks',
          displayMode: 'bar',
          chart: { x: 'Status', y: ['Count'] },
        }}
        schema={{ databaseId: 'db', name: 'Projects', tables: [] }}
        capabilities={{ generate: vi.fn(), read: async () => chartAnswer }}
        onSave={save}
      />
    ));
    await result.findByText(/This chart’s columns are unavailable/);
    expect(result.getByRole('table')).toBeTruthy();
    fireEvent.change(result.getByLabelText('Display answer as'), {
      target: { value: 'line' },
    });
    expect(
      result.getByRole('img', { name: 'Total by Stage. Line chart.' })
    ).toBeTruthy();
    fireEvent.click(result.getByRole('button', { name: 'Insert answer' }));
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        displayMode: 'line',
        chart: { x: 'Stage', y: ['Total'] },
      }),
      chartAnswer
    );
    result.unmount();
  });
  it('shows completed partial actions and prevents repeating them until the request is edited', async () => {
    const generate = vi.fn(async () => {
      throw new QueryActionError(
        'Created a Tasks table.',
        'Could not finish adding records.'
      );
    });
    const result = render(() => (
      <QueryEditor
        initial={{ sql: '', prompt: '', displayMode: 'scalar' }}
        schema={{ databaseId: 'db', name: 'Planning', tables: [] }}
        capabilities={{ generate, read: vi.fn(async () => answer) }}
      />
    ));
    const prompt = result.getByLabelText('Ask your database');
    fireEvent.input(prompt, {
      target: { value: 'Create Tasks and sample records' },
    });
    fireEvent.click(result.getByRole('button', { name: 'Ask' }));
    await result.findByText('Created a Tasks table.');
    expect(
      (result.getByRole('button', { name: 'Ask' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    fireEvent.keyDown(prompt, { key: 'Enter' });
    expect(generate).toHaveBeenCalledTimes(1);
    fireEvent.input(prompt, {
      target: { value: 'Add records to the existing Tasks table' },
    });
    expect(
      (result.getByRole('button', { name: 'Ask' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    result.unmount();
  });
  it('renders the suggested chart and saves its settings, including manual display changes', async () => {
    const chart = { x: 'Status', y: ['Count'], title: 'Tasks by status' };
    const chartAnswer = {
      ...answer,
      results: [
        {
          columns: [
            { name: 'Status', entity_type: null },
            { name: 'Count', entity_type: null },
          ],
          rows: [
            ['Todo', 3],
            ['Done', 2],
          ],
        },
      ],
    };
    const save = vi.fn();
    const result = render(() => (
      <QueryEditor
        initial={{ sql: '', prompt: '', displayMode: 'scalar' }}
        schema={{ databaseId: 'db', name: 'Projects', tables: [] }}
        capabilities={{
          generate: async () => ({
            sql: 'SELECT status AS Status, COUNT(*) AS Count FROM projects GROUP BY status',
            explanation: 'Counts tasks in each status.',
            displayMode: 'bar',
            chart,
          }),
          read: async () => chartAnswer,
        }}
        onSave={save}
      />
    ));
    fireEvent.input(result.getByLabelText('Ask your database'), {
      target: { value: 'Chart tasks by status' },
    });
    fireEvent.click(result.getByRole('button', { name: 'Ask' }));
    await result.findByRole('img', { name: 'Tasks by status. Bar chart.' });
    expect(
      (result.getByLabelText('Display answer as') as HTMLSelectElement).value
    ).toBe('bar');
    fireEvent.click(result.getByRole('button', { name: 'Insert answer' }));
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ displayMode: 'bar', chart }),
      chartAnswer
    );
    fireEvent.change(result.getByLabelText('Display answer as'), {
      target: { value: 'line' },
    });
    expect(
      result.getByRole('img', { name: 'Tasks by status. Line chart.' })
    ).toBeTruthy();
    fireEvent.click(result.getByRole('button', { name: 'Insert answer' }));
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ displayMode: 'line', chart }),
      chartAnswer
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
          generate: vi.fn(async () => ({ sql: 'SELECT 7', explanation: '' })),
          read: vi.fn(async () => answer),
        }}
      />
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
    const generate = vi.fn(async () => ({ sql: 'SELECT 7', explanation: '' }));
    const read = vi.fn(async () => answer);
    const result = render(() => (
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
        sqlName: '_macro_table_tickets',
        columns: [],
      },
      {
        id: 'customers',
        name: 'Customers',
        sqlName: '_macro_table_customers',
        columns: [],
      },
    ];
    const source: QuerySchema = {
      databaseId: 'support',
      name: 'Support',
      tables,
    };
    const generate = vi.fn(async () => ({
      sql: 'SELECT COUNT(*) FROM "_macro_table_tickets"',
      explanation: 'Counts tickets.',
      source,
    }));
    const save = vi.fn();
    const result = render(() => (
      <QueryEditor
        autoFocus
        initial={{ sql: '', prompt: '', displayMode: 'scalar' }}
        schema={{ name: 'Automatic', tables: [] }}
        sourcePicker={(schema) => (
          <button type="button">{schema().name}</button>
        )}
        capabilities={{ generate, read: async () => answer }}
        onSave={save}
      />
    ));
    const prompt = result.getByLabelText('Ask your database');
    expect(document.activeElement).toBe(prompt);
    expect(result.getByRole('button', { name: 'Automatic' })).toBeTruthy();
    expect(result.queryByLabelText('Question table')).toBeNull();
    fireEvent.input(prompt, { target: { value: 'How many tickets?' } });
    fireEvent.keyDown(prompt, { key: 'Enter' });
    await result.findByText('7');
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: expect.objectContaining({ name: 'Automatic', tables: [] }),
      })
    );
    expect(result.getByRole('button', { name: 'Support' })).toBeTruthy();
    fireEvent.click(result.getByRole('button', { name: 'Insert answer' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ databaseId: 'support' }),
      answer
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
    const generate = vi.fn(async () => ({
      sql: 'SELECT 7',
      explanation: 'Counts records.',
    }));
    const save = vi.fn();
    const result = render(() => (
      <QueryEditor
        initial={{
          databaseId: 'support',
          sql: 'SELECT 7',
          prompt: 'How many records?',
          displayMode: 'scalar',
        }}
        schema={schema()}
        capabilities={{ generate, read: async () => answer }}
        onSave={save}
      />
    ));
    await result.findByRole('button', { name: 'Insert answer' });
    const prompt = result.getByLabelText(
      'Ask your database'
    ) as HTMLTextAreaElement;
    setSchema({ databaseId: 'sales', name: 'Sales', tables: [] });
    expect(prompt.value).toBe('How many records?');
    expect(result.queryByRole('button', { name: 'Insert answer' })).toBeNull();
    fireEvent.keyDown(prompt, { key: 'Enter' });
    await result.findByRole('button', { name: 'Insert answer' });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: expect.objectContaining({ databaseId: 'sales' }),
      })
    );
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(result.getByRole('button', { name: 'Insert answer' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ databaseId: 'sales' }),
      answer
    );
    result.unmount();
  });

  it('updates a changed question before allowing its answer to be saved', async () => {
    const generate = vi.fn(async () => ({
      sql: 'SELECT COUNT(*) FROM projects WHERE approved = 1',
      explanation: 'Counts approved projects.',
    }));
    const read = vi.fn(async () => answer);
    const save = vi.fn();
    const result = render(() => (
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
      }),
      answer
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
    const generate = vi.fn(async () => ({
      sql: 'SELECT COUNT(*) FROM projects',
      explanation: 'Counts every project in the table.',
    }));
    const read = vi.fn(async () => answer);
    const save = vi.fn();
    const result = render(() => (
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
    ));
    fireEvent.input(result.getByLabelText('Ask your database'), {
      target: { value: 'How many projects?' },
    });
    fireEvent.click(result.getByRole('button', { name: 'Ask' }));
    await result.findByText('7');
    expect(read).toHaveBeenCalledWith(
      'SELECT COUNT(*) FROM projects',
      expect.objectContaining({ databaseId: 'db' })
    );
    expect(save).not.toHaveBeenCalled();
    expect(initial.sql).toBe('SELECT 1');
    expect(result.queryByLabelText('Query SQL')).toBeNull();
    expect(
      result.getByText('How this was calculated').closest('details')?.open
    ).toBe(false);
    fireEvent.click(result.getByRole('button', { name: 'Save live answer' }));
    expect(save).toHaveBeenCalledWith(
      {
        databaseId: 'db',
        tableId: 'projects',
        prompt: 'How many projects?',
        sql: 'SELECT COUNT(*) FROM projects',
        displayMode: 'scalar',
      },
      answer
    );
    result.unmount();
  });

  it('previews saved SQL automatically and reuses it for an unchanged question', async () => {
    const read = vi.fn(async () => answer);
    const generate = vi.fn();
    const save = vi.fn();
    const result = render(() => (
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
    ));
    await result.findByRole('button', { name: 'Insert answer' });
    expect(read).toHaveBeenCalledExactlyOnceWith(
      'SELECT COUNT(*) FROM projects',
      expect.objectContaining({ databaseId: 'db' })
    );
    expect(result.queryByRole('button', { name: 'Show answer' })).toBeNull();
    expect(result.queryByRole('button', { name: 'Run SQL' })).toBeNull();
    fireEvent.click(result.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await result.findByRole('button', { name: 'Insert answer' });
    expect(read).toHaveBeenLastCalledWith(
      'SELECT COUNT(*) FROM projects',
      expect.objectContaining({ databaseId: 'db' })
    );
    expect(generate).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    result.unmount();
  });

  it('runs manual saved SQL with no prompt and exposes Run SQL only in the editor', async () => {
    const read = vi.fn(async () => answer);
    const generate = vi.fn();
    const result = render(() => (
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
      .fn<() => Promise<QueryAnswer>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSaved = resolve;
          })
      )
      .mockResolvedValue(answer);
    const generate = vi.fn(async () => ({
      sql: 'SELECT 7',
      explanation: 'New answer.',
    }));
    const save = vi.fn();
    const result = render(() => (
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
    ));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    fireEvent.input(result.getByLabelText('Ask your database'), {
      target: { value: 'New question' },
    });
    fireEvent.click(result.getByRole('button', { name: 'Ask' }));
    await result.findByText('7');
    resolveSaved({
      ...answer,
      results: [{ ...answer.results[0], rows: [[999]] }],
    });
    await Promise.resolve();
    expect(result.queryByText('999')).toBeNull();
    fireEvent.click(result.getByRole('button', { name: 'Insert answer' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'New question', sql: 'SELECT 7' }),
      answer
    );
    result.unmount();
  });

  it('keeps the optional source picker available while a selected database is unavailable', () => {
    const generate = vi.fn();
    const result = render(() => (
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
      results: [{ ...answer.results[0], rows: [[7], [8]] }],
    };
    const save = vi.fn();
    const result = render(() => (
      <QueryEditor
        initial={{
          databaseId: 'db',
          prompt: 'List projects',
          sql: '',
          displayMode: 'scalar',
        }}
        schema={{ databaseId: 'db', name: 'Planning', tables: [] }}
        capabilities={{
          read: async () => tableAnswer,
          generate: async () => ({
            sql: 'SELECT count FROM projects',
            explanation: '',
          }),
        }}
        onSave={save}
      />
    ));
    fireEvent.click(result.getByRole('button', { name: 'Ask' }));
    await result.findByRole('button', { name: 'Insert answer' });
    expect(result.queryByLabelText('Display answer as')).toBeNull();
    fireEvent.click(result.getByRole('button', { name: 'Insert answer' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ displayMode: 'table' }),
      tableAnswer
    );
    result.unmount();
  });

  it('preserves a scalar display override across refresh and explicit save', async () => {
    const save = vi.fn();
    const read = vi.fn(async () => answer);
    const result = render(() => (
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
    ));
    const format = (await result.findByRole('combobox', {
      name: 'Display answer as',
    })) as HTMLSelectElement;
    expect(format.value).toBe('table');
    expect(format.selectedOptions[0]?.label).toBe('Result table');
    fireEvent.click(result.getByRole('button', { name: 'Refresh answer' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await result.findByRole('button', { name: 'Insert answer' });
    const refreshedFormat = result.getByRole('combobox', {
      name: 'Display answer as',
    }) as HTMLSelectElement;
    expect(refreshedFormat.value).toBe('table');
    expect(refreshedFormat.selectedOptions[0]?.label).toBe('Result table');
    fireEvent.click(result.getByRole('button', { name: 'Insert answer' }));
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ displayMode: 'table' }),
      answer
    );
    fireEvent.change(refreshedFormat, { target: { value: 'scalar' } });
    expect(refreshedFormat.value).toBe('scalar');
    expect(refreshedFormat.selectedOptions[0]?.label).toBe('Inline answer');
    fireEvent.click(result.getByRole('button', { name: 'Insert answer' }));
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ displayMode: 'scalar' }),
      answer
    );
    result.unmount();
  });
});
