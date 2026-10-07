import type { FormCollaboration } from '@service-storage/generated/schemas/formCollaboration';
import { describe, expect, it } from 'vitest';
import { publicationMessage } from './form-publication';

const detail: FormCollaboration['detail'] = {
  form: {
    id: 'form',
    name: 'Registration',
    description: '',
    ownerId: 'owner',
    databaseId: 'database',
    tableId: 'table',
    submittedColumnId: null,
    respondentColumnId: null,
    audience: 'members',
    tallyVisible: false,
    status: 'open',
    closesAt: null,
    confirmationMessage: 'Thank you',
    createdAt: '2026-10-05T09:00:00Z',
    updatedAt: '2026-10-05T09:00:00Z',
  },
  access: 'edit',
  tableGone: false,
  sections: [
    {
      kind: 'questions',
      id: 'section',
      title: 'About you',
      description: '',
      questions: [
        {
          id: 'question',
          column: 'column',
          title: 'Name',
          helpText: '',
          kind: { type: 'text' },
          required: false,
          widget: null,
          options: [],
        },
      ],
    },
  ],
};

describe('publicationMessage', () => {
  it('names the affected question and uses screener wording', () => {
    expect(
      publicationMessage({
        detail,
        publicationError: {
          kind: 'layout',
          problem: { kind: 'gateNamesLaterColumn', column: 'column' },
        },
      })
    ).toBe('“Name” must come before the screener that checks it.');
    expect(
      publicationMessage({
        detail,
        publicationError: {
          kind: 'layout',
          problem: { kind: 'unknownColumn', column: 'deleted-column' },
        },
      })
    ).toBe('That question was deleted. Remove it from this form.');
  });

  it('distinguishes a saved draft waiting to publish from unreadable content', () => {
    expect(
      publicationMessage({ detail, publicationError: { kind: 'pending' } })
    ).toBe('Your draft is saved. Publishing hasn’t finished; try again.');
    expect(
      publicationMessage({ detail, publicationError: { kind: 'invalidDraft' } })
    ).toBe(
      'This draft couldn’t be read. Your published form is still available.'
    );
    expect(publicationMessage({ detail })).toBeUndefined();
  });
});
