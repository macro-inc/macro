import { describe, expect, it } from 'vitest';
import {
  answerProblem,
  answersOf,
  isAnswered,
  nextStep,
  previousSectionIndex,
  questionSectionIndices,
  sectionProblems,
  submissionAnswers,
} from './answers';
import type { FormColumn, FormLayout } from './form-model';

const NAME = 'column-name';
const TEAM = 'column-team';
const DIET = 'column-diet';
const CONTRACTOR = 'option-contractor';
const EMPLOYEE = 'option-employee';

const layout: FormLayout = {
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
          columnId: NAME,
          helpText: '',
          required: true,
          widget: 'short',
        },
        {
          id: 'q-team',
          columnId: TEAM,
          helpText: '',
          required: false,
          widget: 'choice',
        },
      ],
    },
    {
      id: 'eligibility',
      title: 'Eligibility',
      description: '',
      kind: 'gate',
      gateRules: {
        conjunction: 'and',
        conditions: [
          {
            kind: 'condition',
            column: TEAM,
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
      id: 'details',
      title: 'Details',
      description: '',
      kind: 'questions',
      gateRules: null,
      gateMessage: '',
      questions: [
        {
          id: 'q-diet',
          columnId: DIET,
          helpText: '',
          required: true,
          widget: 'paragraph',
        },
      ],
    },
  ],
};

const columns = new Map<string, FormColumn>([
  [NAME, { id: NAME, name: 'Name', kind: { type: 'text' }, options: [] }],
  [
    TEAM,
    {
      id: TEAM,
      name: 'Team',
      kind: { type: 'select', multi: false },
      options: [
        { id: CONTRACTOR, label: 'Contractor', color: null },
        { id: EMPLOYEE, label: 'Employee', color: null },
      ],
    },
  ],
  [DIET, { id: DIET, name: 'Diet', kind: { type: 'text' }, options: [] }],
]);

describe('nextStep', () => {
  it('walks a passing respondent through every section to submit, and stops a failing one at the gate', () => {
    expect(nextStep(layout, -1, {})).toEqual({ kind: 'section', index: 0 });
    expect(
      nextStep(layout, 0, {
        'q-name': { type: 'text', value: 'Ada' },
        'q-team': { type: 'options', value: [{ id: EMPLOYEE }] },
      })
    ).toEqual({ kind: 'section', index: 2 });
    expect(nextStep(layout, 2, {})).toEqual({ kind: 'submit' });
    expect(
      nextStep(layout, 0, {
        'q-name': { type: 'text', value: 'Ada' },
        'q-team': { type: 'options', value: [{ id: CONTRACTOR }] },
      })
    ).toEqual({
      kind: 'stop',
      sectionId: 'eligibility',
      message: 'The offsite is for employees.',
    });
  });

  it('stops someone who skipped the question a gate tests', () => {
    expect(
      nextStep(layout, 0, { 'q-name': { type: 'text', value: 'Ada' } })
    ).toEqual({
      kind: 'stop',
      sectionId: 'eligibility',
      message: 'The offsite is for employees.',
    });
  });

  it('checks a gate against the trimmed answer that would be sent', () => {
    const yes: FormLayout = {
      sections: [
        { ...layout.sections[0] },
        {
          ...layout.sections[1],
          gateRules: {
            conjunction: 'and',
            conditions: [
              {
                kind: 'condition',
                column: NAME,
                test: { kind: 'text', operator: 'is', value: 'yes' },
              },
            ],
          },
        },
        { ...layout.sections[2] },
      ],
    };
    expect(
      nextStep(yes, 0, { 'q-name': { type: 'text', value: 'Yes \n' } })
    ).toEqual({ kind: 'section', index: 2 });
  });

  it('reports a gate testing a question no longer before it as an update in progress, never its stop message', () => {
    const stale: FormLayout = {
      sections: [
        {
          ...layout.sections[0],
          questions: layout.sections[0].questions.filter(
            (question) => question.columnId !== TEAM
          ),
        },
        layout.sections[1],
        layout.sections[2],
      ],
    };
    expect(
      nextStep(stale, 0, { 'q-name': { type: 'text', value: 'Ada' } })
    ).toEqual({ kind: 'updating' });
  });

  it('goes back over gates to the previous questions section', () => {
    expect(previousSectionIndex(layout, 2)).toBe(0);
    expect(previousSectionIndex(layout, 0)).toBeUndefined();
    expect(questionSectionIndices(layout)).toEqual([0, 2]);
  });
});

describe('validation', () => {
  it('reports required and malformed answers of a section', () => {
    expect(
      sectionProblems(layout.sections[0], columns, {
        'q-team': { type: 'options', value: [{ id: 'gone' }] },
      })
    ).toEqual([
      { questionId: 'q-name', message: 'This question is required.' },
      { questionId: 'q-team', message: 'That option is no longer available.' },
    ]);
    expect(
      sectionProblems(layout.sections[0], columns, {
        'q-name': { type: 'text', value: '   ' },
      })
    ).toEqual([
      { questionId: 'q-name', message: 'This question is required.' },
    ]);
  });

  it('checks links, numbers, dates and single choices', () => {
    const question = {
      id: 'q',
      columnId: 'c',
      helpText: '',
      required: false,
      widget: null,
    };
    const link: FormColumn = {
      id: 'c',
      name: 'Site',
      kind: { type: 'link' },
      options: [],
    };
    expect(
      answerProblem(question, link, { type: 'link', value: ['example.com'] })
    ).toBe('Enter a full link starting with https://');
    expect(
      answerProblem(question, link, {
        type: 'link',
        value: ['https://example.com'],
      })
    ).toBeUndefined();
    const number: FormColumn = { ...link, kind: { type: 'number' } };
    expect(
      answerProblem(question, number, { type: 'number', value: Number.NaN })
    ).toBe('Enter a number.');
    const date: FormColumn = { ...link, kind: { type: 'date' } };
    expect(
      answerProblem(question, date, { type: 'date', value: 'not a date' })
    ).toBe('Enter a valid date.');
    const person: FormColumn = {
      ...link,
      kind: { type: 'entity', target: 'USER', multi: false },
    };
    expect(
      answerProblem(question, person, {
        type: 'entities',
        value: [
          { entityType: 'USER', entityId: 'a' },
          { entityType: 'USER', entityId: 'b' },
        ],
      })
    ).toBe('Choose one.');
  });

  it('treats clear, blank text and empty lists as unanswered', () => {
    expect(isAnswered(undefined)).toBe(false);
    expect(isAnswered({ type: 'clear' })).toBe(false);
    expect(isAnswered({ type: 'text', value: ' ' })).toBe(false);
    expect(isAnswered({ type: 'options', value: [] })).toBe(false);
    expect(isAnswered({ type: 'boolean', value: false })).toBe(true);
    expect(isAnswered({ type: 'number', value: 0 })).toBe(true);
  });
});

describe('submissionAnswers', () => {
  const answers = {
    'q-name': { type: 'text' as const, value: '  Ada  ' },
    'q-team': { type: 'options' as const, value: [] },
  };

  it('sends what was answered on a first submission, trimmed', () => {
    expect(submissionAnswers(layout, answers, 'create')).toEqual([
      { question: 'q-name', value: { type: 'text', value: 'Ada' } },
    ]);
  });

  it('clears every unanswered question on an edit', () => {
    expect(submissionAnswers(layout, answers, 'edit')).toEqual([
      { question: 'q-name', value: { type: 'text', value: 'Ada' } },
      { question: 'q-team', value: { type: 'clear' } },
      { question: 'q-diet', value: { type: 'clear' } },
    ]);
  });

  it('reads a stored response back into memory without its cleared cells', () => {
    expect(
      answersOf([
        { question: 'q-name', value: { type: 'text', value: 'Ada' } },
        { question: 'q-diet', value: { type: 'clear' } },
      ])
    ).toEqual({ 'q-name': { type: 'text', value: 'Ada' } });
  });
});
