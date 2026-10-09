import { describe, expect, it } from 'vitest';
import {
  dateInputFromInstant,
  instantFromDateInput,
  instantFromLocalInput,
  localInputFromInstant,
} from './date-answers';
import type { FormColumn, FormMetadata } from './form-model';
import { availabilityLine, formAvailability } from './form-status';
import { rulesSentence } from './rule-sentence';

describe('rulesSentence', () => {
  it('reads the RFC example back as one line', () => {
    const columns = new Map<string, FormColumn>([
      [
        'team',
        {
          id: 'team',
          name: 'Team',
          kind: { type: 'select', multi: false },
          options: [{ id: 'contractor', label: 'Contractor', color: null }],
        },
      ],
      [
        'start',
        {
          id: 'start',
          name: 'Start date',
          kind: { type: 'date' },
          options: [],
        },
      ],
    ]);
    expect(
      rulesSentence(
        {
          conjunction: 'and',
          conditions: [
            {
              kind: 'condition',
              column: 'team',
              test: {
                kind: 'options',
                operator: 'isNoneOf',
                options: ['contractor'],
              },
            },
            {
              kind: 'condition',
              column: 'start',
              test: {
                kind: 'date',
                operator: 'before',
                value: '2026-09-01T00:00:00Z',
              },
            },
          ],
        },
        columns
      )
    ).toBe('IF Team is not Contractor AND Start date is before Sep 1, 2026');
    expect(rulesSentence({ conjunction: 'and', conditions: [] }, columns)).toBe(
      undefined
    );
  });
});

describe('availability', () => {
  const form: FormMetadata = {
    id: 'f',
    name: 'F',
    description: '',
    ownerId: 'o',
    databaseId: 'd',
    tableId: 't',
    audience: 'members',
    status: 'open',
    closesAt: '2026-10-03T17:00:00Z',
    tallyVisible: false,
    confirmationMessage: '',
    submittedColumnId: null,
    respondentColumnId: null,
  };
  const now = new Date('2026-10-01T12:00:00Z');

  it('says open with its deadline, closed past it, closed when closed, gone when gone', () => {
    expect(availabilityLine(formAvailability(form, false, now), now)).toBe(
      'Accepting responses · closes Oct 3'
    );
    expect(
      formAvailability(form, false, new Date('2026-10-04T00:00:00Z'))
    ).toEqual({ kind: 'closed', reason: 'deadline' });
    expect(
      availabilityLine(
        formAvailability({ ...form, status: 'closed' }, false, now),
        now
      )
    ).toBe('Closed');
    expect(availabilityLine(formAvailability(form, true, now), now)).toBe(
      'Table deleted'
    );
  });
});

describe('date answers', () => {
  it('round-trips a date through midnight UTC and a local time through its instant', () => {
    expect(instantFromDateInput('2026-09-01')).toBe('2026-09-01T00:00:00.000Z');
    expect(dateInputFromInstant('2026-09-01T00:00:00.000Z')).toBe('2026-09-01');
    expect(instantFromDateInput('2026-9-1')).toBeUndefined();
    const instant = instantFromLocalInput('2026-08-15T09:30');
    expect(instant).toBeDefined();
    expect(localInputFromInstant(instant!)).toBe('2026-08-15T09:30');
    expect(instantFromLocalInput('')).toBeUndefined();
  });
});
