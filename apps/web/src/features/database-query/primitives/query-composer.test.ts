import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryComposerOptions } from '../context/query-context';
import type { QueryAnswer, QueryProposal, QuerySchema } from '../core/query';
import { createQueryComposer } from './query-composer';

const answer: QueryAnswer = {
  columns: [{ name: 'Count', kind: 'number' }],
  rows: [[{ type: 'number', value: 7 }]],
  rowIds: [],
  readTables: ['table'],
  readDatabaseIds: [],
  truncatedTables: [],
};
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});
function setup(overrides: Partial<QueryComposerOptions> = {}) {
  const generate = vi.fn<QueryComposerOptions['generate']>(() =>
    okAsync({
      sql: 'SELECT COUNT(*) FROM projects',
      explanation: 'Counts projects.',
    })
  );
  const read = vi.fn<QueryComposerOptions['read']>(() => okAsync(answer));
  const controller = createRoot((dispose) => {
    disposers.push(dispose);
    return createQueryComposer({
      initial: {
        sql: 'SELECT 1',
        prompt: 'First answer',
        displayMode: 'scalar',
      },
      schema: () => ({ databaseId: 'db', name: 'Projects', tables: [] }),
      showSql: false,
      generate,
      read,
      ...overrides,
    });
  });
  return { controller, generate, read };
}
describe('question composer', () => {
  it('keeps a generated title separate from the prompt through presentation changes and refresh', async () => {
    const { controller } = setup({
      generate: () =>
        okAsync({
          sql: 'SELECT 7',
          explanation: 'Counts tickets',
          title: 'Open tickets',
        }),
    });
    controller.setPrompt('Can you tell me how many open tickets there are?');
    await controller.generate();
    expect(controller.presentation().title).toBe('Open tickets');
    controller.setDisplayMode('table');
    await controller.run();
    expect(controller.presentation().title).toBe('Open tickets');
    expect(controller.prompt()).toBe(
      'Can you tell me how many open tickets there are?'
    );
  });
  it('restores the verified automatic source with its answer on Undo and refresh', async () => {
    const support = { databaseId: 'support', name: 'Support', tables: [] };
    const sales = { databaseId: 'sales', name: 'Sales', tables: [] };
    const generate = vi
      .fn<QueryComposerOptions['generate']>()
      .mockReturnValueOnce(
        okAsync({ sql: 'SELECT 7', explanation: '', source: support })
      )
      .mockReturnValueOnce(
        okAsync({ sql: 'SELECT 8', explanation: '', source: sales })
      );
    const { controller } = setup({
      schema: () => ({ name: 'Automatic', tables: [] }),
      generate,
      // As the production read does, the source it was asked with is verified and kept.
      read: (_sql, context) => okAsync({ ...answer, source: context?.source }),
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
    const generate = vi.fn<QueryComposerOptions['generate']>(() =>
      okAsync({
        sql: 'SELECT COUNT(*) FROM tickets',
        explanation: 'Counts tickets.',
        source,
      })
    );
    const read = vi
      .fn<QueryComposerOptions['read']>()
      .mockReturnValueOnce(
        errAsync({ kind: 'fetch', message: 'Temporary failure' })
      )
      .mockImplementation((_sql, context) =>
        okAsync({ ...answer, source: context?.source })
      );
    const { controller } = setup({
      schema: () => ({ name: 'Automatic', tables: [] }),
      generate,
      read,
    });
    controller.setPrompt('How many tickets?');
    await controller.generate();
    expect(controller.error()).toBe(
      'Your data could not be reached. Check your connection.'
    );
    expect(controller.errorDetail()).toBe('Temporary failure');
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
        ResultAsync.fromSafePromise(
          new Promise<QueryProposal>((resolve) => {
            finish = resolve;
          })
        ),
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
    const generate = vi.fn<QueryComposerOptions['generate']>(() =>
      ResultAsync.fromSafePromise(
        new Promise<QueryProposal>((resolve) => {
          finish = resolve;
        })
      )
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

  it('keeps chart presentation with the accepted answer through refresh and undo', async () => {
    const chart = { x: 'Status', y: ['Count'] };
    const generate = vi.fn<QueryComposerOptions['generate']>(() =>
      okAsync({
        sql: 'SELECT status AS Status, COUNT(*) AS Count FROM projects GROUP BY status',
        explanation: 'Counts each status.',
        displayMode: 'bar',
        chart,
      })
    );
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
    const generate = vi.fn<QueryComposerOptions['generate']>(() =>
      okAsync({
        sql: 'SELECT COUNT(*) FROM contacts',
        explanation: 'Counts contacts.',
      })
    );
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
        ResultAsync.fromSafePromise(
          new Promise<QueryProposal>((done) => {
            resolve = done;
          })
        ),
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
    let reading!: () => void;
    const readStarted = new Promise<void>((done) => {
      reading = done;
    });
    const { controller } = setup({
      schema: () => schema,
      read: () => {
        reading();
        return ResultAsync.fromSafePromise(
          new Promise<QueryAnswer>((done) => {
            resolve = done;
          })
        );
      },
    });
    const pending = controller.generate();
    await readStarted;
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
      .fn<QueryComposerOptions['generate']>()
      .mockReturnValueOnce(
        errAsync({ kind: 'generation', message: 'Temporary network failure' })
      )
      .mockReturnValue(
        okAsync({
          sql: 'SELECT COUNT(*) FROM projects',
          explanation: 'Counts projects.',
        })
      );
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
        ResultAsync.fromSafePromise(
          new Promise<QueryProposal>((done) => {
            resolve = done;
          })
        ),
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
      generate: () =>
        errAsync({
          kind: 'engine',
          error: {
            stage: 'resolve',
            kind: 'unknownColumn',
            name: 'retired',
            table: 'Items',
            suggestion: null,
          },
          message: 'unknown column "retired" in Items',
        }),
    });
    await controller.run();
    await controller.generate();
    expect(controller.preview()?.answer).toEqual(answer);
    expect(controller.error()).toBe(
      "This answer couldn't be computed: the column retired no longer exists."
    );
    expect(controller.errorDetail()).toBe('unknown column "retired" in Items');
  });
  it('ignores stale SQL responses', async () => {
    let resolve!: (answer: QueryAnswer) => void;
    const { controller } = setup({
      read: () =>
        ResultAsync.fromSafePromise(
          new Promise<QueryAnswer>((done) => {
            resolve = done;
          })
        ),
    });
    const pending = controller.run();
    controller.setSql('SELECT 2');
    resolve(answer);
    await pending;
    expect(controller.preview()).toBeUndefined();
  });
  it('does not overwrite edits made while an AI answer is being read', async () => {
    let resolve!: (answer: QueryAnswer) => void;
    let reading!: () => void;
    const readStarted = new Promise<void>((done) => {
      reading = done;
    });
    const { controller } = setup({
      read: () => {
        reading();
        return ResultAsync.fromSafePromise(
          new Promise<QueryAnswer>((done) => {
            resolve = done;
          })
        );
      },
    });
    controller.setPrompt('How many projects?');
    const pending = controller.generate();
    await readStarted;
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
      .fn<QueryComposerOptions['read']>()
      .mockReturnValueOnce(okAsync(answer))
      .mockReturnValueOnce(
        errAsync({ kind: 'fetch', message: 'Temporary network failure' })
      )
      .mockReturnValue(okAsync(answer));
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
