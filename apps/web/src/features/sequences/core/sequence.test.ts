import type {
  EnrollmentAction,
  EnrollmentReason,
  EnrollmentStatus,
  Sequence,
  SequenceStatus,
} from '@service-email/generated/schemas';
import { describe, expect, it } from 'vitest';
import {
  defaultStart,
  draftChanges,
  enrollmentActions,
  insertToken,
  shownStatus,
  toDraft,
} from './sequence';

describe('enrollmentActions', () => {
  it.each<
    [
      EnrollmentStatus,
      EnrollmentReason | null,
      SequenceStatus,
      EnrollmentAction[],
      string | null,
    ]
  >([
    ['active', null, 'active', ['pause', 'stop', 'unsubscribe'], 'person'],
    ['paused', null, 'active', ['resume', 'stop', 'unsubscribe'], 'person'],
    [
      'needs_attention',
      null,
      'active',
      ['resume', 'pause', 'stop', 'unsubscribe'],
      'person',
    ],
    ['stopped', 'replied', 'active', ['resume', 'unsubscribe'], 'person'],
    ['stopped', 'bounced', 'active', ['resume', 'unsubscribe'], 'person'],
    [
      'stopped',
      'contact_removed',
      'active',
      ['resume', 'unsubscribe'],
      'person',
    ],
    ['stopped', 'contact_removed', 'active', ['unsubscribe'], null],
    ['stopped', 'manual', 'active', ['unsubscribe'], 'person'],
    ['stopped', 'unsubscribed', 'active', [], 'person'],
    ['completed', null, 'active', ['unsubscribe'], 'person'],
    ['active', null, 'paused', ['stop', 'unsubscribe'], 'person'],
    ['needs_attention', null, 'paused', ['stop', 'unsubscribe'], 'person'],
    ['paused', null, 'draft', ['stop', 'unsubscribe'], 'person'],
    ['stopped', 'replied', 'paused', ['unsubscribe'], 'person'],
  ])(
    '%s (%s) in a %s sequence offers %j (CRM person %s)',
    (status, reason, sequence, expected, crmContactId) => {
      expect(
        enrollmentActions({ status, reason, crmContactId }, sequence)
      ).toEqual(expected);
    }
  );
});

describe('shownStatus', () => {
  it.each<[EnrollmentStatus, boolean, EnrollmentStatus]>([
    ['active', true, 'paused'],
    ['active', false, 'active'],
    ['needs_attention', true, 'needs_attention'],
  ])('%s with the sequence held=%s shows %s', (status, held, expected) => {
    expect(shownStatus({ status }, held)).toBe(expected);
  });
});

describe('draftChanges', () => {
  const sequence: Sequence = {
    id: 'sequence',
    name: 'Intro',
    linkId: 'link',
    footer: '',
    weekdaysOnly: true,
    status: 'draft',
    steps: [
      { id: 'a', delayDays: 0, subject: 'Hello', body: 'Hi', asReply: false },
      { id: 'b', delayDays: 2, subject: '', body: 'Again', asReply: true },
    ],
    createdAt: '',
    updatedAt: '',
  };
  const draft = toDraft(sequence);
  const [first, second] = draft.steps;

  it('sends only what changed', () => {
    expect(draftChanges(sequence, draft)).toBeUndefined();
    expect(draftChanges(sequence, { ...draft, name: 'Welcome' })).toEqual({
      name: 'Welcome',
    });
    expect(draftChanges(sequence, { ...draft, weekdaysOnly: false })).toEqual({
      weekdaysOnly: false,
    });
  });

  it('sends the first email with no wait and not as a reply', () => {
    expect(
      draftChanges(sequence, {
        ...draft,
        steps: [{ ...first, delayDays: 5 }, second],
      })
    ).toBeUndefined();
    expect(
      draftChanges(sequence, { ...draft, steps: [second, first] })?.steps
    ).toEqual([
      { ...second, delayDays: 0, asReply: false },
      { ...first, asReply: false },
    ]);
  });
});

it('inserts a token over the selection and puts the caret after it', () => {
  expect(insertToken('Hi there,', 3, 8, '{{firstName}}')).toEqual({
    value: 'Hi {{firstName}},',
    caret: 16,
  });
});

describe('defaultStart', () => {
  // 2026-06-03 is a Wednesday.
  const at = (day: number, hour: number, minute = 0) =>
    new Date(2026, 5, day, hour, minute);

  it('starts in a few minutes during working hours', () => {
    expect(defaultStart(at(3, 10, 2))).toEqual(at(3, 10, 10));
  });

  it('otherwise starts when the next working day does', () => {
    expect(defaultStart(at(3, 7))).toEqual(at(3, 9));
    expect(defaultStart(at(3, 16, 57))).toEqual(at(4, 9));
    expect(defaultStart(at(5, 18))).toEqual(at(8, 9));
    expect(defaultStart(at(6, 11))).toEqual(at(8, 9));
  });
});
