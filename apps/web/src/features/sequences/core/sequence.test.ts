import type {
  EnrollmentAction,
  EnrollmentReason,
  EnrollmentStatus,
  Sequence,
  SequenceStatus,
} from '@service-email/generated/schemas';
import { describe, expect, it } from 'vitest';
import {
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
    ]
  >([
    ['active', null, 'active', ['pause', 'stop', 'unsubscribe']],
    ['paused', null, 'active', ['resume', 'stop', 'unsubscribe']],
    [
      'needs_attention',
      null,
      'active',
      ['resume', 'pause', 'stop', 'unsubscribe'],
    ],
    ['stopped', 'replied', 'active', ['resume', 'unsubscribe']],
    ['stopped', 'bounced', 'active', ['resume', 'unsubscribe']],
    ['stopped', 'contact_removed', 'active', ['resume', 'unsubscribe']],
    ['stopped', 'manual', 'active', ['unsubscribe']],
    ['stopped', 'unsubscribed', 'active', []],
    ['completed', null, 'active', ['unsubscribe']],
    ['active', null, 'paused', ['stop', 'unsubscribe']],
    ['needs_attention', null, 'paused', ['stop', 'unsubscribe']],
    ['paused', null, 'draft', ['stop', 'unsubscribe']],
    ['stopped', 'replied', 'paused', ['unsubscribe']],
  ])(
    '%s (%s) in a %s sequence offers %j',
    (status, reason, sequence, expected) => {
      expect(enrollmentActions({ status, reason }, sequence)).toEqual(expected);
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
