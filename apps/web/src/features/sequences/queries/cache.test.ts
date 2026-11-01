import type {
  EnrollmentSummary,
  Sequence,
  SequenceDetailResponse,
  SequenceSummary,
} from '@service-email/generated/schemas';
import { describe, expect, it } from 'vitest';
import {
  expectedState,
  withEnrollment,
  withEnrollmentSummary,
  withSummary,
} from './cache';

const counts = {
  active: 3,
  paused: 0,
  needsAttention: 1,
  stopped: 0,
  completed: 0,
};
const summary: SequenceSummary = {
  id: 'a',
  name: 'Intro',
  status: 'draft',
  stepCount: 1,
  counts,
  updatedAt: '2026-11-01T00:00:00Z',
};
const sequence: Sequence = {
  id: 'a',
  name: 'Welcome',
  footer: '',
  status: 'active',
  steps: [
    { delayDays: 0, subject: 'Hi', body: 'Hello' },
    { delayDays: 2, subject: '', body: 'Again', asReply: true },
  ],
  version: 2,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-02T00:00:00Z',
};
const enrollment = (id: string, status: EnrollmentSummary['status']) =>
  ({
    id,
    email: `${id}@example.com`,
    status,
    nextStep: 1,
    stepCount: 2,
    createdAt: '2026-11-01T00:00:00Z',
  }) satisfies EnrollmentSummary;

describe('sequence list cache', () => {
  it('keeps the counts the server computed when a save returns the sequence', () => {
    expect(withSummary([summary], sequence)).toEqual([
      {
        ...summary,
        name: 'Welcome',
        status: 'active',
        stepCount: 2,
        updatedAt: sequence.updatedAt,
      },
    ]);
  });

  it('adds a new sequence first and leaves an unloaded list alone', () => {
    const other = { ...summary, id: 'b' };
    expect(withSummary([other], sequence)?.map((item) => item.id)).toEqual([
      'a',
      'b',
    ]);
    expect(withSummary(undefined, sequence)).toBeUndefined();
  });
});

describe('enrollment cache', () => {
  const detail: SequenceDetailResponse = {
    sequence,
    enrollments: [enrollment('x', 'active'), enrollment('y', 'active')],
  };

  it('replaces one enrollment in place', () => {
    const paused = { ...enrollment('y', 'paused'), reason: null };
    expect(withEnrollment(detail, paused)?.enrollments).toEqual([
      detail.enrollments[0],
      paused,
    ]);
  });

  it('keeps the frozen steps when a summary arrives', () => {
    const steps = [
      {
        delayDays: 0,
        subject: 'Hi',
        body: 'Hello',
        status: 'sent' as const,
      },
    ];
    const stopped = {
      ...enrollment('x', 'stopped'),
      reason: 'manual' as const,
    };
    expect(
      withEnrollmentSummary({ ...enrollment('x', 'active'), steps }, stopped)
    ).toEqual({ ...stopped, steps });
  });

  it('predicts every action but a team-wide opt-out', () => {
    expect(expectedState('pause')).toEqual({ status: 'paused', reason: null });
    expect(expectedState('resume')).toEqual({ status: 'active', reason: null });
    expect(expectedState('stop')).toEqual({
      status: 'stopped',
      reason: 'manual',
    });
    expect(expectedState('unsubscribe')).toBeUndefined();
  });
});
