import type {
  AccountDeletionReason,
  AppEvents,
} from '@app/lib/analytics/app-events';

export const ACCOUNT_DELETION_FEEDBACK_MAX_LENGTH = 500;

export const ACCOUNT_DELETION_REASON_OPTIONS: ReadonlyArray<{
  value: AccountDeletionReason;
  label: string;
}> = [
  { value: 'not_using_enough', label: "I don't use Macro enough" },
  { value: 'missing_features', label: "I'm missing features I need" },
  { value: 'difficult_to_use', label: 'Macro is difficult to use' },
  {
    value: 'bugs_or_performance',
    label: "I've experienced bugs or performance issues",
  },
  { value: 'too_expensive', label: 'Macro is too expensive' },
  {
    value: 'prefer_another_product',
    label: 'I prefer another product',
  },
  {
    value: 'privacy_or_security_concerns',
    label: 'I have privacy or security concerns',
  },
  { value: 'other', label: 'Other' },
];

export function buildAccountDeletionFeedbackPayload(
  reason: AccountDeletionReason | undefined,
  feedback: string
): AppEvents['account_deletion_feedback'] {
  const normalizedFeedback = feedback
    .trim()
    .slice(0, ACCOUNT_DELETION_FEEDBACK_MAX_LENGTH);

  return {
    reason: reason ?? 'not_provided',
    ...(normalizedFeedback ? { feedback: normalizedFeedback } : {}),
  };
}

export async function performAccountDeletion(dependencies: {
  captureFeedback: () => void;
  deleteUser: () => Promise<{ isErr: () => boolean }>;
  logout: () => Promise<void>;
}): Promise<boolean> {
  dependencies.captureFeedback();

  const result = await dependencies.deleteUser();
  if (result.isErr()) return false;

  await dependencies.logout();
  return true;
}
