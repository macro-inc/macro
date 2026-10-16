import {
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
  ResultAsync,
} from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FormColumnWrites,
  FormWriteFailure,
} from '../context/form-context';
import type { FormColumn, FormDetail, FormLayout } from '../core/form-model';
import { QUESTION_TYPE_CHOICES } from '../core/question-types';
import {
  createFakeCollaboration,
  type FakeCollaboration,
} from '../tests/fake-collaboration';
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
      bookingTarget: null,
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
      bookingTarget: null,
      questions: [],
    },
    {
      id: 'details',
      title: 'Details',
      description: '',
      kind: 'questions',
      gateRules: null,
      gateMessage: '',
      bookingTarget: null,
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
  shared?: FakeCollaboration;
}) {
  const [server, setServer] = createSignal<FormDetail | undefined>(
    detail(startingLayout)
  );
  const shared = options.shared ?? createFakeCollaboration(startingLayout);
  const notices: string[] = [];
  let ids = 0;
  const refetch = vi.fn(async () => {});
  const builder = createBuilder({
    detail: server,
    refetch,
    tableColumns: () => tableColumns,
    collaboration: shared.collaboration,
    columnWrites: () => options.writes,
    notify: {
      success: (message) => notices.push(`✓ ${message}`),
      failure: (message) => notices.push(`✗ ${message}`),
    },
    mintId: () => `minted-${++ids}`,
  });
  return {
    builder,
    shared,
    saved: shared.written,
    notices,
    refetch,
    setServer,
  };
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
  it('adds a question by creating its column first, then writing the shared layout that places it after the selected question', async () => {
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

  it('takes the question away again when its column is refused, writing nothing', async () => {
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

  it('accepts no edit until the shared layout opens, nor while it is unreadable', async () => {
    const { writes, calls } = fakeWrites();
    await createRoot(async (dispose) => {
      const shared = createFakeCollaboration(startingLayout, {
        status: { kind: 'loading' },
      });
      const { builder, saved } = setup({ writes, shared });
      expect(builder.layout()).toBeUndefined();
      expect(builder.editable()).toBe(false);
      expect(builder.updateQuestion('q-name', { required: false })).toBe(false);
      await builder.addQuestion(shortAnswer);
      expect(calls).toEqual([]);
      shared.setStatus({ kind: 'ready' });
      expect(builder.editable()).toBe(true);
      expect(builder.updateQuestion('q-name', { required: false })).toBe(true);
      shared.setStatus({
        kind: 'error',
        message: 'This form was edited by a newer version of Macro.',
      });
      expect(builder.layout()?.sections[0].questions[0].required).toBe(false);
      expect(builder.updateQuestion('q-name', { helpText: 'Lost' })).toBe(
        false
      );
      expect(saved).toHaveLength(1);
      dispose();
    });
  });

  it('tells an edit the shared document refused and shows what it holds', async () => {
    const { writes } = fakeWrites();
    await createRoot(async (dispose) => {
      const shared = createFakeCollaboration(startingLayout);
      const { builder, notices } = setup({
        writes,
        shared: {
          ...shared,
          collaboration: {
            ...shared.collaboration,
            apply: () => {
              throw new Error('The form layout is not open for editing.');
            },
          },
        },
      });
      expect(builder.updateQuestion('q-name', { helpText: 'Lost' })).toBe(
        false
      );
      expect(builder.layout()?.sections[0].questions[0].helpText).toBe('');
      expect(notices).toEqual([
        '✗ The change wasn’t made: The form layout is not open for editing.',
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
      expect(notices).toEqual(['✓ Removed 1 screener rule that checked it.']);
      expect(calls).toEqual([]);
      expect(builder.hiddenColumns().map((column) => column.name)).toEqual([
        'Team',
        'Notes',
      ]);
      dispose();
    });
  });

  it('takes the question and the gate rules naming its column off the published form before deleting the column', async () => {
    const order: string[] = [];
    const { writes } = fakeWrites({
      remove: (columnId) => {
        order.push(`remove ${columnId}`);
        return okAsync(undefined);
      },
    });
    await createRoot(async (dispose) => {
      const shared = createFakeCollaboration(startingLayout);
      shared.answerFlushes(() => {
        const layout = shared.theirs();
        order.push(
          `publish gate=${JSON.stringify(layout.sections[1].gateRules?.conditions)} questions=${layout.sections[0].questions.map((question) => question.id).join(',')}`
        );
        return okAsync(undefined);
      });
      const { builder } = setup({ writes, shared });
      expect(await builder.deleteColumn('q-team')).toBe(true);
      expect(order).toEqual([
        'publish gate=[] questions=q-name',
        `remove ${TEAM_COLUMN}`,
      ]);
      dispose();
    });
  });

  it('deletes nothing when the layout without the question could not be published', async () => {
    const { writes, calls } = fakeWrites();
    await createRoot(async (dispose) => {
      const shared = createFakeCollaboration(startingLayout);
      shared.answerFlushes(() => errAsync({ message: 'You’re offline.' }));
      const { builder, notices } = setup({ writes, shared });
      expect(await builder.deleteColumn('q-team')).toBe(false);
      expect(calls).toEqual([]);
      expect(notices).toContain(
        '✗ The column wasn’t deleted: the form couldn’t drop its question first. You’re offline.'
      );
      dispose();
    });
  });

  it('publishes layout edits made before deleting a column, then reads the form back', async () => {
    const { writes, calls } = fakeWrites();
    await createRoot(async (dispose) => {
      const { builder, shared, refetch } = setup({ writes });
      builder.updateQuestion('q-name', { required: false });
      const deleted = await builder.deleteColumn('q-team');
      expect(deleted).toBe(true);
      expect(shared.flushes()).toBe(1);
      expect(shared.theirs().sections[0].questions).toEqual([
        {
          id: 'q-name',
          columnId: NAME_COLUMN,
          helpText: '',
          required: false,
          widget: 'short',
        },
      ]);
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

describe('with another editor', () => {
  const renameSection =
    (sectionId: string, title: string) => (layout: FormLayout) => ({
      sections: layout.sections.map((section) =>
        section.id === sectionId ? { ...section, title } : section
      ),
    });
  const dropSection = (sectionId: string) => (layout: FormLayout) => ({
    sections: layout.sections.filter((section) => section.id !== sectionId),
  });
  const questionIds = (layout: FormLayout | undefined) =>
    layout?.sections.map((section) => ({
      [section.id]: section.questions.map((question) => question.id),
    }));

  it('merges an edit to another section with this editor’s own, on both sides', async () => {
    const { writes } = fakeWrites();
    await createRoot(async (dispose) => {
      const { builder, shared } = setup({ writes });
      builder.updateQuestion('q-name', { helpText: 'First and last' });
      shared.remote(renameSection('details', 'Travel'));
      builder.updateSection('about', { title: 'You' });
      for (const layout of [builder.layout(), shared.theirs()]) {
        expect(layout?.sections.map((section) => section.title)).toEqual([
          'You',
          'Eligibility',
          'Travel',
        ]);
        expect(layout?.sections[0].questions[0].helpText).toBe(
          'First and last'
        );
      }
      dispose();
    });
  });

  it('merges edits made offline with edits made meanwhile elsewhere, never bringing back a question deleted there', async () => {
    const { writes } = fakeWrites();
    await createRoot(async (dispose) => {
      const { builder, shared } = setup({ writes });
      shared.goOffline();
      builder.updateQuestion('q-team', { required: true });
      builder.updateQuestion('q-name', { helpText: 'First and last' });
      expect(shared.collaboration.save()).toBe('unsaved');
      expect(builder.layout()?.sections[0].questions[1].required).toBe(true);
      shared.remote((layout) => ({
        sections: layout.sections.map((section) =>
          section.id === 'about'
            ? {
                ...section,
                questions: section.questions.filter(
                  (question) => question.id !== 'q-team'
                ),
              }
            : section
        ),
      }));
      shared.reconnect();
      for (const layout of [builder.layout(), shared.theirs()])
        expect(layout?.sections[0].questions).toEqual([
          {
            id: 'q-name',
            columnId: NAME_COLUMN,
            helpText: 'First and last',
            required: true,
            widget: 'short',
          },
        ]);
      dispose();
    });
  });

  it('shows a question whose column is still being created without sharing it, keeping edits made elsewhere meanwhile', async () => {
    const creation = pending<void>();
    const { writes } = fakeWrites({ create: () => creation.result });
    await createRoot(async (dispose) => {
      const { builder, shared } = setup({ writes });
      builder.select('q-name');
      const adding = builder.addQuestion(shortAnswer);
      const questionId = builder.selectedId();
      builder.updateQuestion(questionId ?? '', { required: true });
      shared.remote(renameSection('details', 'Travel'));
      expect(questionIds(shared.theirs())).toEqual([
        { about: ['q-name', 'q-team'] },
        { gate: [] },
        { details: [] },
      ]);
      expect(questionIds(builder.layout())).toEqual([
        { about: ['q-name', questionId, 'q-team'] },
        { gate: [] },
        { details: [] },
      ]);
      expect(builder.layout()?.sections[2].title).toBe('Travel');
      creation.settle(ok(undefined));
      await adding;
      for (const layout of [builder.layout(), shared.theirs()]) {
        expect(questionIds(layout)).toEqual([
          { about: ['q-name', questionId, 'q-team'] },
          { gate: [] },
          { details: [] },
        ]);
        expect(layout?.sections[0].questions[1].required).toBe(true);
        expect(layout?.sections[2].title).toBe('Travel');
      }
      dispose();
    });
  });

  it('keeps edits made elsewhere when a new question’s column is refused', async () => {
    const creation = pending<void>();
    const { writes } = fakeWrites({ create: () => creation.result });
    await createRoot(async (dispose) => {
      const { builder, shared, saved } = setup({ writes });
      const adding = builder.addQuestion(shortAnswer);
      shared.remote(renameSection('about', 'Who you are'));
      creation.settle(err({ message: 'Name taken' }));
      await adding;
      expect(builder.layout()).toEqual(shared.theirs());
      expect(builder.layout()?.sections[0].title).toBe('Who you are');
      expect(questionIds(builder.layout())).toEqual([
        { about: ['q-name', 'q-team'] },
        { gate: [] },
        { details: [] },
      ]);
      expect(saved).toEqual([]);
      dispose();
    });
  });

  it('never brings back a section deleted elsewhere while a question was being added to it', async () => {
    const creation = pending<void>();
    const { writes } = fakeWrites({ create: () => creation.result });
    await createRoot(async (dispose) => {
      const { builder, shared } = setup({ writes });
      builder.focusSection('details');
      const adding = builder.addQuestion(shortAnswer);
      expect(builder.layout()?.sections[2].questions).toHaveLength(1);
      shared.remote(dropSection('details'));
      expect(builder.layout()?.sections.map((section) => section.id)).toEqual([
        'about',
        'gate',
      ]);
      creation.settle(ok(undefined));
      await adding;
      for (const layout of [builder.layout(), shared.theirs()])
        expect(questionIds(layout)).toEqual([
          { about: ['q-name', 'q-team'] },
          { gate: [] },
        ]);
      dispose();
    });
  });

  it('shows the other editors what is selected, and clears it when away or gone', () => {
    const { writes } = fakeWrites();
    const { builder, shared, dispose } = createRoot((dispose) => ({
      ...setup({ writes }),
      dispose,
    }));
    builder.select('q-team');
    builder.focusSection('details');
    builder.setPresent(false);
    builder.setPresent(true);
    builder.select(undefined);
    builder.select('q-name');
    dispose();
    expect(shared.selections).toEqual([
      { sectionId: 'about', questionId: 'q-team' },
      { sectionId: 'details', questionId: null },
      undefined,
      { sectionId: 'details', questionId: null },
      undefined,
      { sectionId: 'about', questionId: 'q-name' },
      undefined,
    ]);
  });
});

describe('the booking step', () => {
  const INTRO_CALL = { profileId: 'profile-1', eventTypeId: 'intro-call' };
  const REVIEW_CALL = { profileId: 'profile-1', eventTypeId: 'review-call' };

  it('adds one booking step last, selects it again instead of adding a second, and writes a new link', async () => {
    const { writes } = fakeWrites();
    await createRoot(async (dispose) => {
      const { builder, saved } = setup({ writes });
      builder.select('q-name');
      expect(builder.addBooking(INTRO_CALL)).toEqual({
        sectionId: 'minted-1',
        added: true,
      });
      expect(builder.layout()?.sections.at(-1)).toEqual({
        id: 'minted-1',
        title: 'Book a time',
        description: '',
        kind: 'booking',
        gateRules: null,
        gateMessage: '',
        bookingTarget: INTRO_CALL,
        questions: [],
      });
      expect(builder.addBooking(REVIEW_CALL)).toEqual({
        sectionId: 'minted-1',
        added: false,
      });
      expect(
        builder
          .layout()
          ?.sections.filter((section) => section.kind === 'booking')
      ).toHaveLength(1);
      expect(builder.changeBookingTarget('minted-1', REVIEW_CALL)).toBe(true);
      expect(saved).toHaveLength(2);
      expect(saved[1].sections.at(-1)?.bookingTarget).toEqual(REVIEW_CALL);
      dispose();
    });
  });

  it('puts new sections and screeners before the booking step and keeps it last when reordering', async () => {
    const { writes } = fakeWrites();
    await createRoot(async (dispose) => {
      const { builder, notices } = setup({ writes });
      const { sectionId } = builder.addBooking(INTRO_CALL) ?? {};
      builder.focusSection('details');
      const travel = builder.addSection('questions');
      const screener = builder.addSection('gate');
      expect(builder.layout()?.sections.map((section) => section.id)).toEqual([
        'about',
        'gate',
        'details',
        travel,
        screener,
        sectionId,
      ]);
      expect(builder.sectionMoveRefusal('details', 5)).toBe(
        'The booking step comes last, after every question and screener. Move “Book a time” to the end.'
      );
      expect(builder.moveSection(sectionId ?? '', 0)).toBe(false);
      expect(notices).toEqual([
        '✗ The booking step comes last, after every question and screener. Move “Book a time” to the end.',
      ]);
      dispose();
    });
  });

  it('removes the booking step and nothing else', async () => {
    const { writes, calls } = fakeWrites();
    await createRoot(async (dispose) => {
      const { builder } = setup({ writes });
      const { sectionId } = builder.addBooking(INTRO_CALL) ?? {};
      builder.removeSection(sectionId ?? '');
      expect(builder.layout()?.sections.map((section) => section.id)).toEqual([
        'about',
        'gate',
        'details',
      ]);
      expect(calls).toEqual([]);
      dispose();
    });
  });

  it('recreates the question section before booking when every question section was deleted', async () => {
    const { writes } = fakeWrites();
    await createRoot(async (dispose) => {
      const { builder, shared, notices } = setup({ writes });
      const booking = builder.addBooking(INTRO_CALL);
      builder.removeSection('gate');
      builder.removeSection('about');
      builder.removeSection('details');

      await builder.addQuestion(shortAnswer);

      expect(shared.theirs().sections.map((section) => section.kind)).toEqual([
        'questions',
        'booking',
      ]);
      expect(shared.theirs().sections[0].questions).toHaveLength(1);
      expect(shared.theirs().sections.at(-1)?.id).toBe(booking?.sectionId);
      expect(notices).toEqual([]);
      dispose();
    });
  });

  it('reuses a column before booking when the form has no question sections', () => {
    const { writes, calls } = fakeWrites();
    createRoot((dispose) => {
      const { builder, shared, notices } = setup({ writes });
      const booking = builder.addBooking(INTRO_CALL);
      builder.removeSection('gate');
      builder.removeSection('about');
      builder.removeSection('details');

      builder.addExistingColumn(NOTES_COLUMN);

      expect(shared.theirs().sections.map((section) => section.kind)).toEqual([
        'questions',
        'booking',
      ]);
      expect(shared.theirs().sections[0].questions[0].columnId).toBe(
        NOTES_COLUMN
      );
      expect(shared.theirs().sections.at(-1)?.id).toBe(booking?.sectionId);
      expect(calls).toEqual([]);
      expect(notices).toEqual([]);
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
