import { EMAIL_COMPOSE_TO_INPUT_ID } from '@app/features/email-compose/core/constants';
import type { useSplitLayout } from '@components/app/split-layout/layout';
import { triggerFocusInput } from '@core/directive/focusInput';

/** Opens a new email from an inbox scope, optionally addressed to known recipients. */
export function composeEmail(
  openWithSplit: ReturnType<typeof useSplitLayout>['openWithSplit'],
  inboxIds?: string[],
  recipients?: string[]
) {
  triggerFocusInput(() => document.getElementById(EMAIL_COMPOSE_TO_INPUT_ID));
  openWithSplit(
    {
      type: 'component',
      id: 'email-compose',
      params: {
        initialInboxId: inboxIds?.length === 1 ? inboxIds[0] : undefined,
        ...(recipients?.length ? { initialTo: recipients } : {}),
      },
      preserveParams: true,
    },
    recipients?.length
      ? { preferNewSplit: true, allowDuplicate: true }
      : { preferNewSplit: false }
  );
}
