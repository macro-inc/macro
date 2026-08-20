import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_DELETION_FEEDBACK_MAX_LENGTH,
  buildAccountDeletionFeedbackPayload,
  performAccountDeletion,
} from './account-deletion-feedback';

describe('buildAccountDeletionFeedbackPayload', () => {
  it('normalizes an unanswered survey', () => {
    expect(buildAccountDeletionFeedbackPayload(undefined, '   ')).toEqual({
      reason: 'not_provided',
    });
  });

  it('trims feedback and preserves the selected reason', () => {
    expect(
      buildAccountDeletionFeedbackPayload(
        'missing_features',
        '  I need offline access.  '
      )
    ).toEqual({
      reason: 'missing_features',
      feedback: 'I need offline access.',
    });
  });

  it('limits feedback to the maximum PostHog property length', () => {
    const feedback = 'a'.repeat(ACCOUNT_DELETION_FEEDBACK_MAX_LENGTH + 1);

    expect(buildAccountDeletionFeedbackPayload('other', feedback)).toEqual({
      reason: 'other',
      feedback: 'a'.repeat(ACCOUNT_DELETION_FEEDBACK_MAX_LENGTH),
    });
  });
});

describe('performAccountDeletion', () => {
  it('captures feedback before deleting and logs out after success', async () => {
    const calls: string[] = [];

    const deleted = await performAccountDeletion({
      captureFeedback: () => calls.push('capture-feedback'),
      deleteUser: async () => {
        calls.push('delete-user');
        return { isErr: () => false };
      },
      logout: async () => {
        calls.push('logout');
      },
    });

    expect(deleted).toBe(true);
    expect(calls).toEqual(['capture-feedback', 'delete-user', 'logout']);
  });

  it('does not log out when account deletion fails', async () => {
    const calls: string[] = [];

    const deleted = await performAccountDeletion({
      captureFeedback: () => calls.push('capture-feedback'),
      deleteUser: async () => {
        calls.push('delete-user');
        return { isErr: () => true };
      },
      logout: async () => {
        calls.push('logout');
      },
    });

    expect(deleted).toBe(false);
    expect(calls).toEqual(['capture-feedback', 'delete-user']);
  });
});
