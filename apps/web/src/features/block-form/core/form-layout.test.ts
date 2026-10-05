import { describe, expect, it } from 'vitest';
import {
  addQuestion,
  addSection,
  brokenGateColumns,
  columnsNamed,
  gateColumns,
  hiddenColumns,
  moveQuestion,
  moveSection,
  pruneBrokenRules,
  removeQuestion,
  removeSection,
  swapQuestionColumn,
  updateQuestion,
  updateSection,
} from './form-layout';
import type { FormColumn, FormLayout } from './form-model';

const ABOUT = '0192aaaa-0000-7000-8000-000000000001';
const GATE = '0192aaaa-0000-7000-8000-000000000002';
const DETAILS = '0192aaaa-0000-7000-8000-000000000003';
const NAME_QUESTION = '0192bbbb-0000-7000-8000-000000000001';
const TEAM_QUESTION = '0192bbbb-0000-7000-8000-000000000002';
const DIET_QUESTION = '0192bbbb-0000-7000-8000-000000000003';
const NAME_COLUMN = '0192cccc-0000-7000-8000-000000000001';
const TEAM_COLUMN = '0192cccc-0000-7000-8000-000000000002';
const DIET_COLUMN = '0192cccc-0000-7000-8000-000000000003';
const CONTRACTOR = '0192dddd-0000-7000-8000-000000000001';

/** About you (Name, Team) → gate on Team → Details (Diet). */
function offsite(): FormLayout {
  return {
    sections: [
      {
        id: ABOUT,
        title: 'About you',
        description: '',
        kind: 'questions',
        gateRules: null,
        gateMessage: '',
        questions: [
          {
            id: NAME_QUESTION,
            columnId: NAME_COLUMN,
            helpText: '',
            required: true,
            widget: 'short',
          },
          {
            id: TEAM_QUESTION,
            columnId: TEAM_COLUMN,
            helpText: '',
            required: true,
            widget: 'choice',
          },
        ],
      },
      {
        id: GATE,
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
        gateMessage: 'The offsite is for employees.',
        questions: [],
      },
      {
        id: DETAILS,
        title: 'Details',
        description: '',
        kind: 'questions',
        gateRules: null,
        gateMessage: '',
        questions: [
          {
            id: DIET_QUESTION,
            columnId: DIET_COLUMN,
            helpText: 'Allergies too',
            required: false,
            widget: 'paragraph',
          },
        ],
      },
    ],
  };
}

const order = (layout: FormLayout) =>
  layout.sections.map(
    (section) =>
      `${section.title}: ${section.questions.map((question) => question.columnId.slice(-1)).join(',')}`
  );

describe('addQuestion', () => {
  it('places a new question at an index of a section, leaving everything else as it was', () => {
    const NEW_QUESTION = '0192bbbb-0000-7000-8000-000000000004';
    const NEW_COLUMN = '0192cccc-0000-7000-8000-000000000004';
    const result = addQuestion(
      offsite(),
      {
        id: NEW_QUESTION,
        columnId: NEW_COLUMN,
        helpText: '',
        required: false,
        widget: null,
      },
      { sectionId: ABOUT, index: 1 }
    );
    expect(result._unsafeUnwrap()).toEqual({
      sections: [
        {
          id: ABOUT,
          title: 'About you',
          description: '',
          kind: 'questions',
          gateRules: null,
          gateMessage: '',
          questions: [
            {
              id: NAME_QUESTION,
              columnId: NAME_COLUMN,
              helpText: '',
              required: true,
              widget: 'short',
            },
            {
              id: NEW_QUESTION,
              columnId: NEW_COLUMN,
              helpText: '',
              required: false,
              widget: null,
            },
            {
              id: TEAM_QUESTION,
              columnId: TEAM_COLUMN,
              helpText: '',
              required: true,
              widget: 'choice',
            },
          ],
        },
        offsite().sections[1],
        offsite().sections[2],
      ],
    });
  });

  it('clamps an index past the end to the end', () => {
    const layout = addQuestion(
      offsite(),
      {
        id: 'q4',
        columnId: 'column-4',
        helpText: '',
        required: false,
        widget: null,
      },
      { sectionId: DETAILS, index: 99 }
    )._unsafeUnwrap();
    expect(order(layout)).toEqual([
      'About you: 1,2',
      'Eligibility: ',
      'Details: 3,4',
    ]);
  });

  it('refuses a column already on the form', () => {
    expect(
      addQuestion(
        offsite(),
        {
          id: 'q4',
          columnId: NAME_COLUMN,
          helpText: '',
          required: false,
          widget: null,
        },
        { sectionId: DETAILS, index: 0 }
      )._unsafeUnwrapErr()
    ).toEqual({ kind: 'column-on-form', columnId: NAME_COLUMN });
  });

  it('refuses a gate section or a section that does not exist', () => {
    const question = {
      id: 'q4',
      columnId: 'column-4',
      helpText: '',
      required: false,
      widget: null,
    };
    expect(
      addQuestion(offsite(), question, {
        sectionId: GATE,
        index: 0,
      })._unsafeUnwrapErr()
    ).toEqual({ kind: 'gate-section', sectionId: GATE });
    expect(
      addQuestion(offsite(), question, {
        sectionId: 'nowhere',
        index: 0,
      })._unsafeUnwrapErr()
    ).toEqual({ kind: 'unknown-section', sectionId: 'nowhere' });
  });
});

describe('moveQuestion', () => {
  it('reorders within a section, the index counting the other questions', () => {
    const layout = moveQuestion(offsite(), NAME_QUESTION, {
      sectionId: ABOUT,
      index: 1,
    })._unsafeUnwrap();
    expect(order(layout)).toEqual([
      'About you: 2,1',
      'Eligibility: ',
      'Details: 3',
    ]);
  });

  it('moves a question to another section', () => {
    const layout = moveQuestion(offsite(), NAME_QUESTION, {
      sectionId: DETAILS,
      index: 1,
    })._unsafeUnwrap();
    expect(order(layout)).toEqual([
      'About you: 2',
      'Eligibility: ',
      'Details: 3,1',
    ]);
  });

  it('refuses moving a question a gate tests to after that gate', () => {
    expect(
      moveQuestion(offsite(), TEAM_QUESTION, {
        sectionId: DETAILS,
        index: 0,
      })._unsafeUnwrapErr()
    ).toEqual({
      kind: 'gate-before-question',
      gateSectionId: GATE,
      columnId: TEAM_COLUMN,
    });
  });

  it('refuses unknown questions and gate targets', () => {
    expect(
      moveQuestion(offsite(), 'missing', {
        sectionId: ABOUT,
        index: 0,
      })._unsafeUnwrapErr()
    ).toEqual({ kind: 'unknown-question', questionId: 'missing' });
    expect(
      moveQuestion(offsite(), DIET_QUESTION, {
        sectionId: GATE,
        index: 0,
      })._unsafeUnwrapErr()
    ).toEqual({ kind: 'gate-section', sectionId: GATE });
  });
});

describe('removeQuestion', () => {
  it('takes the question off the form', () => {
    const { layout, prunedConditions } = removeQuestion(
      offsite(),
      DIET_QUESTION
    )._unsafeUnwrap();
    expect(order(layout)).toEqual([
      'About you: 1,2',
      'Eligibility: ',
      'Details: ',
    ]);
    expect(prunedConditions).toBe(0);
  });

  it('drops the gate conditions that tested its column', () => {
    const { layout, prunedConditions } = removeQuestion(
      offsite(),
      TEAM_QUESTION
    )._unsafeUnwrap();
    expect(layout.sections[1].gateRules).toEqual({
      conjunction: 'and',
      conditions: [],
    });
    expect(prunedConditions).toBe(1);
  });
});

describe('broken gate rules', () => {
  it('names the columns a gate tests that no earlier question asks any more, and removes just those rules', () => {
    const layout = offsite();
    // The Team question went (its column deleted in the grid); the rule stayed.
    layout.sections[0].questions = layout.sections[0].questions.filter(
      (question) => question.id !== TEAM_QUESTION
    );
    expect(brokenGateColumns(layout, GATE)).toEqual([TEAM_COLUMN]);
    const repaired = pruneBrokenRules(layout, GATE)._unsafeUnwrap();
    expect(repaired.prunedConditions).toBe(1);
    expect(repaired.layout.sections[1].gateRules?.conditions).toEqual([]);
    expect(brokenGateColumns(offsite(), GATE)).toEqual([]);
  });
});

describe('pruning gate rules', () => {
  it('drops a nested group emptied by a removal instead of leaving an OR that passes everyone', () => {
    const layout = offsite();
    layout.sections[1].gateRules = {
      conjunction: 'or',
      conditions: [
        {
          kind: 'group',
          conjunction: 'and',
          conditions: [
            {
              kind: 'condition',
              column: TEAM_COLUMN,
              test: {
                kind: 'options',
                operator: 'isAnyOf',
                options: [CONTRACTOR],
              },
            },
          ],
        },
        {
          kind: 'condition',
          column: NAME_COLUMN,
          test: { kind: 'text', operator: 'is', value: 'Ada' },
        },
      ],
    };
    const { layout: pruned, prunedConditions } = removeQuestion(
      layout,
      TEAM_QUESTION
    )._unsafeUnwrap();
    expect(prunedConditions).toBe(1);
    expect(pruned.sections[1].gateRules).toEqual({
      conjunction: 'or',
      conditions: [
        {
          kind: 'condition',
          column: NAME_COLUMN,
          test: { kind: 'text', operator: 'is', value: 'Ada' },
        },
      ],
    });
  });

  it('keeps a group that was empty before and an emptied root as they are', () => {
    const layout = offsite();
    layout.sections[1].gateRules = {
      conjunction: 'and',
      conditions: [
        { kind: 'group', conjunction: 'or', conditions: [] },
        {
          kind: 'condition',
          column: TEAM_COLUMN,
          test: { kind: 'presence', operator: 'isNotEmpty' },
        },
      ],
    };
    const { layout: pruned } = removeQuestion(
      layout,
      TEAM_QUESTION
    )._unsafeUnwrap();
    expect(pruned.sections[1].gateRules).toEqual({
      conjunction: 'and',
      conditions: [{ kind: 'group', conjunction: 'or', conditions: [] }],
    });
  });
});

describe('updateQuestion', () => {
  it('changes help text, required and widget only', () => {
    const layout = updateQuestion(offsite(), DIET_QUESTION, {
      helpText: 'Anything we should know',
      required: true,
      widget: 'short',
    })._unsafeUnwrap();
    expect(layout.sections[2].questions[0]).toEqual({
      id: DIET_QUESTION,
      columnId: DIET_COLUMN,
      helpText: 'Anything we should know',
      required: true,
      widget: 'short',
    });
  });
});

describe('swapQuestionColumn', () => {
  it('points the question at the converted column, keeping its place and presentation', () => {
    const CONVERTED = '0192cccc-0000-7000-8000-0000000000f2';
    const { layout, prunedConditions } = swapQuestionColumn(
      offsite(),
      TEAM_QUESTION,
      CONVERTED
    )._unsafeUnwrap();
    expect(layout.sections[0].questions[1]).toEqual({
      id: TEAM_QUESTION,
      columnId: CONVERTED,
      helpText: '',
      required: true,
      widget: 'choice',
    });
    expect(prunedConditions).toBe(1);
    expect(layout.sections[1].gateRules?.conditions).toEqual([]);
  });

  it('refuses a column another question asks', () => {
    expect(
      swapQuestionColumn(
        offsite(),
        TEAM_QUESTION,
        NAME_COLUMN
      )._unsafeUnwrapErr()
    ).toEqual({ kind: 'column-on-form', columnId: NAME_COLUMN });
  });
});

describe('sections', () => {
  it('adds a section at an index', () => {
    const layout = addSection(
      offsite(),
      {
        id: 'new',
        title: 'Travel',
        description: '',
        kind: 'questions',
        gateRules: null,
        gateMessage: '',
        questions: [],
      },
      3
    )._unsafeUnwrap();
    expect(layout.sections.map((section) => section.title)).toEqual([
      'About you',
      'Eligibility',
      'Details',
      'Travel',
    ]);
  });

  it('moves a section when no gate would test a later question', () => {
    const layout = moveSection(offsite(), DETAILS, 0)._unsafeUnwrap();
    expect(layout.sections.map((section) => section.title)).toEqual([
      'Details',
      'About you',
      'Eligibility',
    ]);
  });

  it('refuses moving a gate above the questions it tests', () => {
    expect(moveSection(offsite(), GATE, 0)._unsafeUnwrapErr()).toEqual({
      kind: 'gate-before-question',
      gateSectionId: GATE,
      columnId: TEAM_COLUMN,
    });
    expect(moveSection(offsite(), DETAILS, 5)._unsafeUnwrap()).toEqual(
      offsite()
    );
  });

  it('removes a section with its questions and the gate conditions on them', () => {
    const { layout, prunedConditions } = removeSection(
      offsite(),
      ABOUT
    )._unsafeUnwrap();
    expect(order(layout)).toEqual(['Eligibility: ', 'Details: 3']);
    expect(prunedConditions).toBe(1);
  });

  it('updates a gate with rules naming earlier questions only', () => {
    const rules = {
      conjunction: 'or' as const,
      conditions: [
        {
          kind: 'condition' as const,
          column: NAME_COLUMN,
          test: { kind: 'presence' as const, operator: 'isNotEmpty' as const },
        },
      ],
    };
    const layout = updateSection(offsite(), GATE, {
      gateRules: rules,
      gateMessage: 'Tell us your name',
    })._unsafeUnwrap();
    expect(layout.sections[1].gateRules).toEqual(rules);
    expect(layout.sections[1].gateMessage).toBe('Tell us your name');
    expect(
      updateSection(offsite(), GATE, {
        gateRules: {
          conjunction: 'and',
          conditions: [
            {
              kind: 'group',
              conjunction: 'or',
              conditions: [
                {
                  kind: 'condition',
                  column: DIET_COLUMN,
                  test: { kind: 'presence', operator: 'isEmpty' },
                },
              ],
            },
          ],
        },
      })._unsafeUnwrapErr()
    ).toEqual({
      kind: 'gate-before-question',
      gateSectionId: GATE,
      columnId: DIET_COLUMN,
    });
  });
});

describe('reads', () => {
  it('lists the columns a gate may test', () => {
    expect(gateColumns(offsite(), GATE)).toEqual([NAME_COLUMN, TEAM_COLUMN]);
    expect(gateColumns(offsite(), ABOUT)).toEqual([]);
  });

  it('lists the columns rules name, nested groups included, once each', () => {
    expect(
      columnsNamed({
        conjunction: 'and',
        conditions: [
          {
            kind: 'condition',
            column: TEAM_COLUMN,
            test: { kind: 'presence', operator: 'isEmpty' },
          },
          {
            kind: 'group',
            conjunction: 'or',
            conditions: [
              {
                kind: 'condition',
                column: NAME_COLUMN,
                test: { kind: 'presence', operator: 'isEmpty' },
              },
              {
                kind: 'condition',
                column: TEAM_COLUMN,
                test: { kind: 'presence', operator: 'isNotEmpty' },
              },
            ],
          },
        ],
      })
    ).toEqual([TEAM_COLUMN, NAME_COLUMN]);
  });

  it('lists table columns no question asks, less the managed ones', () => {
    const column = (id: string, name: string): FormColumn => ({
      id,
      name,
      kind: { type: 'text' },
      options: [],
    });
    expect(
      hiddenColumns(
        offsite(),
        [
          column(NAME_COLUMN, 'Name'),
          column('notes', 'Notes'),
          column('submitted', 'Submitted'),
          column(TEAM_COLUMN, 'Team'),
          column('respondent', 'Respondent'),
        ],
        ['submitted', 'respondent', null]
      ).map((hidden) => hidden.name)
    ).toEqual(['Notes']);
  });
});
