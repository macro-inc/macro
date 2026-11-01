import type {
  EnrollmentReason,
  EnrollmentStatus,
  Sequence,
} from '@service-email/generated/schemas';
import { describe, expect, it } from 'vitest';
import {
  draftChanges,
  enrollmentActions,
  isRetry,
  shownStatus,
  toDraft,
} from './sequence';

const enrollment = (status: EnrollmentStatus, reason?: EnrollmentReason) => ({
  status,
  reason,
});

describe('enrollment actions', () => {
  it('offers resume for held enrollments and stops a reply may have caused', () => {
    expect(enrollmentActions(enrollment('paused'), 'active')).toEqual([
      'resume',
      'stop',
      'unsubscribe',
    ]);
    expect(
      enrollmentActions(enrollment('needs_attention', 'step_failed'), 'active')
    ).toEqual(['resume', 'pause', 'stop', 'unsubscribe']);
    for (const reason of ['replied', 'bounced'] as const)
      expect(
        enrollmentActions(enrollment('stopped', reason), 'active')
      ).toEqual(['resume', 'unsubscribe']);
  });

  it('never resumes a deliberate stop or a finished enrollment, but can still opt it out', () => {
    for (const reason of ['manual', 'access_lost'] as const)
      expect(
        enrollmentActions(enrollment('stopped', reason), 'active')
      ).toEqual(['unsubscribe']);
    expect(enrollmentActions(enrollment('completed'), 'active')).toEqual([
      'unsubscribe',
    ]);
    expect(
      enrollmentActions(enrollment('stopped', 'unsubscribed'), 'active')
    ).toEqual([]);
  });

  it('leaves only stop and unsubscribe while the sequence is paused', () => {
    for (const status of ['active', 'paused', 'needs_attention'] as const)
      expect(enrollmentActions(enrollment(status), 'paused')).toEqual([
        'stop',
        'unsubscribe',
      ]);
    expect(
      enrollmentActions(enrollment('stopped', 'replied'), 'paused')
    ).toEqual(['unsubscribe']);
  });

  it('reads Retry only when the step never went out', () => {
    expect(isRetry(enrollment('needs_attention', 'step_failed'))).toBe(true);
    expect(isRetry(enrollment('needs_attention', 'step_withdrawn'))).toBe(true);
    expect(isRetry(enrollment('needs_attention', 'step_unknown'))).toBe(false);
    expect(isRetry(enrollment('stopped', 'replied'))).toBe(false);
  });

  it('shows active enrollments of a paused sequence as paused', () => {
    expect(shownStatus(enrollment('active'), true)).toBe('paused');
    expect(shownStatus(enrollment('needs_attention'), true)).toBe(
      'needs_attention'
    );
    expect(shownStatus(enrollment('active'), false)).toBe('active');
  });
});

describe('draft changes', () => {
  const sequence: Sequence = {
    id: 'sequence',
    name: 'Intro',
    linkId: 'link',
    footer: '',
    status: 'draft',
    steps: [
      { delayDays: 0, subject: 'Hello', body: 'Hi', asReply: false },
      { delayDays: 2, subject: '', body: 'Again', asReply: true },
    ],
    version: 3,
    createdAt: '',
    updatedAt: '',
  };

  it('sends only what changed', () => {
    expect(draftChanges(sequence, toDraft(sequence))).toBeUndefined();
    expect(
      draftChanges(sequence, { ...toDraft(sequence), name: 'Welcome' })
    ).toEqual({ name: 'Welcome' });
  });

  it('never sends a reply as the first email', () => {
    const draft = toDraft(sequence);
    const changes = draftChanges(sequence, {
      ...draft,
      steps: [draft.steps[1], draft.steps[0]],
    });
    expect(changes?.steps?.map((step) => step.asReply)).toEqual([false, false]);
  });
});
