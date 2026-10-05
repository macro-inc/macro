import { errAsync, ok, okAsync, type Result, ResultAsync } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FormColumnWrites,
  FormWriteFailure,
} from '../context/form-context';
import type { FormColumn, FormDetail, FormLayout } from '../core/form-model';
import { QUESTION_TYPE_CHOICES } from '../core/question-types';
import { createBuilder, uniqueColumnName } from './create-builder';

const NAME_COLUMN = 'column-name';
const TEAM_COLUMN = 'column-team';
const NOTES_COLUMN = 'column-notes';
const CONTRACTOR = 'option-contractor';

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
      submittedColumnId: 'column-submitted',
      respondentColumnId: 'column-respondent',
    },
    layout,
    columns: [],
    access: 'owner',
    tableGone: false,
  };
}

const tableColumns: FormColumn[] = [
  { id: NAME_COLUMN, name: 'Name', kind: { type: 'text' }, options: [] },
  {
    id: TEAM_COLUMN,
    name: 'Team',
    kind: { type: 'select', multi: false },
    options: [{ id: CONTRACTOR, label: 'Contractor', color: null }],
  },
  { id: NOTES_COLUMN, name: 'Notes', kind: { type: 'text' }, options: [] },
  {
    id: 'column-submitted',
    name: 'Submitted',
    kind: { type: 'date' },
    options: [],
  },
  {
    id: 'column-respondent',
    name: 'Respondent',
    kind: { type: 'entity', target: 'USER', multi: false },
    options: [],
  },
];

const startingLayout: FormLayout = {
  sections: [
    {
      id: 'about',
      title: 'About you',
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
        {
          id: 'q-team',
          columnId: TEAM_COLUMN,
          helpText: '',
          required: false,
          widget: 'choice',
        },
      ],
    },
    {
      id: 'gate',
      title: 'Eligibility',
      description: '',
      kind: 'gate',
      gateRules: {
        conjunction: 'and',
        conditions: [
          {
            kind: 'condition',
            column: TEAM_COLUMN,
            test: {
              kind: 'options',
              operator: 'isNoneOf',
              options: [CONTRACTOR],
            },
          },
        ],
      },
      gateMessage: 'Employees only.',
      questions: [],
    },
    {
      id: 'details',
      title: 'Details',
      description: '',
      kind: 'questions',
      gateRules: null,
      gateMessage: '',
      questions: [],
    },
  ],
};

/** A write the test answers by hand. */
function pending<Value>() {
  let settle: (result: Result<Value, FormWriteFailure>) => void = () => {};
  const result = new ResultAsync(
    new Promise<Result<Value, FormWriteFailure>>((resolve) => {
      settle = resolve;
    })
  );
  return { result, settle };
}

function fakeWrites(overrides: Partial<FormColumnWrites> = {}) {
  const calls: string[] = [];
  const writes: FormColumnWrites = {
    create: (column) => {
      calls.push(`create ${column.name} ${column.kind.type}`);
      return okAsync(undefined);
    },
    rename: (columnId, name) => {
      calls.push(`rename ${columnId} ${name}`);
      return okAsync(undefined);
    },
    changeType: (columnId, to) => {
      calls.push(`changeType ${columnId} ${to.type}`);
      return okAsync(undefined);
    },
    addOptions: (columnId, added) => {
      calls.push(
        `addOptions ${columnId} ${added.map((o) => o.label).join(',')}`
      );
      return okAsync(undefined);
    },
    updateOption: () => okAsync(undefined),
    deleteOption: () => okAsync(undefined),
    remove: (columnId) => {
      calls.push(`remove ${columnId}`);
      return okAsync(undefined);
    },
    convert: (columnId, to, name) => {
      calls.push(`convert ${columnId} ${to.type} ${name}`);
      return okAsync('column-converted');
    },
    ...overrides,
  };
  return { writes, calls };
}

function setup(options: {
  writes: FormColumnWrites;
  save?: (layout: FormLayout) => ResultAsync<FormDetail, FormWriteFailure>;
}) {
  const [server, setServer] = createSignal<FormDetail | undefined>(
    detail(startingLayout)
  );
  const saved: FormLayout[] = [];
  const notices: string[] = [];
  let ids = 0;
  const refetch = vi.fn(async () => {});
  const builder = createBuilder({
    detail: server,
    refetch,
    tableColumns: () => tableColumns,
    saveLayout:
      options.save ??
      ((layout) => {
        saved.push(layout);
        const answered = detail(layout);
        setServer(answered);
        return okAsync(answered);
      }),
    columnWrites: () => options.writes,
    notify: {
      success: (message) => notices.push(`✓ ${message}`),
      failure: (message) => notices.push(`✗ ${message}`),
    },
    mintId: () => `minted-${++ids}`,
    delayMs: 400,
  });
  return { builder, saved, notices, refetch, setServer };
}

const shortAnswer = QUESTION_TYPE_CHOICES.find(
  (choice) => choice.id === 'short'
)!;
const multipleChoice = QUESTION_TYPE_CHOICES.find(
  (choice) => choice.id === 'choice'
)!;
const checkboxes = QUESTION_TYPE_CHOICES.find(
  (choice) => choice.id === 'checkboxes'
)!;
const dropdown = QUESTION_TYPE_CHOICES.find(
  (choice) => choice.id === 'dropdown'
)!;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createBuilder', () => {
  it('adds a question by creating its column first, then saving the layout that places it after the selected question', async () => {
    const creation = pending<void>();
    const { writes, calls } = fakeWrites({
      create: (column) => {
        calls.push(`create ${column.name} ${column.kind.type}`);
        return creation.result;
      },
    });
    await createRoot(async (dispose) => {
      const { builder, saved } = setup({ writes });
      builder.select('q-name');
      const adding = builder.addQuestion(shortAnswer);
      expect(
        builder.layout()?.sections[0].questions.map((question) => question.id)
      ).toEqual(['q-name', 'minted-2', 'q-team']);
      expect(builder.selectedId()).toBe('minted-2');
      expect(builder.column('minted-1')?.name).toBe('Untitled question');
      await vi.advanceTimersByTimeAsync(2000);
      expect(saved).toHaveLength(0);
      expect(calls).toEqual(['create Untitled question text']);
      creation.settle(ok(undefined));
      await adding;
      expect(saved).toHaveLength(1);
      expect(saved[0].sections[0].questions[1]).toEqual({
        id: 'minted-2',
        columnId: 'minted-1',
        helpText: '',
        required: false,
        widget: 'short',
      });
      dispose();
    });
  });

  it('takes the question away again when its column is refused, saving nothing', async () => {
    const { writes } = fakeWrites({
      create: () => errAsync({ message: 'Name taken' }),
    });
    await createRoot(async (dispose) => {
      const { builder, saved, notices } = setup({ writes });
      await builder.addQuestion(multipleChoice);
      await vi.advanceTimersByTimeAsync(1000);
      expect(
        builder
          .layout()
          ?.sections.flatMap((section) =>
            section.questions.map((question) => question.id)
          )
      ).toEqual(['q-name', 'q-team']);
      expect(saved.flatMap((layout) => layout.sections[2].questions)).toEqual(
        []
      );
      expect(notices).toEqual(['✗ The question couldn’t be added: Name taken']);
      dispose();
    });
  });

  it('rolls back to the server layout and reads it again when a save fails', async () => {
    const { writes } = fakeWrites();
    await createRoot(async (dispose) => {
      const { builder, notices, refetch } = setup({
        writes,
        save: () => errAsync({ message: 'The table changed.' }),
      });
      builder.updateQuestion('q-name', { helpText: 'First and last' });
      expect(builder.layout()?.sections[0].questions[0].helpText).toBe(
        'First and last'
      );
      await vi.advanceTimersByTimeAsync(400);
      expect(builder.layout()?.sections[0].questions[0].helpText).toBe('');
      expect(builder.saveState()).toBe('failed');
      expect(refetch).toHaveBeenCalled();
      expect(notices).toEqual([
        '✗ Your last change to the form wasn’t saved: The table changed.',
      ]);
      dispose();
    });
  });

  it('refuses moving a question below the gate that checks it', async () => {
    const { writes } = fakeWrites();
    await createRoot(async (dispose) => {
      const { builder, notices } = setup({ writes });
      expect(
        builder.questionMoveRefusal('q-team', {
          sectionId: 'details',
          index: 0,
        })
      ).toBe(
        '“Eligibility” checks “Team”, so that question has to come before it.'
      );
      expect(
        builder.moveQuestion('q-team', { sectionId: 'details', index: 0 })
      ).toBe(false);
      expect(notices).toHaveLength(1);
      expect(
        builder.moveQuestion('q-name', { sectionId: 'details', index: 0 })
      ).toBe(true);
      dispose();
    });
  });

  it('changes only the widget between ways of asking the same kind, and the column type otherwise', async () => {
    const { writes, calls } = fakeWrites();
    await createRoot(async (dispose) => {
      const { builder, saved } = setup({ writes });
      await builder.changeType('q-team', dropdown);
      await vi.advanceTimersByTimeAsync(400);
      expect(calls).toEqual([]);
      expect(saved.at(-1)?.sections[0].questions[1].widget).toBe('dropdown');
      await builder.changeType('q-team', checkboxes);
      await vi.advanceTimersByTimeAsync(400);
      expect(calls).toEqual([`changeType ${TEAM_COLUMN} select`]);
      expect(saved.at(-1)?.sections[0].questions[1].widget).toBe('checkboxes');
      dispose();
    });
  });

  it('offers a conversion when answers do not fit, and swaps the question onto the converted column', async () => {
    const { writes, calls } = fakeWrites({
      changeType: () => errAsync({ message: '3 values aren’t numbers' }),
    });
    const number = QUESTION_TYPE_CHOICES.find(
      (choice) => choice.id === 'number'
    )!;
    await createRoot(async (dispose) => {
      const { builder, saved, notices } = setup({ writes });
      await builder.changeType('q-name', number);
      expect(builder.conversion()).toEqual({
        questionId: 'q-name',
        to: { type: 'number' },
        widget: null,
        label: 'Number',
        message: '3 values aren’t numbers',
      });
      await builder.convertQuestion();
      expect(calls).toEqual([`convert ${NAME_COLUMN} number Name (Number)`]);
      expect(saved.at(-1)?.sections[0].questions[0]).toEqual({
        id: 'q-name',
        columnId: 'column-converted',
        helpText: '',
        required: true,
        widget: null,
      });
      expect(notices.at(-1)).toBe(
        '✓ Converted. “Name” keeps its original answers and is listed under columns not on this form.'
      );
      dispose();
    });
  });

  it('renames through the column, refusing a name another column has', async () => {
    const { writes, calls } = fakeWrites();
    await createRoot(async (dispose) => {
      const { builder, notices } = setup({ writes });
      await builder.renameQuestion('q-name', 'notes');
      expect(notices).toEqual(['✗ Another column is already called “notes”.']);
      await builder.renameQuestion('q-name', 'Full name');
      expect(calls).toEqual([`rename ${NAME_COLUMN} Full name`]);
      dispose();
    });
  });

  it('lists the columns not on the form, never the managed ones, and adds one back', async () => {
    const { writes } = fakeWrites();
    await createRoot(async (dispose) => {
      const { builder, saved } = setup({ writes });
      expect(builder.hiddenColumns().map((column) => column.name)).toEqual([
        'Notes',
      ]);
      builder.addExistingColumn(NOTES_COLUMN, {
        sectionId: 'details',
        index: 0,
      });
      expect(builder.hiddenColumns()).toEqual([]);
      await vi.advanceTimersByTimeAsync(400);
      expect(saved.at(-1)?.sections[2].questions[0].columnId).toBe(
        NOTES_COLUMN
      );
      dispose();
    });
  });

  it('removes a question and the gate rules that checked it, keeping the column', async () => {
    const { writes, calls } = fakeWrites();
    await createRoot(async (dispose) => {
      const { builder, notices } = setup({ writes });
      builder.select('q-team');
      builder.removeQuestion('q-team');
      expect(builder.selectedId()).toBe('q-name');
      expect(builder.layout()?.sections[1].gateRules?.conditions).toEqual([]);
      expect(notices).toEqual(['✓ Removed 1 gate rule that checked it.']);
      expect(calls).toEqual([]);
      expect(builder.hiddenColumns().map((column) => column.name)).toEqual([
        'Team',
        'Notes',
      ]);
      dispose();
    });
  });

  it('takes the question and the gate rules naming its column off the form before deleting the column', async () => {
    const order: string[] = [];
    const { writes } = fakeWrites({
      remove: (columnId) => {
        order.push(`remove ${columnId}`);
        return okAsync(undefined);
      },
    });
    await createRoot(async (dispose) => {
      const { builder } = setup({
        writes,
        save: (layout) => {
          order.push(
            `save gate=${JSON.stringify(layout.sections[1].gateRules?.conditions)} questions=${layout.sections[0].questions.map((question) => question.id).join(',')}`
          );
          return okAsync(detail(layout));
        },
      });
      expect(await builder.deleteColumn('q-team')).toBe(true);
      expect(order).toEqual([
        'save gate=[] questions=q-name',
        `remove ${TEAM_COLUMN}`,
      ]);
      dispose();
    });
  });

  it('deletes nothing when the layout without the question is refused', async () => {
    const { writes, calls } = fakeWrites();
    await createRoot(async (dispose) => {
      const { builder, notices } = setup({
        writes,
        save: () => errAsync({ message: 'The table changed.' }),
      });
      expect(await builder.deleteColumn('q-team')).toBe(false);
      expect(calls).toEqual([]);
      expect(notices).toContain(
        '✗ The column wasn’t deleted: the form couldn’t drop its question first.'
      );
      dispose();
    });
  });

  it('sends pending layout edits before deleting a column, then reads the form back', async () => {
    const { writes, calls } = fakeWrites();
    await createRoot(async (dispose) => {
      const { builder, saved, refetch } = setup({ writes });
      builder.updateQuestion('q-name', { required: false });
      const deleted = await builder.deleteColumn('q-team');
      expect(deleted).toBe(true);
      expect(saved).toHaveLength(1);
      expect(calls).toEqual([`remove ${TEAM_COLUMN}`]);
      expect(refetch).toHaveBeenCalled();
      dispose();
    });
  });

  it('refuses a file question while the form is public', async () => {
    const { writes, calls } = fakeWrites();
    const file = QUESTION_TYPE_CHOICES.find((choice) => choice.id === 'file')!;
    await createRoot(async (dispose) => {
      const { builder, notices, setServer } = setup({ writes });
      const publicDetail = detail(startingLayout);
      publicDetail.form.audience = 'public';
      setServer(publicDetail);
      await builder.addQuestion(file);
      expect(calls).toEqual([]);
      expect(notices).toEqual([
        '✗ File upload needs respondents to sign in. Switch “Who can respond” to workspace members first.',
      ]);
      dispose();
    });
  });

  it('adds a section after the selected question’s section', async () => {
    const { writes } = fakeWrites();
    await createRoot(async (dispose) => {
      const { builder } = setup({ writes });
      builder.select('q-name');
      const id = builder.addSection('gate');
      expect(builder.layout()?.sections.map((section) => section.id)).toEqual([
        'about',
        id,
        'gate',
        'details',
      ]);
      dispose();
    });
  });

  it('adds the next question into a section just added, not after the question selected before', async () => {
    const { writes } = fakeWrites();
    await createRoot(async (dispose) => {
      const { builder } = setup({ writes });
      builder.select('q-name');
      const logistics = builder.addSection('questions');
      await builder.addQuestion(shortAnswer);
      const section = builder
        .layout()
        ?.sections.find((item) => item.id === logistics);
      expect(section?.questions.map((question) => question.id)).toEqual([
        builder.selectedId(),
      ]);
      expect(builder.layout()?.sections[0].questions).toHaveLength(2);
      dispose();
    });
  });

  it('adds into the section last focused, at its end, once no question there is selected', async () => {
    const { writes } = fakeWrites();
    await createRoot(async (dispose) => {
      const { builder } = setup({ writes });
      builder.select('q-name');
      builder.focusSection('details');
      await builder.addQuestion(shortAnswer);
      expect(
        builder.layout()?.sections[2].questions.map((question) => question.id)
      ).toEqual([builder.selectedId()]);
      // Selecting a question targets right after it again.
      builder.select('q-name');
      await builder.addQuestion(shortAnswer);
      expect(builder.layout()?.sections[0].questions[1].id).toBe(
        builder.selectedId()
      );
      dispose();
    });
  });
});

it('numbers a column name while another column has it', () => {
  expect(uniqueColumnName('Untitled question', ['untitled question'])).toBe(
    'Untitled question 2'
  );
  expect(uniqueColumnName('Name', [])).toBe('Name');
});
