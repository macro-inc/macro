import { describe, expect, it } from 'vitest';
import type { FormDetail } from './form-model';
import { pollBars, pollOf, pollSummary } from './tally';

const lunch: FormDetail = {
  form: {
    id: 'poll',
    name: 'Lunch?',
    description: '',
    ownerId: 'macro|owner@example.com',
    databaseId: 'database',
    tableId: 'table',
    audience: 'members',
    status: 'open',
    closesAt: null,
    tallyVisible: true,
    confirmationMessage: '',
    submittedColumnId: null,
    respondentColumnId: null,
  },
  layout: {
    sections: [
      {
        id: 'section',
        title: '',
        description: '',
        kind: 'questions',
        gateRules: null,
        gateMessage: '',
        questions: [
          {
            id: 'question',
            columnId: 'answer',
            helpText: '',
            required: true,
            widget: 'choice',
          },
        ],
      },
    ],
  },
  columns: [
    {
      id: 'answer',
      name: 'Answer',
      kind: { type: 'select', multi: false },
      options: [
        { id: 'tacos', label: 'Tacos', color: null },
        { id: 'pho', label: 'Pho', color: null },
        { id: 'salad', label: 'Salad', color: null },
      ],
    },
  ],
  access: 'view',
  tableGone: false,
};

describe('polls', () => {
  it('reads a one-question choice form with visible results as a poll, with a bar per option', () => {
    const poll = pollOf(lunch);
    expect(poll?.multi).toBe(false);
    expect(
      pollBars(
        poll!,
        new Map([
          ['tacos', 12],
          ['pho', 7],
        ]),
        19,
        ['pho']
      )
    ).toEqual([
      {
        optionId: 'tacos',
        label: 'Tacos',
        count: 12,
        percent: 63,
        mine: false,
      },
      { optionId: 'pho', label: 'Pho', count: 7, percent: 37, mine: true },
      { optionId: 'salad', label: 'Salad', count: 0, percent: 0, mine: false },
    ]);
    expect(pollSummary(19, false)).toBe('19 votes · one vote each');
    expect(pollSummary(1, true)).toBe('1 vote · multiple answers');
  });

  it('is not a poll with hidden results, several questions, or a non-choice question', () => {
    expect(
      pollOf({ ...lunch, form: { ...lunch.form, tallyVisible: false } })
    ).toBe(undefined);
    expect(
      pollOf({
        ...lunch,
        columns: [{ ...lunch.columns[0], kind: { type: 'text' } }],
      })
    ).toBe(undefined);
    expect(
      pollOf({
        ...lunch,
        layout: {
          sections: [
            {
              ...lunch.layout.sections[0],
              questions: [
                ...lunch.layout.sections[0].questions,
                {
                  id: 'other',
                  columnId: 'answer',
                  helpText: '',
                  required: false,
                  widget: null,
                },
              ],
            },
          ],
        },
      })
    ).toBe(undefined);
  });
});
