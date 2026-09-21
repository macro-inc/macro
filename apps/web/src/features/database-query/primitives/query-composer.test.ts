import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryComposerOptions } from '../context/query-context';
import {
  QueryActionError,
  type QueryAnswer,
  QueryOutcomeUnknownError,
  type QueryProposal,
  type QuerySchema,
} from '../core/query';
import { createQueryComposer } from './query-composer';

const answer: QueryAnswer = {
  results: [{ columns: [{ name: 'Count', entity_type: null }], rows: [[7]] }],
  read_tables: ['table'],
  read_versions: { table: 1 },
  truncated_tables: [],
};
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});
function setup(overrides: Partial<QueryComposerOptions> = {}) {
  const generate = vi.fn(async () => ({
    sql: 'SELECT COUNT(*) FROM projects',
    explanation: 'Counts projects.',
  }));
  const read = vi.fn(async () => answer);
  const controller = createRoot((dispose) => {
    disposers.push(dispose);
    return createQueryComposer({
      initial: {
        sql: 'SELECT 1',
        prompt: 'First answer',
        displayMode: 'scalar',
      },
      schema: () => ({ databaseId: 'db', name: 'Projects', tables: [] }),
      generate,
      read,
      ...overrides,
    });
  });
  return { controller, generate, read };
}
describe('question composer', () => {
  it('restores the verified automatic source with its answer on Undo and refresh', async () => {
    const support = { databaseId: 'support', name: 'Support', tables: [] };
    const sales = { databaseId: 'sales', name: 'Sales', tables: [] };
    const generate = vi
      .fn<QueryComposerOptions['generate']>()
      .mockResolvedValueOnce({
        sql: 'SELECT 7',
        explanation: '',
        source: support,
      })
      .mockResolvedValueOnce({
        sql: 'SELECT 8',
        explanation: '',
        source: sales,
      });
    const { controller } = setup({
      schema: () => ({ name: 'Automatic', tables: [] }),
      generate,
    });
    controller.setPrompt('Count tickets');
    await controller.generate();
    controller.setPrompt('Count deals');
    await controller.generate();
    expect(controller.schema().databaseId).toBe('sales');
    controller.undoChanges();
    expect(controller.schema().databaseId).toBe('support');
    expect(controller.answerDatabaseId()).toBe('support');
    await controller.run();
    expect(controller.answerDatabaseId()).toBe('support');
  });

  it('keeps automatic discovery independent of the resolved answer source and preserves that source on read retry', async () => {
    const source = { databaseId: 'support', name: 'Support', tables: [] };
    const generate = vi.fn<QueryComposerOptions['generate']>(async () => ({
      sql: 'SELECT COUNT(*) FROM tickets',
      explanation: 'Counts tickets.',
      source,
    }));
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValue(answer);
    const { controller } = setup({
      schema: () => ({ name: 'Automatic', tables: [] }),
      generate,
      read,
    });
    controller.setPrompt('How many tickets?');
    await controller.generate();
    expect(controller.error()).toBe('Temporary failure');
    expect(controller.schema()).toEqual(source);
    await controller.refreshAnswer();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(controller.answerDatabaseId()).toBe('support');
    expect(controller.isCurrentPreview()).toBe(true);
    controller.setPrompt('How many projects?');
    await controller.generate();
    expect(generate.mock.calls.at(-1)?.[0].schema.databaseId).toBeUndefined();
    expect(generate.mock.calls.at(-1)?.[0].schema.name).toBe('Automatic');
  });

  it('retains the question but discards automatic resolution when an explicit database is selected in flight', async () => {
    const [schema, setSchema] = createSignal<QuerySchema>({
      name: 'Automatic',
      tables: [],
    });
    let finish!: (proposal: QueryProposal) => void;
    const { controller, read } = setup({
      schema,
      generate: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    controller.setPrompt('How many tickets?');
    const pending = controller.generate();
    setSchema({ databaseId: 'chosen', name: 'Chosen database', tables: [] });
    finish({
      sql: 'SELECT COUNT(*) FROM tickets',
      explanation: 'Tickets.',
      source: {
        databaseId: 'automatic-result',
        name: 'Other database',
        tables: [],
      },
    });
    await pending;
    expect(controller.prompt()).toBe('How many tickets?');
    expect(controller.schema().databaseId).toBe('chosen');
    expect(controller.preview()).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });
  it('keeps an in-flight generation exclusive even if its draft is edited', async () => {
    let finish!: (proposal: QueryProposal) => void;
    const generate = vi.fn(
      () =>
        new Promise<QueryProposal>((resolve) => {
          finish = resolve;
        })
    );
    const { controller, read } = setup({ generate });
    const pending = controller.generate();
    controller.setPrompt('A different request');
    expect(controller.phase()).toBe('generating');
    expect(controller.generationPending()).toBe(true);
    await controller.generate();
    await controller.run();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    finish({ sql: 'SELECT 9', explanation: 'Earlier answer.' });
    await pending;
    expect(controller.phase()).toBe('idle');
    expect(controller.generationPending()).toBe(false);
    expect(controller.prompt()).toBe('A different request');
    expect(controller.preview()).toBeUndefined();
  });

  it('keeps an unknown mutation outcome distinct from confirmed changes and prevents unchanged retry', async () => {
    const generate = vi.fn(async () => {
      throw new QueryOutcomeUnknownError(
        'The connection was interrupted. Check the table before continuing.'
      );
    });
    const { controller, read } = setup({ generationCanWrite: true, generate });
    controller.setPrompt('Add three sample records');
    await controller.generate();
    expect(controller.outcomeUnknown()).toBe(true);
    expect(controller.actionSummary()).toBeUndefined();
    expect(controller.actionNeedsRevision()).toBe(false);
    expect(controller.canUndo()).toBe(false);
    await controller.generate();
    await controller.refreshAnswer();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    controller.setPrompt('Check whether the sample records were added');
    expect(controller.outcomeUnknown()).toBe(false);
  });

  it.each(['confirmed', 'unknown'] as const)(
    'retains a %s write outcome after the user switches tables',
    async (outcome) => {
      let complete!: (proposal: QueryProposal) => void;
      let fail!: (error: Error) => void;
      const generate = vi.fn(
        () =>
          new Promise<QueryProposal>((resolve, reject) => {
            complete = resolve;
            fail = reject;
          })
      );
      const { controller, read } = setup({
        generationCanWrite: true,
        schema: () => schema,
        generate,
      });
      const pending = controller.generate();
      controller.selectTable('contacts');
      if (outcome === 'confirmed')
        complete({
          sql: 'SELECT COUNT(*) FROM projects',
          explanation: 'Records created.',
          actionSummary: 'Created three projects.',
        });
      else
        fail(
          new QueryOutcomeUnknownError(
            'The connection was interrupted. Check the table.'
          )
        );
      await pending;
      expect(read).not.toHaveBeenCalled();
      expect(controller.preview()).toBeUndefined();
      expect(controller.tableId()).toBe('contacts');
      expect(controller.phase()).toBe('idle');
      if (outcome === 'confirmed') {
        expect(controller.actionSummary()).toBe('Created three projects.');
        expect(controller.actionNeedsRevision()).toBe(true);
      } else {
        expect(controller.outcomeUnknown()).toBe(true);
        expect(controller.error()).toContain('interrupted');
      }
    }
  );

  it('preserves a partial action ledger and prevents repeating unchanged writes after generation fails', async () => {
    const generate = vi
      .fn()
      .mockRejectedValue(
        new QueryActionError(
          'Created a Projects table.',
          'Could not finish adding the sample records.'
        )
      );
    const { controller, read } = setup({ generate });
    controller.setPrompt('Create projects and sample records');
    await controller.generate();
    expect(controller.actionSummary()).toBe('Created a Projects table.');
    expect(controller.actionNeedsRevision()).toBe(true);
    expect(controller.canUndo()).toBe(false);
    await controller.generate();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    controller.setPrompt('Add sample records to the existing Projects table');
    expect(controller.actionNeedsRevision()).toBe(false);
  });
  it('keeps chart presentation with the accepted answer through refresh and undo', async () => {
    const chart = { x: 'Status', y: ['Count'] };
    const generate = vi.fn(async () => ({
      sql: 'SELECT status AS Status, COUNT(*) AS Count FROM projects GROUP BY status',
      explanation: 'Counts each status.',
      displayMode: 'bar' as const,
      chart,
    }));
    const { controller } = setup({ generate });
    await controller.run();
    controller.setDisplayMode('table');
    controller.setPrompt('Chart tasks by status');
    await controller.generate();
    expect(controller.presentation()).toEqual({ displayMode: 'bar', chart });
    expect(controller.preview()?.presentation).toEqual({
      displayMode: 'bar',
      chart,
    });
    await controller.run();
    expect(controller.presentation()).toEqual({ displayMode: 'bar', chart });
    controller.undoChanges();
    expect(controller.presentation().displayMode).toBe('table');
    expect(controller.sql()).toBe('SELECT 1');
  });
  it('shows verified completed actions without offering a misleading data Undo', async () => {
    const { controller } = setup({
      generate: async () => ({
        sql: 'SELECT COUNT(*) FROM projects',
        explanation: 'Shows the created records.',
        actionSummary: 'Created three projects.',
      }),
    });
    await controller.run();
    controller.setPrompt('Add three projects');
    await controller.generate();
    expect(controller.preview()?.actionSummary).toBe('Created three projects.');
    expect(controller.canUndo()).toBe(false);
  });
  it('keeps completed writes visible when their verification query fails, and retries only the read', async () => {
    const generate = vi.fn(async () => ({
      sql: 'SELECT COUNT(*) FROM projects',
      explanation: 'Verifies the result.',
      actionSummary: 'Created three projects.',
    }));
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('Query timed out'))
      .mockResolvedValueOnce(answer);
    const { controller } = setup({ generate, read });
    controller.setPrompt('Add three projects');
    await controller.generate();
    expect(controller.error()).toBeTruthy();
    expect(controller.actionSummary()).toBe('Created three projects.');
    expect(controller.preview()).toBeUndefined();
    await controller.refreshAnswer();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(controller.actionSummary()).toBe('Created three projects.');
  });
  const schema: QuerySchema = {
    databaseId: 'db',
    name: 'Planning',
    focusTableId: 'projects',
    tables: [
      { id: 'projects', name: 'Projects', sqlName: 'projects', columns: [] },
      { id: 'contacts', name: 'Contacts', sqlName: 'contacts', columns: [] },
    ],
  };
  it('requires a fresh answer after changing tables and restores the previous table on undo', async () => {
    const generate = vi.fn(async () => ({
      sql: 'SELECT COUNT(*) FROM contacts',
      explanation: 'Counts contacts.',
    }));
    const { controller, read } = setup({ schema: () => schema, generate });
    await controller.run();
    controller.selectTable('contacts');
    expect(controller.prompt()).toBe('First answer');
    expect(controller.sql()).toBe('SELECT 1');
    expect(controller.isCurrentPreview()).toBe(false);
    expect(controller.needsGeneration()).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    await controller.refreshAnswer();
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: expect.objectContaining({ focusTableId: 'contacts' }),
      })
    );
    expect(read).toHaveBeenLastCalledWith(
      'SELECT COUNT(*) FROM contacts',
      expect.objectContaining({ databaseId: 'db' })
    );
    expect(controller.isCurrentPreview()).toBe(true);
    controller.undoChanges();
    expect(controller.tableId()).toBe('projects');
    expect(controller.sql()).toBe('SELECT 1');
    expect(controller.isCurrentPreview()).toBe(true);
  });
  it('discards generation from the previous table after selection changes', async () => {
    let resolve!: (proposal: QueryProposal) => void;
    const { controller, read } = setup({
      schema: () => schema,
      generate: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const pending = controller.generate();
    controller.selectTable('contacts');
    resolve({
      sql: 'SELECT COUNT(*) FROM projects',
      explanation: 'Counts projects.',
    });
    await pending;
    expect(read).not.toHaveBeenCalled();
    expect(controller.sql()).toBe('SELECT 1');
    expect(controller.needsGeneration()).toBe(true);
    expect(controller.phase()).toBe('idle');
  });
  it('discards an in-flight read from the previous table after selection changes', async () => {
    let resolve!: (answer: QueryAnswer) => void;
    const { controller } = setup({
      schema: () => schema,
      read: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const pending = controller.generate();
    await Promise.resolve();
    expect(controller.phase()).toBe('running');
    controller.selectTable('contacts');
    resolve(answer);
    await pending;
    expect(controller.preview()).toBeUndefined();
    expect(controller.needsGeneration()).toBe(true);
    expect(controller.phase()).toBe('idle');
  });
  it('allows an explicit SQL run to accept the draft after a table change', async () => {
    const { controller, generate, read } = setup({ schema: () => schema });
    controller.selectTable('contacts');
    await controller.run();
    expect(generate).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledWith(
      'SELECT 1',
      expect.objectContaining({ databaseId: 'db' })
    );
    expect(controller.isCurrentPreview()).toBe(true);
    expect(controller.needsGeneration()).toBe(false);
  });
  it('answers in one action through the read-only preview capability', async () => {
    const { controller, read } = setup();
    controller.setPrompt('How many projects?');
    await controller.generate();
    expect(read).toHaveBeenCalledWith(
      'SELECT COUNT(*) FROM projects',
      expect.objectContaining({ databaseId: 'db' })
    );
    expect(controller.preview()?.explanation).toBe('Counts projects.');
    expect(controller.isCurrentPreview()).toBe(true);
  });
  it('does not relabel an old answer when the prompt changes', async () => {
    const { controller } = setup();
    await controller.run();
    expect(controller.isCurrentPreview()).toBe(true);
    controller.setPrompt('Different question');
    expect(controller.isCurrentPreview()).toBe(false);
    expect(controller.preview()?.prompt).toBe('First answer');
  });
  it('regenerates a changed question, then refreshes its SQL without generating again', async () => {
    const { controller, generate, read } = setup();
    await controller.run();
    controller.setPrompt('How many projects?');
    expect(controller.questionChanged()).toBe(true);
    await controller.refreshAnswer();
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'How many projects?' })
    );
    expect(read).toHaveBeenNthCalledWith(
      1,
      'SELECT 1',
      expect.objectContaining({ databaseId: 'db' })
    );
    expect(read).toHaveBeenNthCalledWith(
      2,
      'SELECT COUNT(*) FROM projects',
      expect.objectContaining({ databaseId: 'db' })
    );
    expect(controller.isCurrentPreview()).toBe(true);
    expect(controller.questionChanged()).toBe(false);
    await controller.refreshAnswer();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenLastCalledWith(
      'SELECT COUNT(*) FROM projects',
      expect.objectContaining({ databaseId: 'db' })
    );
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('retries generation after failure instead of pairing the new question with old SQL', async () => {
    const generate = vi
      .fn<() => Promise<QueryProposal>>()
      .mockRejectedValueOnce(new Error('Temporary network failure'))
      .mockResolvedValue({
        sql: 'SELECT COUNT(*) FROM projects',
        explanation: 'Counts projects.',
      });
    const { controller, read } = setup({ generate });
    await controller.run();
    controller.setPrompt('How many projects?');
    await controller.refreshAnswer();
    expect(controller.isCurrentPreview()).toBe(false);
    expect(controller.questionChanged()).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    await controller.refreshAnswer();
    expect(generate).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenLastCalledWith(
      'SELECT COUNT(*) FROM projects',
      expect.objectContaining({ databaseId: 'db' })
    );
    expect(controller.isCurrentPreview()).toBe(true);
  });
  it('undo restores previous SQL, answer and prompt', async () => {
    const { controller } = setup();
    await controller.run();
    controller.setPrompt('How many projects?');
    await controller.generate();
    controller.undoChanges();
    expect(controller.sql()).toBe('SELECT 1');
    expect(controller.prompt()).toBe('First answer');
    expect(controller.isCurrentPreview()).toBe(true);
  });
  it('ignores late generation after editing the question', async () => {
    let resolve!: (proposal: QueryProposal) => void;
    const { controller, read } = setup({
      generate: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const pending = controller.generate();
    controller.setPrompt('New question');
    resolve({ sql: 'SELECT 999', explanation: 'Old answer.' });
    await pending;
    expect(read).not.toHaveBeenCalled();
    expect(controller.sql()).toBe('SELECT 1');
    expect(controller.preview()).toBeUndefined();
    expect(controller.phase()).toBe('idle');
  });
  it('retains previous answer on failure and exposes original error', async () => {
    const { controller } = setup({
      generate: async () => {
        throw new Error('no such column: retired');
      },
    });
    await controller.run();
    await controller.generate();
    expect(controller.preview()?.answer).toEqual(answer);
    expect(controller.error()).toContain('property');
    expect(controller.errorDetail()).toBe('no such column: retired');
  });
  it('ignores stale SQL responses', async () => {
    let resolve!: (answer: QueryAnswer) => void;
    const { controller } = setup({
      read: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const pending = controller.run();
    controller.setSql('SELECT 2');
    resolve(answer);
    await pending;
    expect(controller.preview()).toBeUndefined();
  });
  it('does not overwrite edits made while an AI answer is being read', async () => {
    let resolve!: (answer: QueryAnswer) => void;
    const { controller } = setup({
      read: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    controller.setPrompt('How many projects?');
    const pending = controller.generate();
    await Promise.resolve();
    expect(controller.phase()).toBe('running');
    controller.setSql('SELECT 2');
    controller.setPrompt('My edited question');
    resolve(answer);
    await pending;
    expect(controller.sql()).toBe('SELECT 2');
    expect(controller.prompt()).toBe('My edited question');
    expect(controller.preview()).toBeUndefined();
    expect(controller.phase()).toBe('idle');
  });
  it('keeps the previous answer after an AI preview read fails and allows a retry', async () => {
    const read = vi
      .fn<() => Promise<QueryAnswer>>()
      .mockResolvedValueOnce(answer)
      .mockRejectedValueOnce(new Error('Temporary network failure'))
      .mockResolvedValue(answer);
    const { controller, generate } = setup({ read });
    await controller.run();
    controller.setPrompt('How many projects?');
    await controller.generate();
    expect(controller.preview()?.sql).toBe('SELECT 1');
    expect(controller.preview()?.answer).toEqual(answer);
    expect(controller.sql()).toBe('SELECT COUNT(*) FROM projects');
    expect(controller.isCurrentPreview()).toBe(false);
    expect(controller.errorDetail()).toBe('Temporary network failure');
    expect(controller.canUndo()).toBe(true);
    await controller.refreshAnswer();
    expect(controller.isCurrentPreview()).toBe(true);
    expect(controller.preview()?.prompt).toBe('How many projects?');
    expect(controller.error()).toBeUndefined();
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('does not send visible writes to read endpoint', async () => {
    const { controller, read } = setup();
    controller.setSql('DELETE FROM projects');
    await controller.run();
    expect(read).not.toHaveBeenCalled();
    expect(controller.error()).toContain('only read');
  });
});
