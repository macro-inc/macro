import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FormColumnWrites,
  FormWriteFailure,
} from '../context/form-context';
import type { FormColumn, FormDetail, FormLayout } from '../core/form-model';
import { QUESTION_TYPE_CHOICES } from '../core/question-types';
import { createBuilder } from './create-builder';

const NAME_COLUMN = 'column-name';

const startingLayout: FormLayout = {
  sections: [
    {
      id: 'about',
      title: '',
      description: '',
      kind: 'questions',
      gateRules: null,
      gateMessage: '',
      questions: [
        {
          id: 'q-name',
          columnId: NAME_COLUMN,
          helpText: '',
          required: true,
          widget: 'short',
        },
      ],
    },
  ],
};

function detail(layout: FormLayout): FormDetail {
  return {
    form: {
      id: 'form-1',
      name: 'Offsite RSVP',
      description: '',
      ownerId: 'macro|owner@example.com',
      databaseId: 'database-1',
      tableId: 'table-1',
      audience: 'members',
      status: 'open',
      closesAt: null,
      tallyVisible: false,
      confirmationMessage: '',
      submittedColumnId: null,
      respondentColumnId: null,
    },
    layout,
    columns: [],
    access: 'owner',
    tableGone: false,
  };
}

const multipleChoice = QUESTION_TYPE_CHOICES.find(
  (choice) => choice.id === 'choice'
)!;
const shortAnswer = QUESTION_TYPE_CHOICES.find(
  (choice) => choice.id === 'short'
)!;

/**
 * A table on a fake server. Each column write waits until the test answers
 * it, and lands on the server only then; each read snapshots the server when
 * it starts and answers when the test lets it, so it can arrive stale.
 */
function fakeServer() {
  const columns = new Map<string, FormColumn>([
    [
      NAME_COLUMN,
      { id: NAME_COLUMN, name: 'Name', kind: { type: 'text' }, options: [] },
    ],
  ]);
  const snapshot = () =>
    [...columns.values()].map((column) => ({
      ...column,
      options: column.options.map((option) => ({ ...option })),
    }));
  const [table, setTable] = createSignal<FormColumn[]>(snapshot());
  const writesInFlight: {
    call: string;
    answer: () => void;
    refuse: () => void;
  }[] = [];
  const readsInFlight: (() => void)[] = [];
  let arrival: (() => void) | undefined;
  let readArrival: (() => void) | undefined;
  /** Resolves once a read is waiting on the server. */
  const readArrives = () =>
    readsInFlight.length > 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          readArrival = resolve;
        });
  /** Resolves once a column write is waiting on the server. */
  const writeArrives = () =>
    writesInFlight.length > 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          arrival = resolve;
        });

  function write(call: string, land: () => void) {
    let settle: (result: Result<void, FormWriteFailure>) => void = () => {};
    const result = new ResultAsync(
      new Promise<Result<void, FormWriteFailure>>((resolve) => {
        settle = resolve;
      })
    );
    writesInFlight.push({
      call,
      answer: () => {
        land();
        settle(ok(undefined));
      },
      refuse: () => settle(err({ message: 'Refused' })),
    });
    arrival?.();
    arrival = undefined;
    return result;
  }

  const update = (
    columnId: string,
    change: (column: FormColumn) => FormColumn
  ) => {
    const column = columns.get(columnId);
    if (!column) throw new Error(`no column ${columnId} on the server`);
    columns.set(columnId, change(column));
  };

  const writes: FormColumnWrites = {
    create: (column) =>
      write(`create ${column.name}`, () =>
        columns.set(column.id, {
          id: column.id,
          name: column.name,
          kind: column.kind,
          options: column.options.map((option) => ({ ...option, color: null })),
        })
      ),
    rename: (columnId, name, previousName) =>
      write(`rename ${previousName} → ${name}`, () =>
        update(columnId, (column) => ({ ...column, name }))
      ),
    changeType: (columnId, to) =>
      write(`changeType ${to.type}`, () =>
        update(columnId, (column) => ({ ...column, kind: to }))
      ),
    addOptions: (columnId, added) =>
      write(`addOptions ${added.map((option) => option.label).join(',')}`, () =>
        update(columnId, (column) => ({
          ...column,
          options: [
            ...column.options,
            ...added.map((option) => ({ ...option, color: null })),
          ],
        }))
      ),
    updateOption: (columnId, optionId, change) =>
      write(`updateOption ${change.label}`, () =>
        update(columnId, (column) => ({
          ...column,
          options: column.options.map((option) =>
            option.id === optionId && change.label !== undefined
              ? { ...option, label: change.label }
              : option
          ),
        }))
      ),
    deleteOption: (columnId, optionId) =>
      write(`deleteOption ${optionId}`, () =>
        update(columnId, (column) => ({
          ...column,
          options: column.options.filter((option) => option.id !== optionId),
        }))
      ),
    remove: (columnId) =>
      write(`remove ${columnId}`, () => columns.delete(columnId)),
    convert: () => errAsync({ message: 'not in this test' }),
  };

  const refetch = () => {
    const read = snapshot();
    return new Promise<void>((resolve) => {
      readsInFlight.push(() => {
        setTable(read);
        resolve();
      });
      readArrival?.();
      readArrival = undefined;
    });
  };

  return {
    columns,
    snapshot,
    table,
    setTable,
    writes,
    writesInFlight,
    readsInFlight,
    refetch,
    writeArrives,
    readArrives,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createBuilder column writes under concurrent edits', () => {
  it('keeps every edit made while earlier writes and reads are in flight, sending column writes one at a time in the order they were made', async () => {
    const server = fakeServer();
    await createRoot(async (dispose) => {
      const [form, setForm] = createSignal<FormDetail | undefined>(
        detail(startingLayout)
      );
      let ids = 0;
      const notices: string[] = [];
      const builder = createBuilder({
        detail: form,
        refetch: server.refetch,
        tableColumns: server.table,
        saveLayout: (layout) => {
          const answered = detail(layout);
          setForm(answered);
          return new ResultAsync(Promise.resolve(ok(answered)));
        },
        columnWrites: () => server.writes,
        notify: {
          success: (message) => notices.push(`✓ ${message}`),
          failure: (message) => notices.push(`✗ ${message}`),
        },
        mintId: () => `minted-${++ids}`,
        delayMs: 400,
      });

      // Add a multiple-choice question; its column is still being created.
      void builder.addQuestion(multipleChoice);
      const questionId = builder.selectedId()!;
      const columnId = 'minted-2';
      const firstOptionId = 'minted-1';
      expect(builder.column(columnId)).toEqual({
        id: columnId,
        name: 'Untitled question',
        kind: { type: 'select', multi: false },
        options: [{ id: firstOptionId, label: 'Option 1', color: null }],
      });

      // Title, first option and a second option, all before anything lands.
      void builder.renameQuestion(questionId, 'Will you attend?');
      void builder.updateOption(questionId, firstOptionId, { label: 'Yes' });
      void builder.addOption(questionId, 'No');
      builder.updateQuestion(questionId, { required: true });
      const shown = () => builder.column(columnId);
      expect(shown()?.name).toBe('Will you attend?');
      expect(shown()?.options.map((option) => option.label)).toEqual([
        'Yes',
        'No',
      ]);

      // Only the create is on the wire: the rest wait their turn.
      expect(server.writesInFlight.map((write) => write.call)).toEqual([
        'create Untitled question',
      ]);
      server.writesInFlight.shift()!.answer();
      await server.writeArrives();
      expect(server.writesInFlight.map((write) => write.call)).toEqual([
        'rename Untitled question → Will you attend?',
      ]);

      // A read that started before the rename landed arrives: stale.
      server.setTable(server.snapshot());
      expect(shown()?.name).toBe('Will you attend?');
      expect(shown()?.options.map((option) => option.label)).toEqual([
        'Yes',
        'No',
      ]);

      server.writesInFlight.shift()!.answer();
      await server.writeArrives();
      expect(server.writesInFlight.map((write) => write.call)).toEqual([
        'updateOption Yes',
      ]);
      server.writesInFlight.shift()!.answer();
      await server.writeArrives();
      expect(server.writesInFlight.map((write) => write.call)).toEqual([
        'addOptions No',
      ]);
      server.writesInFlight.shift()!.answer();
      await server.readArrives();

      // The queue drained: one authoritative read, then the pending edits go.
      expect(server.readsInFlight).toHaveLength(1);
      expect(shown()?.options.map((option) => option.label)).toEqual([
        'Yes',
        'No',
      ]);
      server.readsInFlight.shift()!();
      await builder.settled();
      await vi.advanceTimersByTimeAsync(1000);

      expect(shown()).toEqual({
        id: columnId,
        name: 'Will you attend?',
        kind: { type: 'select', multi: false },
        options: [
          { id: firstOptionId, label: 'Yes', color: null },
          { id: 'minted-4', label: 'No', color: null },
        ],
      });
      expect(server.columns.get(columnId)).toEqual(shown());
      expect(
        builder
          .layout()
          ?.sections[0].questions.find((question) => question.id === questionId)
          ?.required
      ).toBe(true);
      expect(builder.isColumnBusy(columnId)).toBe(false);
      expect(notices).toEqual([]);
      dispose();
    });
  });

  it('shows a type change at once and sends it after the rename made before it', async () => {
    const server = fakeServer();
    await createRoot(async (dispose) => {
      const [form, setForm] = createSignal<FormDetail | undefined>(
        detail(startingLayout)
      );
      const builder = createBuilder({
        detail: form,
        refetch: server.refetch,
        tableColumns: server.table,
        saveLayout: (layout) => {
          const answered = detail(layout);
          setForm(answered);
          return new ResultAsync(Promise.resolve(ok(answered)));
        },
        columnWrites: () => server.writes,
        notify: { success: () => {}, failure: () => {} },
        mintId: () => 'minted',
        delayMs: 400,
      });
      void builder.renameQuestion('q-name', 'Attending');
      void builder.changeType('q-name', multipleChoice);
      expect(builder.column(NAME_COLUMN)?.name).toBe('Attending');
      expect(builder.column(NAME_COLUMN)?.kind).toEqual({
        type: 'select',
        multi: false,
      });
      expect(server.writesInFlight.map((write) => write.call)).toEqual([
        'rename Name → Attending',
      ]);
      server.writesInFlight.shift()!.answer();
      await server.writeArrives();
      expect(server.writesInFlight.map((write) => write.call)).toEqual([
        'changeType select',
      ]);
      server.writesInFlight.shift()!.answer();
      await server.readArrives();
      server.readsInFlight.shift()!();
      await builder.settled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(builder.column(NAME_COLUMN)?.name).toBe('Attending');
      expect(builder.layout()?.sections[0].questions[0].widget).toBe('choice');
      dispose();
    });
  });

  it('drops only the refused edit, keeps the ones after it, and says so', async () => {
    const server = fakeServer();
    await createRoot(async (dispose) => {
      const [form] = createSignal<FormDetail | undefined>(
        detail(startingLayout)
      );
      const notices: string[] = [];
      const builder = createBuilder({
        detail: form,
        refetch: server.refetch,
        tableColumns: server.table,
        saveLayout: (layout) =>
          new ResultAsync(Promise.resolve(ok(detail(layout)))),
        columnWrites: () => server.writes,
        notify: {
          success: () => {},
          failure: (message) => notices.push(message),
        },
        mintId: () => 'minted',
        delayMs: 400,
      });
      void builder.changeType('q-name', shortAnswer);
      const renamed = builder.renameQuestion('q-name', 'Full name');
      void builder.updateQuestion('q-name', { helpText: 'First and last' });
      expect(server.writesInFlight.map((write) => write.call)).toEqual([
        'rename Name → Full name',
      ]);
      server.writesInFlight.shift()!.refuse();
      await renamed;
      expect(builder.column(NAME_COLUMN)?.name).toBe('Name');
      expect(notices).toEqual(['The question couldn’t be renamed: Refused']);
      server.readsInFlight.shift()!();
      await builder.settled();
      expect(builder.layout()?.sections[0].questions[0].helpText).toBe(
        'First and last'
      );
      dispose();
    });
  });

  it('keeps sending after a write that throws and a read that fails, and still settles', async () => {
    const server = fakeServer();
    await createRoot(async (dispose) => {
      const [form] = createSignal<FormDetail | undefined>(
        detail(startingLayout)
      );
      const notices: string[] = [];
      let reads = 0;
      const builder = createBuilder({
        detail: form,
        refetch: async () => {
          reads += 1;
          throw new Error('offline');
        },
        tableColumns: server.table,
        saveLayout: (layout) =>
          new ResultAsync(Promise.resolve(ok(detail(layout)))),
        columnWrites: () => ({
          ...server.writes,
          rename: () =>
            new ResultAsync(Promise.reject(new Error('socket closed'))),
        }),
        notify: {
          success: () => {},
          failure: (message) => notices.push(message),
        },
        mintId: () => 'minted',
        delayMs: 400,
      });
      const renamed = builder.renameQuestion('q-name', 'Full name');
      const typed = builder.changeType('q-name', multipleChoice);
      await renamed;
      expect(notices).toEqual([
        'The question couldn’t be renamed: socket closed',
      ]);
      await server.writeArrives();
      expect(server.writesInFlight.map((write) => write.call)).toEqual([
        'changeType select',
      ]);
      server.writesInFlight.shift()!.answer();
      await typed;
      await builder.settled();
      expect(reads).toBeGreaterThan(0);
      expect(builder.column(NAME_COLUMN)?.kind).toEqual({
        type: 'select',
        multi: false,
      });
      dispose();
    });
  });
});
